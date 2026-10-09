'use strict';

// Home Assistant WebSocket client.
// Connects through the Supervisor, authenticates, and lets the rest of the app
// read states and registries.
//
// SAFETY: this version only READS. There is no way in this file to call an
// action (service) or change a state. Controlling the thermostat and the
// Heatmeisters will get its own, separate path in a later version, behind an
// "Allow control" option that is off by default.

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
  'config/device_registry/list',
]);

// Send a command to Home Assistant and wait for its result.
function call(message, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!READ_ONLY_COMMANDS.has(message.type)) {
      warn('Refused command', message.type, '- it is not on the read-only list');
      reject(new Error(`Command ${message.type} is not allowed: this version only reads data`));
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

module.exports = { state, call, onConnect, connect, recentLog, log, debug, warn, READ_ONLY_COMMANDS };
