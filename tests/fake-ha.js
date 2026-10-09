'use strict';

// A small fake Home Assistant for the tests: the WebSocket API the app uses.
// A copy of the owner's house:
// - a tado V3 thermostat twice: local through HomeKit, and through the tado
//   cloud with Tado CE;
// - three persons (Peter, Yvonne, Cheyenne), each with a Companion App GPS
//   tracker and a router tracker; Peter also has a Bluetooth tracker;
// - three HeatMeisters through MQTT with the real entity names
//   (heatbooster_<room>_...): Woonkamer-garage (controls the room
//   temperature itself), Woonkamer-voor and Woonkamer-gang. Their outside
//   room temperature comes over MQTT (topic "<Name>/temp-ambient-ext");
//   mqtt.publish is recorded in world.mqtt.
// Change `world` to change the house. Every command the app sends is
// recorded in `calls`; the tests check what was written.
// climate.set_temperature changes world.target (both thermostat entities
// show the same tado).

const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'smart_heating_planner', 'app', 'node_modules', 'ws'));

const HA_VERSION = process.env.SHP_HA_VERSION || '2026.10.0';
const TZ = 'Europe/Amsterdam';
const HOME = { lat: 51.37, lon: 5.19 };

function freshWorld() {
  return {
    room: 19.4,
    target: 19,
    hvacAction: 'idle',
    homekitAvailable: true,
    failWrites: false,
    failMqtt: false,
    mqtt: {}, // topic -> [payloads] sent by the app
    // Where each person's GPS tracker is: 'home', 'not_home', a zone name or 'unknown'.
    persons: { peter: 'home', yvonne: 'not_home', cheyenne: 'not_home' },
    // GPS position per person (lat, lon); missing = at home when home, else 30 km away.
    pos: {},
    // Overrides for the router and Bluetooth trackers: { peter: 'home' }.
    router: {},
    bluetooth: {},
    hm: [
      { id: 'woonkamer_garage', name: 'Woonkamer-garage', state: 'idle', inlet: 21.63, outlet: 21.04, room: 20.33, fan: 0, roomControl: true, roomTarget: 19 },
      { id: 'woonkamer_voor', name: 'Woonkamer-voor', state: 'idle', inlet: 21.2, outlet: 20.9, room: 20.1, fan: 0, roomControl: false, roomTarget: 20 },
      { id: 'woonkamer_gang', name: 'Woonkamer-gang', state: 'idle', inlet: 21.0, outlet: 20.7, room: 20.2, fan: 0, roomControl: false, roomTarget: 20 },
    ],
  };
}

const world = freshWorld();
const calls = [];

function climate(id, name, w, available = true) {
  return [id, available ? 'heat' : 'unavailable', available ? {
    friendly_name: name,
    hvac_modes: ['off', 'heat', 'auto'],
    min_temp: 5, max_temp: 25, target_temp_step: 0.5,
    current_temperature: w.room, temperature: w.target, hvac_action: w.hvacAction,
  } : { friendly_name: name }];
}

// Roughly `km` north of home.
function north(km) {
  return { lat: HOME.lat + km / 111.2, lon: HOME.lon };
}

function personStates(id, name, w) {
  const gps = w.persons[id];
  const router = w.router[id] ?? (gps === 'home' ? 'home' : gps === 'unknown' ? 'unknown' : 'not_home');
  const pos = w.pos[id] || (gps === 'home' ? HOME : gps === 'unknown' ? null : north(30));
  const trackers = [`device_tracker.${id}_phone`, `device_tracker.${id}_router`];
  const list = [
    [`device_tracker.${id}_phone`, gps, { friendly_name: `${name} phone`, source_type: 'gps', ...(pos ? { latitude: pos.lat, longitude: pos.lon, gps_accuracy: 12 } : {}) }],
    [`device_tracker.${id}_router`, router, { friendly_name: `${name} router`, source_type: 'router' }],
  ];
  if (id === 'peter') {
    trackers.push('device_tracker.peter_watch_ble');
    list.push(['device_tracker.peter_watch_ble', w.bluetooth.peter ?? (gps === 'home' ? 'home' : 'not_home'), { friendly_name: 'Peter watch', source_type: 'bluetooth_le' }]);
  }
  // Like Home Assistant: a tracker at home wins; otherwise the GPS state.
  const all = list.map((x) => x[1]);
  const state = all.includes('home') ? 'home' : gps;
  list.push([`person.${id}`, state, { friendly_name: name, device_trackers: trackers, ...(pos && state !== 'home' ? { latitude: pos.lat, longitude: pos.lon } : state === 'home' ? { latitude: HOME.lat, longitude: HOME.lon } : {}) }]);
  return list;
}

