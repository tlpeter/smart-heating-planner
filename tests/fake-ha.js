'use strict';

// A small fake Home Assistant for the tests: the WebSocket API the app uses.
// The house: a tado V3 thermostat twice (local through HomeKit, and through
// the tado cloud with Tado CE), three persons with the Companion App, the
// Proximity integration, and three Heatmeisters through MQTT (SDR
// Engineering). Change `world` to change the house. Every command the app
// sends is recorded in `calls`; the tests check that nothing writes.

const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'smart_heating_planner', 'app', 'node_modules', 'ws'));

const HA_VERSION = process.env.SHP_HA_VERSION || '2026.10.0';
const TZ = 'Europe/Amsterdam';

function freshWorld() {
  return {
    room: 19.4,
    target: 19,
    hvacAction: 'idle',
    homekitAvailable: true,
    persons: { peter: 'home', yvonne: 'not_home', cheyenne: 'not_home' },
    distanceKm: 0,
    direction: 'arrived',
    hm: [
      { id: 'woonkamer', name: 'Woonkamer', on: false, inlet: 24 },
      { id: 'keuken', name: 'Keuken', on: false, inlet: 23 },
      { id: 'slaapkamer', name: 'Slaapkamer', on: false, inlet: 22 },
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

function states() {
  const w = world;
  const list = [
    climate('climate.tado_smart_thermostat_ru3010610432', 'tado Smart Thermostat RU3010610432', w, w.homekitAvailable),
    climate('climate.verwarming', 'Verwarming', w),
    ['person.peter', w.persons.peter, { friendly_name: 'Peter', source: 'device_tracker.pixel_peter' }],
    ['person.yvonne', w.persons.yvonne, { friendly_name: 'Yvonne' }],
    ['person.cheyenne', w.persons.cheyenne, { friendly_name: 'Cheyenne' }],
    ['sensor.home_nearest_distance', String(w.distanceKm), { friendly_name: 'Home Nearest distance', unit_of_measurement: 'km', device_class: 'distance' }],
    ['sensor.home_nearest_direction_of_travel', w.direction, { friendly_name: 'Home Nearest direction of travel', device_class: 'enum' }],
    ['sensor.woonkamer_temperature', String(w.room), { friendly_name: 'Woonkamer temperature', unit_of_measurement: '°C', device_class: 'temperature' }],
    ['fan.bambu_p1s_aux_fan', 'unavailable', { friendly_name: 'p1s_aux_fan' }],
    ['zone.home', '1', { friendly_name: 'Home', latitude: 51.37, longitude: 5.19 }],
  ];
  for (const h of w.hm) {
    list.push([`fan.heatmeister_${h.id}`, h.on ? 'on' : 'off', { friendly_name: `Heatmeister ${h.name}`, percentage: h.on ? 60 : 0 }]);
    list.push([`sensor.heatmeister_${h.id}_inlet_temperature`, String(h.inlet), { friendly_name: `Heatmeister ${h.name} Inlet temperature`, unit_of_measurement: '°C', device_class: 'temperature' }]);
    list.push([`sensor.heatmeister_${h.id}_room_temperature`, String(w.room), { friendly_name: `Heatmeister ${h.name} Room temperature`, unit_of_measurement: '°C', device_class: 'temperature' }]);
  }
  const now = new Date().toISOString();
  return list.map(([entity_id, state, attributes]) => ({ entity_id, state: String(state), attributes, last_changed: now, last_updated: now, context: { id: 'x' } }));
}

function registries() {
  const entities = [
    { entity_id: 'climate.tado_smart_thermostat_ru3010610432', platform: 'homekit_controller', device_id: 'dev_tado_hk' },
    { entity_id: 'climate.verwarming', platform: 'tado_ce', device_id: 'dev_tado_cloud' },
    { entity_id: 'sensor.home_nearest_distance', platform: 'proximity', device_id: null },
    { entity_id: 'sensor.home_nearest_direction_of_travel', platform: 'proximity', device_id: null },
  ];
  const devices = [
    { id: 'dev_tado_hk', manufacturer: 'tado', model: 'Smart Thermostat', name: 'tado Smart Thermostat' },
    { id: 'dev_tado_cloud', manufacturer: 'tado', model: 'RU02', name: 'Verwarming' },
  ];
  for (const h of world.hm) {
    devices.push({ id: `dev_hm_${h.id}`, manufacturer: 'SDR Engineering', model: 'HeatMeister', name: `HM ${h.name}` });
    for (const e of [`fan.heatmeister_${h.id}`, `sensor.heatmeister_${h.id}_inlet_temperature`, `sensor.heatmeister_${h.id}_room_temperature`]) {
      entities.push({ entity_id: e, platform: 'mqtt', device_id: `dev_hm_${h.id}` });
    }
  }
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
        return ws.send(JSON.stringify({ id: msg.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } }));
      });
    });
  });
}

function reset() {
  Object.assign(world, freshWorld());
  calls.length = 0;
}

module.exports = { start, world, calls, reset, states, registries, TZ };
