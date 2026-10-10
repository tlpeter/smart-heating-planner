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
//   HeatMeisters");
// - the room temperature target of the chosen HeatMeisters (number.set_value
//   on their ..._ambientcontrol_temp, setHeatmeisterTarget(), "Set HeatMeister
//   room target"). Home Assistant sends it to the HeatMeister over MQTT.
// Anything else is refused.

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
const subscriptions = new Map(); // id -> function that gets each event
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
  // Live updates: Home Assistant tells the app when one of the chosen
  // entities changes (only reads), and the app can stop that again.
  'subscribe_entities',
  'unsubscribe_events',
]);

const CONTROL_TOKEN = Symbol('thermostat control');
const MQTT_TOKEN = Symbol('heatmeister room temperature');
const TARGET_TOKEN = Symbol('heatmeister room target');

// Send a command to Home Assistant and wait for its result.
// onEvent: for a subscription, called with every event Home Assistant sends for it.
function call(message, timeoutMs = 20000, token = null, onEvent = null) {
  return new Promise((resolve, reject) => {
    const allowed = READ_ONLY_COMMANDS.has(message.type) ||
      // The only write: the thermostat's target, through setTemperature().
      (message.type === 'call_service' && token === CONTROL_TOKEN && options.allow_control === true &&
        message.domain === 'climate' && message.service === 'set_temperature') ||
      // The room temperature for the HeatMeisters, through publishRoomTemperature().
      (message.type === 'call_service' && token === MQTT_TOKEN && options.allow_heatmeister_temperature === true &&
        message.domain === 'mqtt' && message.service === 'publish') ||
      // The HeatMeisters' room target, through setHeatmeisterTarget().
      (message.type === 'call_service' && token === TARGET_TOKEN && options.allow_heatmeister_target === true &&
        message.domain === 'number' && message.service === 'set_value');
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
    pending.set(id, { resolve: (r) => resolve(onEvent ? id : r), reject });
    if (onEvent) subscriptions.set(id, onEvent);
    socket.send(JSON.stringify({ id, ...message }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        subscriptions.delete(id);
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

// Get told when one of these entities changes. Resolves to the subscription id.
function subscribeEntities(entityIds, onEvent) {
  return call({ type: 'subscribe_entities', entity_ids: entityIds }, 20000, null, onEvent);
}

function unsubscribe(id) {
  if (!subscriptions.delete(id) || !state.connected) return Promise.resolve();
  return call({ type: 'unsubscribe_events', subscription: id }).catch(() => {});
}

// The room temperature target of one HeatMeister. Refused unless "Set
// HeatMeister room target" is on, and only for the target entity of a
// HeatMeister chosen in Settings.
const TARGET_ID = /^number\.[a-z0-9_]+_ambientcontrol_temp(?:_\d+)?$/;
async function setHeatmeisterTarget(entityId, temperature, allowedIds) {
  if (options.allow_heatmeister_target !== true) {
    warn('Refused number.set_value - "Set HeatMeister room target" is off');
    throw new Error('Setting the HeatMeister room target is off in the Configuration tab');
  }
  if (!TARGET_ID.test(String(entityId)) || !(allowedIds || []).includes(entityId)) {
    warn('Refused number.set_value for', entityId, '- not the room target of a chosen HeatMeister');
    throw new Error(`${entityId} is not the room target of a chosen HeatMeister`);
  }
  const t = Number(temperature);
  if (!Number.isFinite(t) || t < 5 || t > 30) throw new Error(`${temperature} °C is outside 5-30 °C`);
  log('SENDING HeatMeister room target:', entityId, t, '°C');
  return call({
    type: 'call_service',
    domain: 'number',
    service: 'set_value',
    service_data: { value: t },
    target: { entity_id: entityId },
  }, 20000, TARGET_TOKEN);
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
      else {
        subscriptions.delete(msg.id);
        reject(new Error(msg.error ? msg.error.message : 'Unknown error'));
      }
    } else if (msg.type === 'event' && subscriptions.has(msg.id)) {
      try { subscriptions.get(msg.id)(msg.event); } catch (err) { warn('Event handler failed:', err.message); }
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
    subscriptions.clear();
    setTimeout(connect, RECONNECT_MS);
  });
}

module.exports = { state, call, subscribeEntities, unsubscribe, setTemperature, publishRoomTemperature, setHeatmeisterTarget, onConnect, connect, recentLog, log, debug, warn, READ_ONLY_COMMANDS };
