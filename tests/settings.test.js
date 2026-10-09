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

test('entities: HomeKit thermostat first, three persons with trackers, three HeatMeisters', async () => {
  const { data } = await req('GET', '/api/entities');
  assert.equal(data.thermostats[0].entity_id, 'climate.tado_smart_thermostat_ru3010610432');
  assert.equal(data.thermostats.find((t) => t.entity_id === 'climate.verwarming').cloud, true);
  assert.equal(data.persons.length, 3);
  assert.equal(data.persons.find((p) => p.entity_id === 'person.peter').trackers.length, 3);
  assert.equal(data.heatmeisters.length, 3);
});

test('settings are saved', async () => {
  const r = await save({
    thermostat: 'climate.tado_smart_thermostat_ru3010610432',
    persons: ['peter', 'yvonne', 'cheyenne'].map((n) => ({ entity_id: `person.${n}`, counts: true, coming_home: true })),
    tracker_types: { gps: true, router: true, bluetooth: false },
    away_temp: 16,
    away_delay_minutes: 0,
    coming_home_km: 10,
    heatmeisters: [{ prefix: 'heatbooster_woonkamer_garage', name: 'Woonkamer-garage' }, { prefix: 'heatbooster_woonkamer_voor', name: 'Woonkamer-voor' }, { prefix: 'heatbooster_woonkamer_gang', name: 'Woonkamer-gang', topic: 'woonkamer-gang/temp-ambient-ext' }],
    schedule: flat(20.5),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = await status();
  assert.deepEqual(s.setup, { thermostat: true, persons: 3, heatmeisters: 3 });
  const saved = (await req('GET', '/api/settings')).data;
  assert.equal(saved.tracker_types.bluetooth, false);
  assert.equal(saved.persons[0].coming_home, true);
  assert.equal(saved.heatmeisters[0].topic, 'Woonkamer-garage/temp-ambient-ext', 'default topic from the name');
  assert.equal(saved.heatmeisters[2].topic, 'woonkamer-gang/temp-ambient-ext', 'own topic kept');
  assert.equal(saved.schedule_needs_presence, true);
});

test('wrong settings are refused with a clear message', async () => {
  const cases = [
    { thermostat: 'sensor.not_a_climate' },
    { persons: ['light.kitchen'] },
    { away_temp: 40 },
    { heatmeisters: [{ prefix: 'climate.tado' }] },
    { schedule: { mon: [{ time: '7 uur', temp: 20 }] } },
    { coming_home_km: 0 },
    { tracker_types: { gps: false, router: false, bluetooth: false } },
    { manual_change_until: 'forever' },
    { heatmeisters: [{ prefix: 'heatbooster_woonkamer_garage', name: 'x', topic: 'Woonkamer-garage/#' }] },
    { room_temperature_source: 'climate.verwarming' },
    { room_temperature_interval: 0 },
    { heatmeister_send: 'both' },
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

test('coming home (GPS, within 10 km and getting closer): the schedule', async () => {
  fakeHa.world.pos.peter = fakeHa.north(14);
  await refreshed();
  fakeHa.world.pos.peter = fakeHa.north(7);
  const s = await refreshed();
  assert.equal(s.advice.source, 'approaching');
  assert.equal(s.advice.target, 20.5);
  assert.equal(s.presence.onTheWay.find((p) => p.entity_id === 'person.peter').towards, true);
  fakeHa.world.pos.peter = fakeHa.north(12); // turned around
  assert.equal((await refreshed()).advice.source, 'away');
  delete fakeHa.world.pos.peter;
});

test('coming home off for a person: their approach is ignored', async () => {
  await save({ persons: [{ entity_id: 'person.peter', counts: true, coming_home: false }, { entity_id: 'person.yvonne', counts: true, coming_home: true }, { entity_id: 'person.cheyenne', counts: true, coming_home: true }] });
  fakeHa.world.pos.peter = fakeHa.north(9);
  await refreshed();
  fakeHa.world.pos.peter = fakeHa.north(5);
  assert.equal((await refreshed()).advice.source, 'away');
  delete fakeHa.world.pos.peter;
  await save({ persons: ['peter', 'yvonne', 'cheyenne'].map((n) => ({ entity_id: `person.${n}`, counts: true, coming_home: true })) });
});

test('Bluetooth does not count: a watch at home does not make Peter home', async () => {
  fakeHa.world.bluetooth.peter = 'home';
  assert.equal((await refreshed()).advice.source, 'away');
  await save({ tracker_types: { gps: true, router: true, bluetooth: true } });
  assert.equal((await status()).advice.source, 'schedule');
  await save({ tracker_types: { gps: true, router: true, bluetooth: false } });
  delete fakeHa.world.bluetooth.peter;
});

test('a person who does not count: home, but the house still counts as empty', async () => {
  await save({ persons: [{ entity_id: 'person.peter', counts: true, coming_home: true }, { entity_id: 'person.yvonne', counts: true, coming_home: true }, { entity_id: 'person.cheyenne', counts: false, coming_home: false }] });
  fakeHa.world.persons.cheyenne = 'home';
  const s = await refreshed();
  assert.equal(s.advice.source, 'away');
  assert.equal(s.presence.people.find((p) => p.entity_id === 'person.cheyenne').counts, false);
  fakeHa.world.persons.cheyenne = 'not_home';
  await save({ persons: ['peter', 'yvonne', 'cheyenne'].map((n) => ({ entity_id: `person.${n}`, counts: true, coming_home: true })) });
});

test('option "schedule only when someone is home" off: always the schedule', async () => {
  let s = await refreshed();
  assert.equal(s.advice.source, 'away');
  await save({ schedule_needs_presence: false });
  s = await status();
  assert.equal(s.advice.source, 'schedule');
  assert.match(s.advice.reason, /presence is not used/);
  await save({ schedule_needs_presence: true });
  assert.equal((await status()).advice.source, 'away');
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
  fakeHa.world.router.cheyenne = 'unknown';
  const s = await refreshed();
  assert.equal(s.advice.source, 'schedule');
  assert.equal(s.presence.unknown.length, 1);
  fakeHa.world.persons.cheyenne = 'not_home';
  delete fakeHa.world.router.cheyenne;
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

test('HeatMeisters: their own state is shown, nothing is sent to them', async () => {
  fakeHa.world.hvacAction = 'heating';
  fakeHa.world.hm[0].state = 'heat';
  fakeHa.world.hm[0].fan = 55;
  fakeHa.world.hm[0].inlet = 48.5;
  const s = await refreshed();
  assert.equal(s.demand, true);
  const wg = s.heatmeisters.find((h) => h.prefix === 'heatbooster_woonkamer_garage');
  assert.equal(wg.name, 'Woonkamer-garage');
  assert.equal(wg.running, true);
  assert.equal(wg.fan_speed, 55);
  assert.equal(wg.inlet, 48.5);
  assert.equal(wg.room_control, true);
  assert.equal(s.heatmeisters.find((h) => h.prefix === 'heatbooster_woonkamer_gang').running, false);
  fakeHa.world.hvacAction = 'idle';
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
  assert.ok(!/person\.peter|device_tracker\.peter/.test(text));
  assert.ok(!/Werk/.test(text), 'a place is in the diagnostics');
  assert.ok(!/test-token/.test(text));
});

test('large or broken requests are refused', async () => {
  const big = await fetch(`${BASE}/api/settings`, { method: 'POST', body: 'x'.repeat(200000) }).catch(() => ({ status: 413 }));
  assert.ok([400, 413].includes(big.status));
  const broken = await fetch(`${BASE}/api/settings`, { method: 'POST', body: '{nope' });
  assert.equal(broken.status, 400);
  assert.equal((await req('GET', '/api/nope')).status, 404);
});

test('the temperature for the HeatMeisters (setpoint) is shown, but not sent while its option is off', async () => {
  const s = await refreshed();
  assert.equal(s.roomTemperature.allowed, false);
  assert.equal(s.roomTemperature.send, 'setpoint');
  assert.equal(s.roomTemperature.value, s.thermostat.target);
  assert.deepEqual(fakeHa.world.mqtt, {});
});

test('SAFETY: with "Allow control" off the app only sent read-only commands', () => {
  const types = new Set(fakeHa.calls.map((c) => c.type));
  for (const t of types) assert.ok(READ_ONLY_COMMANDS.has(t), `the app sent ${t}`);
  assert.ok(!fakeHa.calls.some((c) => c.type === 'call_service'));
});
