'use strict';

// When to send, and how a change by hand is noticed (pure logic).

const test = require('node:test');
const assert = require('node:assert/strict');
const control = require('../smart_heating_planner/app/control');

const NOW = 1_800_000_000_000;
const th = (target, extra = {}) => ({ available: true, state: 'heat', target, ...extra });
const MIN = 60000;

test('send when the advice differs and nothing blocks it', () => {
  const r = control.shouldSend({ now: NOW, advice: { change: true }, thermostat: th(19), memory: {}, maxWritesPerDay: 48 });
  assert.equal(r.send, true);
});

test('do not send when it already matches, is unavailable or is off', () => {
  assert.equal(control.shouldSend({ now: NOW, advice: { change: false }, thermostat: th(19), memory: {}, maxWritesPerDay: 48 }).send, false);
  assert.equal(control.shouldSend({ now: NOW, advice: { change: true }, thermostat: { available: false }, memory: {}, maxWritesPerDay: 48 }).send, false);
  const off = control.shouldSend({ now: NOW, advice: { change: true }, thermostat: th(19, { state: 'off' }), memory: {}, maxWritesPerDay: 48 });
  assert.equal(off.send, false);
  assert.match(off.why, /off/);
});

test('at least 2 minutes between two writes', () => {
  const memory = { lastSent: { temp: 20, at: NOW - 1 * MIN }, writes: [NOW - 1 * MIN] };
  assert.equal(control.shouldSend({ now: NOW, advice: { change: true }, thermostat: th(19), memory, maxWritesPerDay: 48 }).send, false);
  memory.lastSent.at = NOW - 3 * MIN;
  assert.equal(control.shouldSend({ now: NOW, advice: { change: true }, thermostat: th(19), memory, maxWritesPerDay: 48 }).send, true);
});

test('never more than the daily limit; old writes drop off after 24 hours', () => {
  const writes = Array.from({ length: 20 }, (_, i) => NOW - (i + 5) * MIN);
  const memory = { lastSent: { temp: 20, at: NOW - 5 * MIN }, writes };
  const r = control.shouldSend({ now: NOW, advice: { change: true }, thermostat: th(19), memory, maxWritesPerDay: 20 });
  assert.equal(r.send, false);
  assert.match(r.why, /limit of 20/);
  const later = NOW + 25 * 3600000;
  assert.equal(control.shouldSend({ now: later, advice: { change: true }, thermostat: th(19), memory, maxWritesPerDay: 20 }).send, true);
});

test('recordWrite remembers the value and keeps only the last 24 hours', () => {
  const memory = { writes: [NOW - 25 * 3600000, NOW - 2 * MIN] };
  control.recordWrite(memory, 20.5, NOW);
  assert.deepEqual(memory.lastSent, { temp: 20.5, at: NOW });
  assert.equal(memory.writes.length, 2);
});

test('a change by hand: the thermostat shows something else than the app set', () => {
  const lastSent = { temp: 20, at: NOW - 10 * MIN };
  assert.equal(control.manualChange({ now: NOW, thermostat: th(22), lastSent }), 22);
  assert.equal(control.manualChange({ now: NOW, thermostat: th(20), lastSent }), null);
  assert.equal(control.manualChange({ now: NOW, thermostat: th(20.1), lastSent }), null, 'small rounding is not a change');
});

test('no change by hand right after a write (the thermostat may still be busy)', () => {
  const lastSent = { temp: 20, at: NOW - 1 * MIN };
  assert.equal(control.manualChange({ now: NOW, thermostat: th(19), lastSent }), null);
});

test('no change by hand without an earlier write, or when unavailable', () => {
  assert.equal(control.manualChange({ now: NOW, thermostat: th(22), lastSent: null }), null);
  assert.equal(control.manualChange({ now: NOW, thermostat: { available: false }, lastSent: { temp: 20, at: 0 } }), null);
});
