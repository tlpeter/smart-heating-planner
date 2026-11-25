'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('./fake-ha');
const { startApp } = require('./app-runner');
const schedule = require('../smart_heating_planner/app/schedule');
const { recordWindow } = require('../smart_heating_planner/app/eco-history');
const eco = require('../smart_heating_planner/app/eco');
const TH = 'climate.tado_smart_thermostat_ru3010610432';
const config = { ...eco.defaults(), enabled: true, mode: 'observe', indoor: 'sensor.eco_indoor', outdoor: 'sensor.eco_outdoor', heating_demand: 'sensor.eco_demand', gas: 'sensor.eco_gas' };
let app;
function setupSensors() {
  const now = Date.now();
  fake.world.extraStates = [[config.indoor, 18, '°C'], [config.outdoor, 5, '°C'], [config.heating_demand, 30, '%'], [config.gas, 101, 'm³']].map(([entity_id, state, unit]) => ({ entity_id, state: String(state), last_updated: new Date(now).toISOString(), attributes: { unit_of_measurement: unit } }));
  const data = Object.fromEntries(fake.world.extraStates.map((s) => [s.entity_id, []]));
  for (let i = 0; i <= 72; i++) {
    const t = now - (72 - i) * 600000;
    for (const [id, v] of [[config.indoor, i <= 36 ? 20 - i * .03 : 18.92 + (i - 36) * .25], [config.outdoor, 5], [config.heating_demand, i < 36 ? 0 : 50], [config.gas, 100 + i * .01]]) data[id].push({ s: String(v), lu: t / 1000 });
  }
  fake.world.ecoHistory = data;
}
const refresh = async () => {
  await app.req('POST', '/api/settings', {});
  return (await app.req('GET', '/api/status')).data;
};
test.before(async () => { app = await startApp({ port: 18214, options: { allow_control: true, allow_heatmeister_target: true } }); });
test.after(() => app && app.stop());
test('Eco settings validate partial changes, enum values, ranges and entities', async () => {
  for (const eco of [[], { enabled: 'yes' }, { mode: 'bad' }, { demand: 81 }, { step: .2 }, { indoor: 'climate.bad' }, { enabled: true }]) {
    assert.equal((await app.req('POST', '/api/settings', { eco })).status, 400);
  }
  assert.equal((await app.req('GET', '/api/settings')).data.eco.enabled, false);
});
test('real app: observe uses Recorder but sends no additional thermostat commands', async () => {
  setupSensors(); fake.world.target = 16;
  const flat = Object.fromEntries(schedule.DAYS.map((d) => [d, [{ time: '00:00', temp: 16 }]]));
  // Use the app's real local clock and an upcoming comfort deadline.
  const parts = schedule.localParts(new Date(), 'Europe/Amsterdam');
  const later = (parts.minutes + 120) % 1440;
  const day = schedule.DAYS[(parts.day + (parts.minutes + 120 >= 1440 ? 1 : 0)) % 7];
  flat[day].push({ time: schedule.toTime(later), temp: 20 });
  flat[day].sort((a, b) => a.time.localeCompare(b.time));
  // Across midnight the 00:00 point is deliberately removed so it cannot hide the deadline.
  if (parts.minutes + 120 >= 1440) flat[day] = flat[day].filter((p) => p.time !== '00:00');
  const r = await app.req('POST', '/api/settings', { thermostat: TH, persons: [], schedule: flat, eco: config,
    heatmeisters: [{ prefix: 'heatbooster_woonkamer_garage', name: 'Master', topic: 'master' }] });
  assert.equal(r.status, 200);
  const s = await refresh();
  assert.equal(s.advice.target, 16);
  assert.equal(s.eco.active, false);
  assert.ok(s.eco.model.heatingSamples >= 12);
  assert.equal(fake.calls.filter((c) => c.type === 'call_service' && c.domain === 'climate').length, 0);
});
test('real app: adaptive preheat uses the existing thermostat and HeatMeister write gates', async () => {
  // Force the predicted preheat window now by lowering the soft demand.
  await app.req('POST', '/api/settings', { eco: { mode: 'adaptive', demand: 20 } });
  const s = await refresh();
  assert.equal(s.eco.active, true);
  assert.ok(s.advice.target > 16 && s.advice.target <= 20);
  const writes = fake.calls.filter((c) => c.type === 'call_service' && c.domain === 'climate');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].target.entity_id, TH);
  assert.equal(fake.world.hm[0].roomTarget, s.advice.target);
  await refresh();
  assert.equal(fake.calls.filter((c) => c.type === 'call_service' && c.domain === 'climate').length, 1);
});
test('real app: a manual hold overrides Eco and disabled Eco keeps the normal plan', async () => {
  const s = (await app.req('POST', '/api/hold', { temp: 19, minutes: 60 })).data;
  assert.equal(s.advice.source, 'hold');
  assert.equal(s.eco.active, false);
  await app.req('POST', '/api/settings', { eco: { enabled: false } });
  assert.equal((await refresh()).eco.active, false);
});
test('window bookkeeping excludes gaps, holds and setting changes, including DST', () => {
  const memory = {};
  const settings = { schedule: {}, schedule_needs_presence: true, away_temp: 16 };
  const start = Date.parse('2026-10-24T20:00:00Z'); // 22:00 Amsterdam before fall-back
  recordWindow(memory, config, settings, 'Europe/Amsterdam', start, true, null);
  assert.equal(memory.ecoWindows[0].to - start, 15 * eco.HOUR);
  assert.equal(memory.ecoWindows[0].complete, true);
  recordWindow(memory, config, settings, 'Europe/Amsterdam', start + eco.HOUR, true, null);
  assert.equal(memory.ecoWindows[0].complete, false);
  const other = {};
  recordWindow(other, config, settings, 'Europe/Amsterdam', start, true, { temp: 20 });
  assert.equal(other.ecoWindows[0].complete, false);
});

test('real app: adaptive advice with all Allow options off is strictly read-only', async () => {
  const saved = (await app.req('GET', '/api/settings')).data;
  app.stop();
  app = await startApp({ port: 18215 });
  fake.world.target = 16;
  const before = fake.calls.length;
  await app.req('POST', '/api/settings', { ...saved, eco: { ...saved.eco, enabled: true } });
  const s = await refresh();
  assert.equal(s.eco.active, true);
  assert.equal(s.control.allowed, false);
  assert.ok(!fake.calls.slice(before).some((c) => c.type === 'call_service'));
});

test('real app: stale demand and Recorder failures fall back to the normal schedule', async () => {
  const demand = fake.world.extraStates.find((s) => s.entity_id === config.heating_demand);
  demand.last_updated = new Date(Date.now() - 2 * eco.HOUR).toISOString();
  let s = await refresh();
  assert.equal(s.eco.active, false);
  assert.equal(s.advice.target, 16);
  assert.match(s.eco.reason, /stale/);
  demand.last_updated = new Date().toISOString();
  fake.world.failHistory = true;
  await app.req('POST', '/api/settings', { eco: { demand: 21 } });
  s = await refresh();
  assert.equal(s.eco.active, false);
  assert.equal(s.eco.model, null);
  assert.match(s.eco.error, /Recorder unavailable/);
  fake.world.failHistory = false;
});
