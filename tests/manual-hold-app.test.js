'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./fake-ha');
const { startApp, sleep } = require('./app-runner');
const { defaults } = require('../smart_heating_planner/app/settings');
const { fixture, selected } = require('./discovery-fixture');
const schedule = require('../smart_heating_planner/app/schedule');
const TH = 'climate.tado_smart_thermostat_ru3010610432';
const flat = (t) => Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map((d) => [d, [{ time: '00:00', temp: t }]]));
let app;
const writes = () => fake.calls.filter((c) => c.type === 'call_service' && c.domain === 'climate');
const refresh = async () => { await app.req('POST', '/api/settings', {}); return (await app.req('GET', '/api/status')).data; };
test.after(() => app && app.stop());
test('startup with an existing manual 21°C target and no prior app command keeps it as a hold', async () => {
  fake.world.target = 21;
  const f = fixture(); fake.world.extraStates = f.states; fake.world.ecoHistory = f.history;
  app = await startApp({ port: 18222, options: { allow_control: true }, env: { SHP_GAP_MS: '100', SHP_SETTLE_MS: '300' },
    initialSettings: { ...defaults(), thermostat: TH, schedule: flat(16), manual_change_until: 'minutes', hold_default_minutes: 60,
      eco: { ...defaults().eco, ...selected, enabled: true, mode: 'adaptive' } } });
  const s = await refresh();
  assert.equal(s.hold.temp, 21); assert.equal(s.hold.source, 'startup');
  assert.equal(s.advice.target, 21); assert.equal(s.eco.active, false);
  assert.equal(writes().length, 0);
  assert.equal((await refresh()).hold.until, s.hold.until, 'do not renew the hold on every refresh');
});
test('ending the hold resumes the plan; Eco cannot overwrite a manual 21°C change during settling', async () => {
  await sleep(350);
  await app.req('DELETE', '/api/hold');
  assert.equal(fake.world.target, 16);
  const count = writes().length;
  fake.world.target = 21;
  await app.req('POST', '/api/settings', { schedule: flat(20) });
  assert.equal(fake.world.target, 21);
  assert.equal(writes().length, count);
  await sleep(350);
  const s = await refresh();
  assert.equal(s.hold.source, 'thermostat'); assert.equal(s.hold.temp, 21);
  assert.equal(s.advice.target, 21); assert.equal(s.eco.active, false);
  assert.equal(writes().length, count);
});
test('Keep current setting reads a fresh target and keeps it without a thermostat command', async () => {
  fake.world.target = 22;
  const count = writes().length;
  const r = await app.req('POST', '/api/hold', { use_current: true, temp: 99, minutes: 120 });
  assert.equal(r.status, 200);
  assert.equal(r.data.hold.temp, 22);
  assert.equal(r.data.advice.target, 22);
  assert.equal(writes().length, count);
  fake.world.homekitAvailable = false;
  assert.equal((await app.req('POST', '/api/hold', { use_current: true })).status, 400);
  fake.world.homekitAvailable = true;
});
test('a saved hold keeps its original end time at startup, with Allow control off', async () => {
  const saved = (await app.req('GET', '/api/settings')).data;
  const hold = (await app.req('GET', '/api/status')).data.hold;
  app.stop();
  const count = fake.calls.length;
  app = await startApp({ port: 18223, initialSettings: saved, initialHold: hold });
  const s = await refresh();
  assert.equal(s.hold.until, hold.until);
  assert.equal(s.advice.target, 22);
  assert.ok(!fake.calls.slice(count).some((c) => c.type === 'call_service'));
});
test('startup protection does not turn a matching night setback into a hold just because Eco wants to preheat', async () => {
  app.stop();
  fake.world.target = 16;
  const f = fixture(); fake.world.extraStates = f.states; fake.world.ecoHistory = f.history;
  const week = flat(16);
  const parts = schedule.localParts(new Date(), 'Europe/Amsterdam');
  const later = parts.minutes + 45;
  const day = schedule.DAYS[(parts.day + (later >= 1440 ? 1 : 0)) % 7];
  if (later >= 1440) week[day] = week[day].filter((p) => p.time !== '00:00');
  week[day].push({ time: schedule.toTime(later), temp: 20 });
  app = await startApp({ port: 18225, options: { allow_control: true }, initialSettings: { ...defaults(), thermostat: TH, schedule: week,
    eco: { ...defaults().eco, ...selected, enabled: true, mode: 'adaptive', demand: 20 } } });
  const s = (await app.req('GET', '/api/status')).data;
  assert.equal(s.normalTarget, 16);
  assert.equal(s.hold, null);
  assert.equal(s.eco.active, true);
  assert.ok(s.advice.target > 16);
});
