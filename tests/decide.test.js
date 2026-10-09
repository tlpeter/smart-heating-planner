'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideTarget, decideHeatmeister, heatDemand } = require('../smart_heating_planner/app/decide');

const TZ = 'Europe/Amsterdam';
const NOW = new Date('2026-10-09T15:00:00+02:00').getTime();
const point = (temp, preheat = false) => ({ current: { time: '17:00', temp, preheat }, next: { time: '22:30', temp: 16 } });
const base = {
  now: NOW,
  timeZone: TZ,
  point: point(20.5),
  presence: { effectiveHome: true, waitingUntil: null, approaching: false },
  hold: null,
  settings: { away_temp: 16 },
  thermostat: { available: true, target: 19, current: 19.4, hvac_action: 'idle' },
};
const run = (over) => decideTarget({ ...base, ...over, presence: { ...base.presence, ...(over.presence || {}) } });

test('someone home: the schedule', () => {
  const r = run({});
  assert.equal(r.target, 20.5);
  assert.equal(r.source, 'schedule');
  assert.equal(r.change, true);
});

test('nobody home: the away temperature', () => {
  const r = run({ presence: { effectiveHome: false } });
  assert.equal(r.target, 16);
  assert.equal(r.source, 'away');
});

test('nobody home never raises a lower schedule temperature', () => {
  const r = run({ point: point(14), presence: { effectiveHome: false } });
  assert.equal(r.target, 14);
});

test('nobody home but "preheat": the schedule', () => {
  const r = run({ point: point(20.5, true), presence: { effectiveHome: false } });
  assert.equal(r.target, 20.5);
  assert.equal(r.source, 'preheat');
});

test('nobody home but someone on the way: the schedule', () => {
  const r = run({ presence: { effectiveHome: false, approaching: true } });
  assert.equal(r.target, 20.5);
  assert.equal(r.source, 'approaching');
});

test('just left: still the schedule, with the waiting time in the reason', () => {
  const r = run({ presence: { effectiveHome: true, waitingUntil: NOW + 5 * 60000 } });
  assert.equal(r.target, 20.5);
  assert.match(r.reason, /waiting until 15:05/);
});

test('a manual hold wins over everything, until it ends', () => {
  const hold = { temp: 22, until: NOW + 3600000 };
  assert.equal(run({ hold, presence: { effectiveHome: false } }).target, 22);
  assert.equal(run({ hold }).source, 'hold');
  assert.match(run({ hold }).reason, /16:00/);
  assert.equal(run({ hold: { temp: 22, until: NOW - 1 } }).source, 'schedule');
});

test('no schedule: away temperature', () => {
  assert.equal(run({ point: null }).target, 16);
});

test('no change advised when the thermostat already matches, or is unavailable', () => {
  assert.equal(run({ thermostat: { available: true, target: 20.5 } }).change, false);
  assert.equal(run({ thermostat: { available: false } }).change, false);
});

test('heat demand comes from hvac_action', () => {
  assert.equal(heatDemand({ available: true, hvac_action: 'heating' }), true);
  assert.equal(heatDemand({ available: true, hvac_action: 'idle' }), false);
  assert.equal(heatDemand({ available: false, hvac_action: 'heating' }), false);
});

const rule = { mode: 'both', inlet_on: 35, inlet_off: 30 };
test('Heatmeister "both": runs on demand, and after it while the radiator is warm', () => {
  assert.equal(decideHeatmeister({ rule, demand: true, inlet: 20, prevOn: false }).on, true);
  assert.equal(decideHeatmeister({ rule, demand: false, inlet: 40, prevOn: false }).on, true);
  assert.equal(decideHeatmeister({ rule, demand: false, inlet: 25, prevOn: true }).on, false);
  assert.equal(decideHeatmeister({ rule, demand: false, inlet: null, prevOn: true }).on, false);
});

test('Heatmeister gap: between "off" and "on" it keeps what it was', () => {
  const r = { ...rule, mode: 'inlet' };
  assert.equal(decideHeatmeister({ rule: r, demand: false, inlet: 32, prevOn: false }).on, false);
  assert.equal(decideHeatmeister({ rule: r, demand: false, inlet: 32, prevOn: true }).on, true);
  assert.equal(decideHeatmeister({ rule: r, demand: false, inlet: 29, prevOn: true }).on, false);
  assert.equal(decideHeatmeister({ rule: r, demand: true, inlet: null, prevOn: false }).on, false);
});

test('Heatmeister "demand": only while the thermostat heats', () => {
  const r = { ...rule, mode: 'demand' };
  assert.equal(decideHeatmeister({ rule: r, demand: true, inlet: 20 }).on, true);
  assert.equal(decideHeatmeister({ rule: r, demand: false, inlet: 60 }).on, false);
});