function heatmeisterStates(h) {
  const p = `heatbooster_${h.id}`;
  const n = `HeatMeister - ${h.name}`;
  const T = { unit_of_measurement: '°C', device_class: 'temperature', state_class: 'measurement' };
  return [
    [`binary_sensor.${p}_fan_enabled`, h.fan > 0 ? 'on' : 'off', { friendly_name: `${n} Fan status`, device_class: 'running' }],
    [`number.${p}_ambientcontrol_temp`, h.roomTarget, { friendly_name: `${n} Room temperature target`, min: 14, max: 26, step: 0.5, ...T }],
    [`number.${p}_ambientcontrol_temp_trim`, 0, { friendly_name: `${n} Room temperature trim`, min: -10, max: 10, step: 0.1, ...T }],
    [`number.${p}_fan_speed`, h.fan, { friendly_name: `${n} Fan speed`, min: 0, max: 100, step: 1, unit_of_measurement: '%' }],
    [`sensor.${p}_demand_trim`, '0.00', { friendly_name: `${n} Demand trim`, ...T }],
    [`sensor.${p}_fan_control_state`, h.state, { friendly_name: `${n} Control state`, device_class: 'enum', options: ['idle', 'overrun', 'manual', 'heat', 'defrost', 'startup', 'cool', 'slave', 'sensor_error'] }],
    [`sensor.${p}_ip`, '192.168.1.167', { friendly_name: `${n} IP address` }],
    [`sensor.${p}_rssi`, -74, { friendly_name: `${n} WiFi signal strength`, unit_of_measurement: 'dB', device_class: 'signal_strength' }],
    [`sensor.${p}_temp_ambient`, h.room, { friendly_name: `${n} Room temperature`, ...T }],
    [`sensor.${p}_temp_delta_io`, Math.round((h.inlet - h.outlet) * 100) / 100, { friendly_name: `${n} Water temperature difference`, ...T }],
    [`sensor.${p}_temp_inlet`, h.inlet, { friendly_name: `${n} Water inlet temperature`, ...T }],
    [`sensor.${p}_temp_inlet_rate`, -0.02, { friendly_name: `${n} Inlet temperature rate of change`, unit_of_measurement: '°C/min' }],
    [`sensor.${p}_temp_outlet`, h.outlet, { friendly_name: `${n} Water outlet temperature`, ...T }],
    [`switch.${p}_ambientcontrol_enable`, h.roomControl ? 'on' : 'off', { friendly_name: `${n} Room temperature control` }],
    [`switch.${p}_fan_boostmode`, 'off', { friendly_name: `${n} Boost mode` }],
    [`switch.${p}_fan_controlmode`, 'off', { friendly_name: `${n} Manual control` }],
  ];
}

