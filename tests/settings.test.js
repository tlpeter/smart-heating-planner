'use strict';

// The real app against a fake Home Assistant (tests/fake-ha.js), used through
// the same API as the page, with "Allow control" OFF (the default). Checks
// what is saved, what is refused, what the advice is in each situation, and
// that the app never sends anything that writes to Home Assistant.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fakeHa = require('./fake-ha');
const { startApp, APP } = require('./app-runner');

const PORT = Number(process.env.SHP_TEST_PORT) || 18199;
const BASE = `http://127.0.0.1:${PORT}`;
const { READ_ONLY_COMMANDS } = require(path.join(APP, 'ha.js'));

let app;
const req = (...a) => app.req(...a);
const status = async () => (await req('GET', '/api/status')).data;
const save = (body) => req('POST', '/api/settings', body);
// One switch point all week: the advice does not depend on the clock.
const flat = (temp, preheat = false) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ time: '00:00', temp, preheat }]]));

test.before(async () => { app = await startApp({ port: PORT }); });
test.after(() => { if (app) app.stop(); });

test('fresh install: connected, nothing chosen, setup hint data', async () => {
  const s = await status();
  assert.equal(s.connected, true);
  assert.equal(s.mode, 'watch');
  assert.equal(s.control.allowed, false);
  assert.deepEqual(s.setup, { thermostat: false, persons: 0, heatmeisters: 0 });
  assert.equal(s.presence.noPersons, true);
  assert.equal(s.advice.source, 'schedule');
});

test('entities: HomeKit thermostat first, three persons, three Heatmeisters', async () => {
  const { data } = await req('GET', '/api/entities');
  assert.equal(data.thermostats[0].entity_id, 'climate.tado_smart_thermostat_ru3010610432');
  assert.equal(data.thermostats.find((t) => t.entity_id === 'climate.verwarming').cloud, true);
  assert.equal(data.persons.length, 3);
  assert.equal(data.controls.filter((c) => c.heatmeister).length, 3);
  assert.equal(data.temperatures.filter((c) => c.heatmeister).length, 6);
});

