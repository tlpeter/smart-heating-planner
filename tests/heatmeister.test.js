'use strict';

// HeatMeisters: found by their entity names, and read (never controlled).

const test = require('node:test');
const assert = require('node:assert/strict');
const hm = require('../smart_heating_planner/app/heatmeister');
const fakeHa = require('./fake-ha');

test.beforeEach(() => fakeHa.reset());

test('the three HeatMeisters are found, with readable names', () => {
  const list = hm.discover(fakeHa.states());
  assert.deepEqual(list.map((d) => d.prefix), ['heatbooster_eetkamer', 'heatbooster_keuken', 'heatbooster_woonkamer_garage']);
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

test('running while heating or in overrun', () => {
  fakeHa.world.hm[0].state = 'heat';
  fakeHa.world.hm[0].fan = 45;
  assert.equal(hm.read(fakeHa.states(), 'heatbooster_woonkamer_garage').running, true);
  fakeHa.world.hm[0].state = 'overrun';
  assert.equal(hm.read(fakeHa.states(), 'heatbooster_woonkamer_garage').running, true);
});

test('unknown prefix or unavailable device', () => {
  assert.equal(hm.read(fakeHa.states(), 'heatbooster_nope').available, false);
  const states = fakeHa.states().map((s) => (s.entity_id.includes('keuken') ? { ...s, state: 'unavailable' } : s));
  assert.equal(hm.read(states, 'heatbooster_keuken').available, false);
});

test('newer "heatmeister_" names work too', () => {
  const states = [
    { entity_id: 'sensor.heatmeister_zolder_temp_inlet', state: '30', attributes: { friendly_name: 'HeatMeister - Zolder Water inlet temperature' } },
    { entity_id: 'sensor.heatmeister_zolder_fan_control_state', state: 'heat', attributes: { friendly_name: 'HeatMeister - Zolder Control state' } },
  ];
  const [d] = hm.discover(states);
  assert.equal(d.name, 'Zolder');
  assert.equal(hm.read(states, 'heatmeister_zolder').running, true);
});