function states() {
  const w = world;
  const list = [
    climate('climate.tado_smart_thermostat_ru3010610432', 'tado Smart Thermostat RU3010610432', w, w.homekitAvailable),
    climate('climate.verwarming', 'Verwarming', w),
    ...personStates('peter', 'Peter', w),
    ...personStates('yvonne', 'Yvonne', w),
    ...personStates('cheyenne', 'Cheyenne', w),
    ['sensor.tado_smart_thermostat_ru3010610432_current_temperature', String(w.room), { friendly_name: 'tado Smart Thermostat RU3010610432 Current Temperature', unit_of_measurement: '°C', device_class: 'temperature' }],
    ['sensor.woonkamer_temp_hum_temperature', String(w.room), { friendly_name: 'Woonkamer_temp_hum Temperature', unit_of_measurement: '°C', device_class: 'temperature' }],
    ['fan.p1s_aux_fan', 'unavailable', { friendly_name: 'p1s_aux_fan' }],
    ['zone.home', '1', { friendly_name: 'Home', latitude: HOME.lat, longitude: HOME.lon, radius: 100 }],
    ['zone.werk', '0', { friendly_name: 'Werk', latitude: 51.81, longitude: 4.67, radius: 200 }],
  ];
  for (const h of w.hm) list.push(...heatmeisterStates(h));
  const now = new Date().toISOString();
  return list.map(([entity_id, state, attributes]) => ({ entity_id, state: String(state), attributes, last_changed: now, last_updated: now, context: { id: 'x' } }));
}

function registries() {
  const entities = [
    { entity_id: 'climate.tado_smart_thermostat_ru3010610432', platform: 'homekit_controller', device_id: 'dev_tado_hk' },
    { entity_id: 'climate.verwarming', platform: 'tado_ce', device_id: 'dev_tado_cloud' },
  ];
  const devices = [
    { id: 'dev_tado_hk', manufacturer: 'tado', model: 'Smart Thermostat', name: 'tado Smart Thermostat' },
    { id: 'dev_tado_cloud', manufacturer: 'tado', model: 'RU02', name: 'Verwarming' },
  ];
  return { entities, devices };
}

function start(port = 0) {
  return new Promise((resolve) => {
    const wss = new WebSocket.Server({ port, host: '127.0.0.1' }, () => resolve({ wss, port: wss.address().port, url: `ws://127.0.0.1:${wss.address().port}` }));
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'auth_required', ha_version: HA_VERSION }));
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'auth') {
          ws.send(JSON.stringify(msg.access_token === 'test-token'
            ? { type: 'auth_ok', ha_version: HA_VERSION }
            : { type: 'auth_invalid', message: 'Invalid access token' }));
          return;
        }
        calls.push(msg);
        const ok = (result) => ws.send(JSON.stringify({ id: msg.id, type: 'result', success: true, result }));
        if (msg.type === 'get_states') return ok(states());
        if (msg.type === 'get_config') return ok({ time_zone: TZ, version: HA_VERSION, unit_system: { temperature: '°C' } });
        if (msg.type === 'config/entity_registry/list') return ok(registries().entities);
        if (msg.type === 'config/device_registry/list') return ok(registries().devices);
        // The thermostat's target. world.failWrites makes it fail.
        if (msg.type === 'call_service' && msg.domain === 'climate' && msg.service === 'set_temperature') {
          if (world.failWrites) return ws.send(JSON.stringify({ id: msg.id, type: 'result', success: false, error: { code: 'home_assistant_error', message: 'Thermostat did not answer' } }));
          world.target = Number(msg.service_data.temperature);
          return ok({ context: { id: 'x' } });
        }
        if (msg.type === 'call_service' && msg.domain === 'mqtt' && msg.service === 'publish') {
          if (world.failMqtt) return ws.send(JSON.stringify({ id: msg.id, type: 'result', success: false, error: { code: 'home_assistant_error', message: 'MQTT is not connected' } }));
          (world.mqtt[msg.service_data.topic] = world.mqtt[msg.service_data.topic] || []).push(msg.service_data.payload);
          return ok({ context: { id: 'x' } });
        }
        return ws.send(JSON.stringify({ id: msg.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } }));
      });
    });
  });
}

function reset() {
  Object.assign(world, freshWorld());
  calls.length = 0;
}

module.exports = { start, world, calls, reset, states, registries, north, HOME, TZ };
