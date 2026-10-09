'use strict';

// The real app with "Allow control" ON, against the fake Home Assistant.
// Checks that it sets the thermostat when the advice changes, only the chosen
// thermostat and only climate.set_temperature, keeps a change made by hand,
// respects the daily limit, and survives a failing thermostat.
// The waiting times are made short for the test (SHP_GAP_MS, SHP_SETTLE_MS).

const test = require('node:test');
const assert = require('node:assert/strict');
const fakeHa = require('./fake-ha');
const { startApp, sleep } = require('./app-runner');

const PORT = Number(process.env.SHP_CONTROL_TEST_PORT) || 18198;
const GAP = 300;
const SETTLE = 600;
const HOMEKIT = 'climate.tado_smart_thermostat_ru3010610432';

let app;
const req = (...a) => app.req(...a);
const status = async () => (await req('GET', '/api/status')).data;
const save = (body) => req('POST', '/api/settings', body);
const refreshed = async () => { await save({}); return status(); };
const flat = (temp) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ time: '00:00', temp, preheat: false }]]));
const writes = () => fakeHa.calls.filter((c) => c.type === 'call_service');

test.before(async () => {
  app = await startApp({
    port: PORT,
    options: { allow_control: true, max_writes_per_day: 6 },
    env: { SHP_GAP_MS: String(GAP), SHP_SETTLE_MS: String(SETTLE) },
  });
});
test.after(() => { if (app) app.stop(); });

test('control on, but nothing chosen yet: nothing is sent', async () => {
  const s = await status();
  assert.equal(s.mode, 'control');
  assert.equal(writes().length, 0);
});

test('someone home: the thermostat is set to the schedule', async () => {
  fakeHa.world.persons = { peter: 'home', yvonne: 'not_home', cheyenne: 'not_home' };
  const r = await save({
    thermostat: HOMEKIT,
    persons: ['person.peter', 'person.yvonne', 'person.cheyenne'],
    away_delay_minutes: 0,
    manual_change_until: 'minutes',
    hold_default_minutes: 60,
    schedule: flat(20.5),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const w = writes();
  assert.equal(w.length, 1);
  assert.equal(w[0].domain, 'climate');
  assert.equal(w[0].service, 'set_temperature');
  assert.deepEqual(w[0].target, { entity_id: HOMEKIT });
  assert.equal(w[0].service_data.temperature, 20.5);
  assert.equal(fakeHa.world.target, 20.5);
  const s = await status();
  assert.equal(s.control.last.sent, true);
});

test('when it already matches, nothing more is sent', async () => {
  await sleep(GAP + 50);
  const s = await refreshed();
  assert.equal(s.advice.change, false);
  assert.equal(writes().length, 1);
});

test('everybody leaves: away temperature is sent', async () => {
  fakeHa.world.persons = { peter: 'not_home', yvonne: 'not_home', cheyenne: 'not_home' };
  const s = await refreshed();
  assert.equal(s.advice.target, 16);
  assert.equal(fakeHa.world.target, 16);
  assert.equal(writes().length, 2);
});

test('back home within the short wait: not sent yet, then sent', async () => {
  fakeHa.world.persons.yvonne = 'home';
  let s = await refreshed();
  assert.equal(s.advice.target, 20.5);
  assert.equal(writes().length, 2, 'sent too soon after the last write');
  assert.match(s.control.last.why, /waiting/);
  await sleep(GAP + 50);
  s = await refreshed();
  assert.equal(fakeHa.world.target, 20.5);
  assert.equal(writes().length, 3);
});

test('a change by hand on the thermostat is kept as a hold, not overwritten', async () => {
  await sleep(SETTLE + 50);
  fakeHa.world.target = 22; // someone turned the tado up
  const s = await refreshed();
  assert.equal(s.hold.source, 'thermostat');
  assert.equal(s.hold.temp, 22);
  assert.equal(s.advice.source, 'hold');
  assert.equal(s.advice.change, false);
  assert.equal(writes().length, 3, 'the app overwrote a change by hand');
  const act = (await req('GET', '/api/activity')).data;
  assert.equal(act[0].event === 'manual' || act[1].event === 'manual', true);
});

test('ending the hold goes back to the schedule', async () => {
  await sleep(GAP + 50);
  const r = await req('DELETE', '/api/hold');
  assert.equal(r.data.hold, null);
  assert.equal(fakeHa.world.target, 20.5);
  assert.equal(writes().length, 4);
});

test('a failing thermostat: logged, not hammered', async () => {
  await sleep(GAP + 50);
  fakeHa.world.failWrites = true;
  await req('POST', '/api/hold', { temp: 21, minutes: 30 });
  let s = await status();
  assert.ok(s.control.last.error, 'no error shown');
  const before = writes().length;
  s = await refreshed();
  assert.equal(writes().length, before, 'sent again right away after a failure');
  const act = (await req('GET', '/api/activity')).data;
  assert.ok(act.some((a) => a.event === 'error'));
  fakeHa.world.failWrites = false;
});

test('the daily limit stops further writes', async () => {
  // Limit is 6; 5 tries so far (4 sent, 1 failed).
  await sleep(GAP + 50);
  await refreshed(); // 6th: sends 21
  assert.equal(fakeHa.world.target, 21);
  await sleep(GAP + 50);
  await req('DELETE', '/api/hold');
  const s = await status();
  assert.equal(s.advice.change, true);
  assert.match(s.control.last.why, /limit of 6/);
  assert.equal(fakeHa.world.target, 21);
});

test('SAFETY: only climate.set_temperature, only on the chosen thermostat', () => {
  for (const c of writes()) {
    assert.equal(`${c.domain}.${c.service}`, 'climate.set_temperature');
    assert.deepEqual(c.target, { entity_id: HOMEKIT });
    assert.ok(c.service_data.temperature >= 5 && c.service_data.temperature <= 25);
  }
  const other = fakeHa.calls.filter((c) => c.type !== 'call_service').map((c) => c.type);
  assert.ok(other.every((t) => ['get_states', 'get_config', 'config/entity_registry/list', 'config/device_registry/list', 'subscribe_entities', 'unsubscribe_events'].includes(t)));
});