test('settings are saved', async () => {
  const r = await save({
    thermostat: 'climate.tado_smart_thermostat_ru3010610432',
    persons: ['person.peter', 'person.yvonne', 'person.cheyenne'],
    away_temp: 16,
    away_delay_minutes: 0,
    proximity: { distance_entity: 'sensor.home_nearest_distance', direction_entity: 'sensor.home_nearest_direction_of_travel', distance_km: 10 },
    heatmeisters: ['woonkamer', 'keuken', 'slaapkamer'].map((id) => ({ name: id, control_entity: `fan.heatmeister_${id}`, inlet_entity: `sensor.heatmeister_${id}_inlet_temperature` })),
    heatmeister_rule: { mode: 'both', inlet_on: 35, inlet_off: 30 },
    schedule: flat(20.5),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = await status();
  assert.deepEqual(s.setup, { thermostat: true, persons: 3, heatmeisters: 3 });
});

test('wrong settings are refused with a clear message', async () => {
  const cases = [
    { thermostat: 'sensor.not_a_climate' },
    { persons: ['light.kitchen'] },
    { away_temp: 40 },
    { heatmeister_rule: { mode: 'both', inlet_on: 30, inlet_off: 35 } },
    { heatmeisters: [{ name: 'x', control_entity: 'climate.tado' }] },
    { schedule: { mon: [{ time: '7 uur', temp: 20 }] } },
    { proximity: { distance_entity: 'person.peter', distance_km: 10 } },
  ];
  for (const body of cases) {
    const r = await save(body);
    assert.equal(r.status, 400, `accepted: ${JSON.stringify(body)}`);
    assert.ok(r.data.error);
  }
  const bad = await fetch(`${BASE}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[1,2]' });
  assert.equal(bad.status, 400);
  const settings = (await req('GET', '/api/settings')).data;
  assert.equal(settings.away_temp, 16);
});

test('someone home: the schedule; the thermostat would change', async () => {
  fakeHa.world.persons = { peter: 'home', yvonne: 'not_home', cheyenne: 'not_home' };
  const s = await refreshed();
  assert.equal(s.advice.target, 20.5);
  assert.equal(s.advice.source, 'schedule');
  assert.equal(s.advice.change, true);
  assert.equal(s.presence.home.length, 1);
});

// Saving an empty object triggers a refresh; then read the status.
async function refreshed() {
  await save({});
  return status();
}

test('everybody leaves: away temperature', async () => {
  fakeHa.world.persons = { peter: 'not_home', yvonne: 'Werk', cheyenne: 'not_home' };
  fakeHa.world.distanceKm = 30;
  fakeHa.world.direction = 'away_from';
  const s = await refreshed();
  assert.equal(s.advice.target, 16);
  assert.equal(s.advice.source, 'away');
});

test('away delay: first wait, then lower', async () => {
  await save({ away_delay_minutes: 10 });
  fakeHa.world.persons.peter = 'home';
  await refreshed();
  fakeHa.world.persons.peter = 'not_home';
  const s = await refreshed();
  assert.equal(s.advice.source, 'schedule');
  assert.ok(s.presence.waitingUntil > Date.now());
  await save({ away_delay_minutes: 0 });
  assert.equal((await refreshed()).advice.source, 'away');
});

test('on the way home within 10 km: the schedule', async () => {
  fakeHa.world.distanceKm = 7;
  fakeHa.world.direction = 'towards';
  const s = await refreshed();
  assert.equal(s.advice.source, 'approaching');
  assert.equal(s.advice.target, 20.5);
  fakeHa.world.direction = 'stationary';
  assert.equal((await refreshed()).advice.source, 'away');
});

test('preheat switch point: heat even when nobody is home', async () => {
  await save({ schedule: flat(21, true) });
  const s = await status();
  assert.equal(s.advice.source, 'preheat');
  assert.equal(s.advice.target, 21);
  await save({ schedule: flat(20.5) });
});

test('location unknown counts as home', async () => {
  fakeHa.world.persons.cheyenne = 'unknown';
  const s = await refreshed();
  assert.equal(s.advice.source, 'schedule');
  assert.equal(s.presence.unknown.length, 1);
  fakeHa.world.persons.cheyenne = 'not_home';
});

test('manual hold: wins, then ends', async () => {
  let r = await req('POST', '/api/hold', { temp: 22, minutes: 60 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.advice.source, 'hold');
  assert.equal(r.data.advice.target, 22);
  r = await req('POST', '/api/hold', { temp: 21, until: 'next' });
  assert.equal(r.status, 200);
  assert.ok(r.data.hold.until > Date.now());
  r = await req('POST', '/api/hold', { temp: 50, minutes: 60 });
  assert.equal(r.status, 400);
  r = await req('DELETE', '/api/hold');
  assert.equal(r.data.hold, null);
  assert.notEqual(r.data.advice.source, 'hold');
});

test('Heatmeisters: run on heat demand and while the radiator is warm', async () => {
  fakeHa.world.hvacAction = 'heating';
  let s = await refreshed();
  assert.equal(s.demand, true);
  assert.ok(s.heatmeisters.every((h) => h.advice === true));
  fakeHa.world.hvacAction = 'idle';
  fakeHa.world.hm[0].inlet = 45;
  s = await refreshed();
  assert.deepEqual(s.heatmeisters.map((h) => h.advice), [true, false, false]);
  fakeHa.world.hm[0].inlet = 32; // between off (30) and on (35): stays on
  s = await refreshed();
  assert.equal(s.heatmeisters[0].advice, true);
  fakeHa.world.hm[0].inlet = 25;
  s = await refreshed();
  assert.equal(s.heatmeisters[0].advice, false);
});

test('thermostat unavailable: no change advised, the page still works', async () => {
  fakeHa.world.homekitAvailable = false;
  const s = await refreshed();
  assert.equal(s.thermostat.available, false);
  assert.equal(s.advice.change, false);
  fakeHa.world.homekitAvailable = true;
});

test('activity: one line per change, never "sent"', async () => {
  const { data } = await req('GET', '/api/activity');
  assert.ok(data.length >= 5);
  assert.ok(data.every((r) => r.sent === false && r.event === 'advice'));
});

test('diagnostics: download without names of persons', async () => {
  const r = await req('GET', '/api/diagnostics');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment/);
  const text = JSON.stringify(r.data);
  assert.ok(!/Peter|Yvonne|Cheyenne/.test(text), 'a name is in the diagnostics');
  assert.ok(!/person\.peter/.test(text));
  assert.ok(!/test-token/.test(text));
});

test('large or broken requests are refused', async () => {
  const big = await fetch(`${BASE}/api/settings`, { method: 'POST', body: 'x'.repeat(200000) }).catch(() => ({ status: 413 }));
  assert.ok([400, 413].includes(big.status));
  const broken = await fetch(`${BASE}/api/settings`, { method: 'POST', body: '{nope' });
  assert.equal(broken.status, 400);
  assert.equal((await req('GET', '/api/nope')).status, 404);
});

test('SAFETY: with "Allow control" off the app only sent read-only commands', () => {
  const types = new Set(fakeHa.calls.map((c) => c.type));
  for (const t of types) assert.ok(READ_ONLY_COMMANDS.has(t), `the app sent ${t}`);
  assert.ok(!fakeHa.calls.some((c) => c.type === 'call_service'));
});
