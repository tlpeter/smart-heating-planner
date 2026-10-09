'use strict';

// Home Assistant WebSocket client.
// Connects through the Supervisor, authenticates, and lets the rest of the app
// read states and registries.
//
// SAFETY: the app mostly READS. It writes only two things, each through its
// own function and behind its own option in the Configuration tab:
// - the target temperature of the chosen thermostat (climate.set_temperature,
//   setTemperature(), "Allow control");
// - the temperature for the HeatMeisters (mqtt.publish to the topics set
//   in Settings, publishRoomTemperature(), "Send temperature to
//   HeatMeisters"). Anything else is refused.

const WebSocket = require('ws');
const { options } = require('./options');

const HA_WS_URL = process.env.HA_WS_URL || 'ws://supervisor/core/websocket';
const TOKEN = process.env.SUPERVISOR_TOKEN || process.env.HA_TOKEN || '';
const RECONNECT_MS = Math.max(50, Number(process.env.SHP_RECONNECT_MS) || 10000);

const state = {
  connected: false,
  version: null,
  timeZone: 'UTC',
  lastError: null,
};

let socket = null;
let nextId = 1;
const pending = new Map();
const connectListeners = [];

const LEVELS = { debug: 10, info: 20, warning: 30, error: 40 };
const threshold = LEVELS[options.log_level] || LEVELS.info;

// The last lines of the app log, for "Download diagnostics".
const recentLines = [];
function recentLog() { return recentLines.slice(); }

function logAt(level, args) {
  if (LEVELS[level] < threshold) return;
  const line = [new Date().toISOString(), level.toUpperCase(), ...args];
  recentLines.push(line.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  if (recentLines.length > 300) recentLines.shift();
  (level === 'error' || level === 'warning' ? console.error : console.log)(...line);
}

function log(...args) { logAt('info', args); }
function debug(...args) { logAt('debug', args); }
function warn(...args) { logAt('warning', args); }

// SAFETY: the only WebSocket commands the app may send. All of them only read.
const READ_ONLY_COMMANDS = new Set([
  'get_states',
  'get_config',
  'config/entity_registry/list',
]);

const CONTROL_TOKEN = Symbol('thermostat control');
const MQTT_TOKEN = Symbol('heatmeister room temperature');

// Send a command to Home Assistant and wait for its result.
function call(message, timeoutMs = 20000, token = null) {
  return new Promise((resolve, reject) => {
    const allowed = READ_ONLY_COMMANDS.has(message.type) ||
      // The only write: the thermostat's target, through setTemperature().
      (message.type === 'call_service' && token === CONTROL_TOKEN && options.allow_control === true &&
        message.domain === 'climate' && message.service === 'set_temperature') ||
      // The room temperature for the HeatMeisters, through publishRoomTemperature().
      (message.type === 'call_service' && token === MQTT_TOKEN && options.allow_heatmeister_temperature === true &&
        message.domain === 'mqtt' && message.service === 'publish');
    if (!allowed) {
      warn('Refused command', message.type, message.domain ? `${message.domain}.${message.service}` : '', '- not allowed');
      reject(new Error(`Command ${message.type} is not allowed`));
      return;
    }
    if (!state.connected) {
      reject(new Error('Not connected to Home Assistant'));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, ...message }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Timeout waiting for Home Assistant'));
      }
    }, timeoutMs);
  });
}

// Set the target temperature of the thermostat. Refused unless "Allow
// control" is on, and only for the thermostat chosen in Settings.
async function setTemperature(entityId, temperature, chosen) {
  if (options.allow_control !== true) {
    warn('Refused climate.set_temperature - "Allow control" is off');
    throw new Error('Allow control is off in the app\'s Configuration tab, so nothing was sent');
  }
  if (!/^climate\.[a-z0-9_]+$/.test(String(entityId)) || entityId !== chosen) {
    warn('Refused climate.set_temperature for', entityId, '- not the chosen thermostat');
    throw new Error(`${entityId} is not the chosen thermostat`);
  }
  const t = Number(temperature);
  if (!Number.isFinite(t) || t < 5 || t > 25) throw new Error(`${temperature} °C is outside 5-25 °C`);
  log('SENDING to thermostat:', entityId, t, '°C');
  return call({
    type: 'call_service',
    domain: 'climate',
    service: 'set_temperature',
    service_data: { temperature: t },
    target: { entity_id: entityId },
  }, 20000, CONTROL_TOKEN);
}

// A safe MQTT topic: letters, digits, - _ . / and spaces; no wildcards.
const TOPIC = /^[A-Za-z0-9_\-./ ]{1,100}$/;

// Send the temperature (setpoint or room) to one HeatMeister over MQTT (through Home
// Assistant's MQTT integration). Refused unless "Send temperature to
// HeatMeisters" is on, and only to a topic chosen in Settings.
async function publishRoomTemperature(topic, temperature, allowedTopics) {
  if (options.allow_heatmeister_temperature !== true) {
    warn('Refused mqtt.publish - "Send temperature to HeatMeisters" is off');
    throw new Error('Sending the temperature to the HeatMeisters is off in the Configuration tab');
  }
  if (!TOPIC.test(String(topic)) || /[#+]/.test(topic) || !(allowedTopics || []).includes(topic)) {
    warn('Refused mqtt.publish to', topic, '- not a topic chosen in Settings');
    throw new Error(`${topic} is not a HeatMeister topic chosen in Settings`);
  }
  const t = Number(temperature);
  if (!Number.isFinite(t) || t < -20 || t > 50) throw new Error(`${temperature} is not a room temperature`);
  debug('MQTT', topic, t);
  return call({
    type: 'call_service',
    domain: 'mqtt',
    service: 'publish',
    service_data: { topic, payload: String(Math.round(t * 100) / 100), qos: 0, retain: false },
  }, 20000, MQTT_TOKEN);
}

function onConnect(fn) {
  connectListeners.push(fn);
}

function connect() {
  if (!TOKEN) {
    state.lastError = 'No SUPERVISOR_TOKEN found. Is homeassistant_api enabled?';
    log(state.lastError);
    return;
  }

  log('Connecting to Home Assistant at', HA_WS_URL);
  socket = new WebSocket(HA_WS_URL);

  socket.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'auth_required') {
      socket.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
    } else if (msg.type === 'auth_ok') {
      state.connected = true;
      state.version = msg.ha_version;
      state.lastError = null;
      log('Connected to Home Assistant', state.version);
      try {
        const config = await call({ type: 'get_config' });
        state.timeZone = config.time_zone || 'UTC';
      } catch (err) {
        log('Could not read HA config:', err.message);
      }
      for (const fn of connectListeners) fn();
    } else if (msg.type === 'auth_invalid') {
      state.lastError = 'Authentication failed: ' + (msg.message || 'invalid token');
      log(state.lastError);
      socket.close();
    } else if (msg.type === 'result' && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.success) resolve(msg.result);
      else reject(new Error(msg.error ? msg.error.message : 'Unknown error'));
    }
  });

  socket.on('error', (err) => {
    state.lastError = err.message;
    log('WebSocket error:', err.message);
  });

  socket.on('close', () => {
    if (state.connected) log('Connection to Home Assistant closed');
    state.connected = false;
    for (const { reject } of pending.values()) reject(new Error('Connection closed'));
    pending.clear();
    setTimeout(connect, RECONNECT_MS);
  });
}

module.exports = { state, call, setTemperature, publishRoomTemperature, onConnect, connect, recentLog, log, debug, warn, READ_ONLY_COMMANDS };
