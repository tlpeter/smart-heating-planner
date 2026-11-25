'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../smart_heating_planner/app/sensor-discovery');
const { fixture, selected } = require('./discovery-fixture');
const now = Date.parse('2026-11-25T10:00:00Z');
const roles = (f, selections = {}) => d.suggest(d.discover(f.states, f.entities, f.devices, d.selections(selections), 'climate.test', now));
test('metadata, device links, units and role meaning produce generic suggestions', () => {
  for (const role of roles(fixture(now))) assert.equal(role.suggested, selected[role.key], role.key);
});
test('multiple equally suitable rooms require a user choice; thermostat links disambiguate', () => {
  const f = fixture(now);
  f.states.push({ ...f.states[0], entity_id: 'sensor.bedroom_temperature', attributes: { ...f.states[0].attributes, friendly_name: 'Bedroom room temperature' } });
  assert.equal(roles(f)[0].suggested, selected.indoor);
  f.entities = [];
  assert.equal(roles(f)[0].suggested, null);
});
test('gas flow, kWh, binary heating, wrong classes and unrelated percentages are rejected', () => {
  const f = fixture(now);
  f.states[3].attributes.state_class = 'measurement';
  assert.equal(roles(f).find((r) => r.key === 'gas').suggested, null);
  f.states[3].attributes.unit_of_measurement = 'kWh';
  f.states[2].attributes.unit_of_measurement = '';
  f.states.push({ ...f.states[2], entity_id: 'sensor.heating_fan', attributes: { unit_of_measurement: '%', friendly_name: 'Heating fan speed' } });
  assert.equal(roles(f).find((r) => r.key === 'heating_demand').suggested, null);
  f.states[2].attributes.unit_of_measurement = '%';
  f.states[2].attributes.device_class = 'humidity';
  assert.equal(roles(f).find((r) => r.key === 'heating_demand').suggested, null);
});
test('unavailable, nonnumeric, stale and wrong-unit selections remain visible with checks', () => {
  const f = fixture(now);
  f.states[0].state = 'unavailable';
  f.states[1].attributes.unit_of_measurement = '°F';
  f.states[2].last_reported = new Date(now - 3600000).toISOString();
  const r = roles(f, selected);
  assert.equal(r[0].candidates[0].available, false);
  assert.equal(r[1].candidates[0].compatible, false);
  assert.equal(r[2].candidates[0].liveFresh, false);
  assert.equal(roles(f, { indoor: 'sensor.deleted' })[0].candidates.at(-1).exists, false);
});
test('wrong semantic temperature roles and disabled entities cannot be suggested', () => {
  const f = fixture(now);
  f.states[0].attributes.friendly_name = 'DHW hot water temperature';
  f.entities.find((e) => e.entity_id === selected.outdoor).disabled_by = 'user';
  assert.equal(roles(f)[0].suggested, null);
  assert.equal(roles(f)[1].suggested, null);
});
test('history checks distinguish absence, short history, stale history, gaps and gas resets', () => {
  const f = fixture(now);
  assert.equal(d.inspect({}, selected.indoor, now, 'indoor').status, 'no_history');
  const short = { [selected.indoor]: f.history[selected.indoor].slice(-2) };
  assert.equal(d.inspect(short, selected.indoor, now, 'indoor').status, 'insufficient_history');
  assert.equal(d.inspect(f.history, selected.indoor, now, 'indoor').status, 'usable_history');
  assert.equal(d.inspect(f.history, selected.indoor, now + 3600000, 'indoor').status, 'stale_history');
  f.history[selected.indoor].splice(10, 5);
  assert.equal(d.inspect(f.history, selected.indoor, now, 'indoor').status, 'history_gaps');
  f.history[selected.gas].at(-1).s = '0';
  assert.equal(d.inspect(f.history, selected.gas, now, 'gas').status, 'meter_reset');
});
test('scans are bounded and cached, preserve manual choices and test paired learning readiness', async () => {
  const ha = require('../smart_heating_planner/app/ha'); const original = ha.call;
  const f = fixture(now); let calls = 0;
  ha.call = async (message) => {
    if (message.type === 'get_states') return f.states;
    if (message.type === 'config/entity_registry/list') return f.entities;
    if (message.type === 'config/device_registry/list') return f.devices;
    assert.equal(message.type, 'history/history_during_period');
    assert.ok(message.entity_ids.length <= d.MAX_HISTORY); calls++; return f.history;
  };
  d.clear();
  try {
    const input = { ...selected };
    const scan = await d.scan(input, 'climate.test', now);
    assert.equal(scan.learning.ready, true);
    assert.deepEqual(input, selected);
    await d.scan(input, 'climate.test', now + 1000); assert.equal(calls, 1);
    f.history[selected.heating_demand].forEach((p) => { p.s = '0'; });
    d.clear(); assert.equal((await d.scan(input, 'climate.test', now)).learning.ready, false);
    ha.call = async (m) => { if (m.type === 'get_states') return f.states; throw new Error('offline'); };
    d.clear(); const failed = await d.scan(input, 'climate.test', now);
    assert.ok(failed.warnings.length); assert.match(failed.error, /Recorder unavailable/);
    assert.equal(failed.roles[0].candidates[0].history.status, 'recorder_error');
    assert.equal(failed.learning.ready, false);
  } finally { ha.call = original; d.clear(); }
});
test('malformed selections are rejected and large installations have bounded candidate lists', () => {
  for (const v of [[], null, { indoor: 'climate.bad' }, { gas: 'sensor.bad?id=1' }]) assert.throws(() => d.selections(v));
  const f = fixture(now);
  for (let i = 0; i < 200; i++) f.states.push({ ...f.states[0], entity_id: `sensor.room_${i}` });
  assert.ok(roles(f)[0].candidates.length <= 20);
});
