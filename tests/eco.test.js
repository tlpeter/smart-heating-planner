'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const eco = require('../smart_heating_planner/app/eco');
const control = require('../smart_heating_planner/app/control');
const now = Date.parse('2026-11-25T04:30:00Z');
const config = { ...eco.defaults(), enabled: true, mode: 'adaptive', indoor: 'sensor.indoor', outdoor: 'sensor.outdoor', heating_demand: 'sensor.demand', gas: 'sensor.gas' };

function history(end = now) {
  const out = Object.fromEntries([config.indoor, config.outdoor, config.heating_demand, config.gas].map((id) => [id, []]));
  // Six hours of cooling then six hours of heating, sampled every ten minutes.
  for (let i = 0; i <= 72; i++) {
    const at = end - (72 - i) * 600000;
    const room = i <= 36 ? 20 - i * 0.03 : 18.92 + (i - 36) * 0.12;
    for (const [id, value] of [[config.indoor, room], [config.outdoor, 5], [config.heating_demand, i < 36 ? 0 : 50], [config.gas, 100 + i * 0.01]]) out[id].push({ s: String(value), lu: at / 1000 });
  }
  return out;
}
function input(overrides = {}) {
  return { config, model: { ready: true, confidence: 'high', latest: now, loss: 0.01, capacity: 4, outdoorMin: 0, outdoorMax: 10 },
    values: { indoor: 18, outdoor: 5, heating_demand: 30 }, baseline: { target: 16, source: 'schedule', change: false },
    point: { current: { temp: 16 }, next: { temp: 20, at: now + 75 * 60000 } },
    presence: { effectiveHome: true }, hold: null, thermostat: { available: true, state: 'heat', target: 16 }, now, ...overrides };
}
test('disabled and observe leave the normal heating decision in control', () => {
  assert.equal(eco.plan(input({ config: { ...config, enabled: false } })).active, false);
  const observe = eco.plan(input({ config: { ...config, mode: 'observe' } }));
  assert.equal(observe.active, false);
  assert.ok(observe.predictedStart);
});
test('learns weather-normalized rates, sample counts, freshness and confidence', () => {
  const m = eco.learn(history(), config, now);
  assert.equal(m.ready, true);
  assert.ok(m.coolingSamples >= 12 && m.heatingSamples >= 12);
  assert.ok(m.loss > 0 && m.capacity > 0);
  assert.equal(eco.learn(history(now - 48 * eco.HOUR), config, now).ready, false);
  assert.equal(eco.learn({}, config, now).confidence, 'low');
});
test('missing values and Recorder gaps do not become zero-degree samples', () => {
  assert.equal(eco.number('unknown'), null);
  assert.equal(eco.number(null), null);
  assert.equal(eco.number(' '), null);
  assert.equal(eco.at([{ at: now - eco.HOUR, value: 5 }], now), null);
  assert.equal(eco.plan(input({ values: { indoor: 18, outdoor: null, heating_demand: 30 } })).active, false);
  assert.equal(eco.plan(input({ model: null })).active, false);
});
test('live readings require fresh timestamps and the correct units', () => {
  const states = [{ entity_id: config.indoor, state: '18', last_updated: new Date(now).toISOString(), attributes: { unit_of_measurement: '°C' } }];
  assert.equal(eco.live(states, config, now).indoor, 18);
  assert.equal(eco.live(states, config, now + eco.HOUR).indoor, null);
  states[0].last_reported = new Date(now + eco.HOUR).toISOString();
  assert.equal(eco.live(states, config, now + eco.HOUR).indoor, 18, 'an unchanged value can have a fresh report');
  states[0].attributes.unit_of_measurement = '°F';
  assert.equal(eco.live(states, config, now).indoor, null);
});
test('manual hold, absence and a lower next schedule point take priority', () => {
  assert.equal(eco.plan(input({ hold: { until: now + eco.HOUR } })).active, false);
  assert.equal(eco.plan(input({ presence: { effectiveHome: false } })).active, false);
  assert.equal(eco.plan(input({ point: { current: { temp: 20 }, next: { temp: 16 } } })).active, false);
  const absentPreheat = input({ presence: { effectiveHome: false } });
  absentPreheat.point.next.preheat = true;
  assert.equal(eco.plan(absentPreheat).active, true);
});
test('gradual preheat raises at most one step, waits and respects demand feedback', () => {
  assert.equal(eco.plan(input()).proposedTarget, 16.5);
  assert.equal(eco.plan(input({ config: { ...config, step: 1 } })).proposedTarget, 17);
  assert.equal(eco.plan(input({ lastSent: { at: now - 60000 } })).proposedTarget, 16);
  assert.equal(eco.plan(input({ values: { indoor: 18, outdoor: 5, heating_demand: 70 } })).proposedTarget, 16);
});
test('comfort deadline, cold weather and write budget trigger normal heating', () => {
  const deadline = input(); deadline.point.next.at = now + 20 * 60000;
  assert.equal(eco.plan(deadline).proposedTarget, 20);
  assert.equal(eco.plan(input({ writesRemaining: 2 })).proposedTarget, 20);
  assert.equal(eco.plan(input({ values: { indoor: 18, outdoor: -20, heating_demand: 30 } })).active, false);
  const weak = input(); weak.model.capacity = 0.01;
  assert.equal(eco.plan(weak).active, false);
  const waiting = input(); waiting.point.next.at = now + 6 * eco.HOUR;
  assert.equal(eco.plan(waiting).active, false);
});
test('adaptive advice still goes through daily limits and the existing write interval', () => {
  const e = eco.plan(input());
  const args = { now, advice: { target: e.proposedTarget, change: true }, thermostat: input().thermostat, memory: { writes: [now - 60000], lastSent: { at: now - 60000 } }, maxWritesPerDay: 48 };
  assert.equal(control.shouldSend(args).send, false);
  args.memory.lastSent = null; args.maxWritesPerDay = 1;
  assert.match(control.shouldSend(args).why, /limit/);
});
test('total gas includes the entire window; resets and gaps invalidate it', () => {
  const m = eco.learn(history(), config, now);
  const from = now - 6 * eco.HOUR;
  const result = eco.gasWindow(m.lines, from, now);
  assert.ok(Math.abs(result.gas - 0.36) < 1e-6);
  m.lines.gas[m.lines.gas.length - 1].value = 0;
  assert.equal(eco.gasWindow(m.lines, from, now), null);
  assert.equal(eco.gasWindow(m.lines, now - 24 * eco.HOUR, now), null);
});
test('evaluation requires comparable, complete windows and never claims savings', () => {
  const m = eco.learn(history(), config, now);
  m.lines.indoor.forEach((p) => { p.value = 19; });
  const windows = [{ from: now - 12 * eco.HOUR, to: now - 6 * eco.HOUR, complete: true, strategy: 'normal', scheduleKey: 'x' },
    { from: now - 6 * eco.HOUR, to: now, complete: true, strategy: 'adaptive', scheduleKey: 'x' }];
  assert.equal(typeof eco.evaluation(m, windows, now).differenceM3, 'number');
  windows[0].scheduleKey = 'different';
  assert.equal(eco.evaluation(m, windows, now).differenceM3, null);
  assert.match(eco.evaluation(m, windows, now).reason, /Hot water/);
  windows[1].complete = false;
  assert.equal(eco.evaluation(m, windows, now).windows.length, 1);
});

test('Recorder cache refreshes, invalidates sensor changes and handles failures', async () => {
  const ha = require('../smart_heating_planner/app/ha');
  const recorder = require('../smart_heating_planner/app/eco-history');
  const original = ha.call;
  let calls = 0;
  ha.call = async (message) => { calls++; assert.equal(message.type, 'history/history_during_period'); return history(); };
  try {
    assert.equal(await recorder.update({ ...config, enabled: false }, now), null);
    const model = await recorder.update(config, now);
    assert.equal(model.ready, true);
    assert.equal(await recorder.update(config, now + 60000), model);
    assert.equal(calls, 1);
    assert.equal(recorder.getModel({ ...config, indoor: 'sensor.changed' }), null);
    ha.call = async () => { throw new Error('offline'); };
    assert.equal(await recorder.update(config, now + eco.HOUR), null);
    assert.match(recorder.getError(), /offline/);
    assert.equal(recorder.getModel(config), null);
    assert.equal(await recorder.update({ ...config, indoor: '', outdoor: '', heating_demand: '', gas: '' }, now + 2 * eco.HOUR), null);
  } finally { ha.call = original; }
});

