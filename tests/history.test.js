'use strict';

// The chart on Home: turning Home Assistant's history into lines.

const test = require('node:test');
const assert = require('node:assert/strict');
const history = require('../smart_heating_planner/app/history');

const H = 3600000;
const from = Date.UTC(2026, 9, 9, 8);
const to = from + 24 * H;

test('room temperature and setpoint come from the thermostat\'s attributes', () => {
  const climate = { 'climate.t': [
    { s: 'heat', a: { current_temperature: 19.4, temperature: 19 }, lu: (from - H) / 1000 },
    { s: 'heat', a: { current_temperature: 19.8, temperature: 20 }, lu: (from + 2 * H) / 1000 },
    { s: 'unavailable', a: {}, lu: (from + 3 * H) / 1000 },
    { s: 'heat', a: { current_temperature: 20.1, temperature: 20 }, lu: (from + 4 * H) / 1000 },
  ] };
  const d = history.build(climate, {}, { thermostat: 'climate.t', chart_sensors: [] }, {}, from, to);
  const room = d.series.find((x) => x.id === 'room').points;
  const sp = d.series.find((x) => x.id === 'setpoint').points;
  assert.deepEqual(room[0], [from, 19.4], 'an older value starts at the left edge');
  assert.deepEqual(sp, [[from, 19], [from + 2 * H, 20], [from + 3 * H, null], [from + 4 * H, 20]], 'unavailable is a gap');
  assert.equal(room.at(-1)[1], 20.1);
});

test('sensors: their state, with their name; no thermostat: only the sensors', () => {
  const sensors = { 'sensor.a': [{ s: '18.5', lu: from / 1000 }, { s: 'unknown', lu: (from + H) / 1000 }, { s: '19', lu: (from + 2 * H) / 1000 }] };
  const d = history.build({}, sensors, { thermostat: '', chart_sensors: ['sensor.a', 'sensor.missing'] }, { 'sensor.a': 'Kitchen' }, from, to);
  assert.deepEqual(d.series.map((x) => x.name), ['Kitchen', 'sensor.missing']);
  assert.deepEqual(d.series[0].points, [[from, 18.5], [from + H, null], [from + 2 * H, 19]]);
  assert.deepEqual(d.series[1].points, []);
});

test('only the changes are kept, and at most 300 points per line', () => {
  assert.deepEqual(history.changes([[1, 19], [2, 19], [3, 20], [4, 20]]), [[1, 19], [3, 20]]);
  const many = Array.from({ length: 2000 }, (_, i) => [from + i * 40000, 18 + (i % 7) / 10]);
  const thin = history.thin(many, from, to);
  assert.ok(thin.length <= history.MAX_POINTS + 1, `${thin.length} points`);
  assert.deepEqual(thin.at(-1), many.at(-1), 'the last value stays');
});

test('the value of now is added at the end when the history does not have it yet', () => {
  const climate = { 'climate.t': [{ s: 'heat', a: { current_temperature: 19.4, temperature: 19 }, lu: from / 1000 }] };
  const current = { 'climate.t': { state: 'heat', attributes: { current_temperature: 20.2, temperature: 20 } }, 'sensor.a': { state: '18.1' } };
  const d = history.build(climate, {}, { thermostat: 'climate.t', chart_sensors: ['sensor.a'] }, {}, from, to, current);
  assert.deepEqual(d.series.find((x) => x.id === 'setpoint').points, [[from, 19], [to, 20]]);
  assert.deepEqual(d.series.find((x) => x.id === 'sensor.a').points, [[to, 18.1]], 'no history yet: only now');
  // The same value: nothing added.
  assert.deepEqual(history.withNow([[from, 19]], 19, to), [[from, 19]]);
});
