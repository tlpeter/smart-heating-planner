'use strict';

// HeatMeisters: found by their entity names, and read (never controlled).

const test = require('node:test');
const assert = require('node:assert/strict');
const hm = require('../smart_heating_planner/app/heatmeister');
const fakeHa = require('./fake-ha');

test.beforeEach(() => fakeHa.reset());

test('the three HeatMeisters are found, with readable names', () => {
  const list = hm.discover(fakeHa.states());
  assert.deepEqual(list.map((d) => d.prefix), ['heatbooster_woonkamer_gang', 'heatbooster_woonkamer_garage', 'heatbooster_woonkamer_voor']);
  assert.equal(list.find((d) => d.prefix === 'heatbooster_woonkamer_garage').name, 'Woonkamer-garage');
});

test('all known parts are recognised, and similar names are not mixed up', () => {
  const d = hm.discover(fakeHa.states()).find((x) => x.prefix === 'heatbooster_woonkamer_garage');
  assert.equal(d.entities.inlet, 'sensor.heatbooster_woonkamer_garage_temp_inlet');
  assert.equal(d.entities.inlet_rate, 'sensor.heatbooster_woonkamer_garage_temp_inlet_rate');
  assert.equal(d.entities.room_target, 'number.heatbooster_woonkamer_garage_ambientcontrol_temp');
  assert.equal(d.entities.fan_on, 'binary_sensor.heatbooster_woonkamer_garage_fan_enabled');
  assert.equal(Object.keys(d.entities).length, Object.keys(hm.PARTS).length);
});

test('reading one: temperatures, fan, room control', () => {
  const r = hm.read(fakeHa.states(), 'heatbooster_woonkamer_garage');
  assert.equal(r.available, true);
  assert.equal(r.control_state, 'idle');
  assert.equal(r.running, false);
  assert.equal(r.inlet, 21.63);
  assert.equal(r.outlet, 21.04);
  assert.equal(r.room, 20.33);
  assert.equal(r.room_control, true);
  assert.equal(r.room_target, 19);
  assert.equal(r.fan_speed, 0);
});

test('running: the fan status and fan speed decide, not the control state', () => {
  fakeHa.world.hm[0].state = 'heat';
  fakeHa.world.hm[0].fan = 45;
  assert.equal(hm.read(fakeHa.states(), 'heatbooster_woonkamer_garage').running, true);
  fakeHa.world.hm[0].state = 'overrun';
  fakeHa.world.hm[0].fan = 0;
  assert.equal(hm.read(fakeHa.states(), 'heatbooster_woonkamer_garage').running, false, 'fan at 0 % is off');
});

test('a "slave" HeatMeister is not running by itself; with own fan data, that decides', () => {
  const voor = () => hm.read(fakeHa.states(), 'heatbooster_woonkamer_voor');
  assert.equal(voor().control_state, 'slave');
  assert.equal(voor().inlet, null, 'no own values, like the real Woonkamer-voor');
  assert.equal(voor().running, false);
  fakeHa.world.hm[1].noData = false;
  fakeHa.world.hm[1].fan = 30;
  assert.equal(voor().running, true);
});

test('a HeatMeister without a control state still shows its values (like Woonkamer-gang)', () => {
  const gang = hm.read(fakeHa.states(), 'heatbooster_woonkamer_gang');
  assert.equal(gang.control_state, null);
  assert.equal(gang.available, true);
  assert.equal(gang.room, 23.2);
  assert.equal(gang.running, false);
});

test('without fan status or fan speed, the control state is used (slave does not count)', () => {
  const only = (state) => [
    { entity_id: 'sensor.heatbooster_x_fan_control_state', state, attributes: { friendly_name: 'HeatMeister - X Control state' } },
  ];
  assert.equal(hm.read(only('heat'), 'heatbooster_x').running, true);
  assert.equal(hm.read(only('slave'), 'heatbooster_x').running, false);
  assert.equal(hm.read(only('idle'), 'heatbooster_x').running, false);
});

test('unknown prefix or unavailable device', () => {
  assert.equal(hm.read(fakeHa.states(), 'heatbooster_nope').available, false);
  const states = fakeHa.states().map((s) => (s.entity_id.includes('woonkamer_gang') ? { ...s, state: 'unavailable' } : s));
  // (all entities of Woonkamer-gang unavailable)
  assert.equal(hm.read(states, 'heatbooster_woonkamer_gang').available, false);
});

test('newer "heatmeister_" names work too', () => {
  const states = [
    { entity_id: 'sensor.heatmeister_zolder_temp_inlet', state: '30', attributes: { friendly_name: 'HeatMeister - Zolder Water inlet temperature' } },
    { entity_id: 'sensor.heatmeister_zolder_fan_control_state', state: 'heat', attributes: { friendly_name: 'HeatMeister - Zolder Control state' } },
  ];
  // (no fan status or speed here, so "heat" counts as running)
  const [d] = hm.discover(states);
  assert.equal(d.name, 'Zolder');
  assert.equal(hm.read(states, 'heatmeister_zolder').running, true);
});

test('the default MQTT topic is "<Name>/temp-ambient-ext", like the Node-RED flow', () => {
  assert.equal(hm.defaultTopic('Woonkamer-garage'), 'Woonkamer-garage/temp-ambient-ext');
});

test('send the room temperature on a change of 0.1 °C, or every few minutes', () => {
  const now = 1_800_000_000_000;
  assert.equal(hm.shouldPublish({ value: 21.4, last: undefined, now, intervalMinutes: 5 }), true);
  assert.equal(hm.shouldPublish({ value: 21.45, last: { value: 21.4, at: now - 60000 }, now, intervalMinutes: 5 }), false);
  assert.equal(hm.shouldPublish({ value: 21.5, last: { value: 21.4, at: now - 60000 }, now, intervalMinutes: 5 }), true);
  assert.equal(hm.shouldPublish({ value: 21.4, last: { value: 21.4, at: now - 5 * 60000 }, now, intervalMinutes: 5 }), true);
  assert.equal(hm.shouldPublish({ value: null, last: undefined, now, intervalMinutes: 5 }), false);
});

test('a new thermostat setpoint sends right away, also when the room temperature is the same', () => {
  const now = 1_800_000_000_000;
  const last = { value: 21.4, at: now - 60000 };
  assert.equal(hm.shouldPublish({ value: 21.4, last, now, intervalMinutes: 5 }), false);
  assert.equal(hm.shouldPublish({ value: 21.4, last, now, intervalMinutes: 5, targetChanged: true }), true);
});
