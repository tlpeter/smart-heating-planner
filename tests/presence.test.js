'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const presence = require('../smart_heating_planner/app/presence');

const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });
const persons = ['person.peter', 'person.yvonne', 'person.cheyenne'];

test('someone in the Home zone means home', () => {
  const r = presence.whoIsHome([st('person.peter', 'home'), st('person.yvonne', 'not_home'), st('person.cheyenne', 'Werk')], persons);
  assert.equal(r.anyoneHome, true);
  assert.equal(r.home.length, 1);
  assert.equal(r.away.length, 2);
});

test('nobody home', () => {
  const r = presence.whoIsHome([st('person.peter', 'not_home'), st('person.yvonne', 'not_home'), st('person.cheyenne', 'not_home')], persons);
  assert.equal(r.anyoneHome, false);
});

test('unknown location counts as home (better warm than cold)', () => {
  const r = presence.whoIsHome([st('person.peter', 'unknown'), st('person.yvonne', 'not_home')], ['person.peter', 'person.yvonne']);
  assert.equal(r.anyoneHome, true);
  assert.equal(r.unknown.length, 1);
});

test('a person that does not exist counts as unknown', () => {
  const r = presence.whoIsHome([], ['person.ghost']);
  assert.equal(r.unknown[0].state, 'missing');
});

test('away delay: wait before treating the house as empty', () => {
  const now = 1_000_000_000;
  assert.deepEqual(presence.withAwayDelay(true, now, 10, now), { effectiveHome: true, waitingUntil: null });
  const waiting = presence.withAwayDelay(false, now - 5 * 60000, 10, now);
  assert.equal(waiting.effectiveHome, true);
  assert.equal(waiting.waitingUntil, now + 5 * 60000);
  assert.equal(presence.withAwayDelay(false, now - 11 * 60000, 10, now).effectiveHome, false);
  assert.equal(presence.withAwayDelay(false, now - 1000, 0, now).effectiveHome, false);
  assert.equal(presence.withAwayDelay(false, null, 10, now).effectiveHome, false);
});

test('on the way home: close and travelling towards home', () => {
  const cfg = { distance_entity: 'sensor.d', direction_entity: 'sensor.dir', distance_km: 10 };
  const mk = (d, dir, unit = 'km') => [st('sensor.d', String(d), { unit_of_measurement: unit }), st('sensor.dir', dir)];
  assert.equal(presence.onTheWay(mk(6, 'towards'), cfg).approaching, true);
  assert.equal(presence.onTheWay(mk(6, 'away_from'), cfg).approaching, false);
  assert.equal(presence.onTheWay(mk(25, 'towards'), cfg).approaching, false);
  assert.equal(presence.onTheWay(mk(6000, 'towards', 'm'), cfg).approaching, true);
  assert.equal(presence.onTheWay(mk(0, 'arrived'), cfg).approaching, false);
  assert.equal(presence.onTheWay(mk('unavailable', 'towards'), cfg).approaching, false);
});

test('on the way home without a direction sensor: being close is enough', () => {
  const r = presence.onTheWay([st('sensor.d', '4', { unit_of_measurement: 'km' })], { distance_entity: 'sensor.d', distance_km: 5 });
  assert.equal(r.approaching, true);
});

test('no distance sensor chosen: never approaching', () => {
  assert.equal(presence.onTheWay([], {}).approaching, false);
});
