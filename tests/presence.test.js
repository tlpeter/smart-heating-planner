'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const presence = require('../smart_heating_planner/app/presence');
const fakeHa = require('./fake-ha');

const ALL = { gps: true, router: true, bluetooth: true };
const persons = ['person.peter', 'person.yvonne', 'person.cheyenne'];

test.beforeEach(() => fakeHa.reset());

test('someone in the Home zone means home', () => {
  fakeHa.world.persons = { peter: 'home', yvonne: 'not_home', cheyenne: 'Werk' };
  const r = presence.whoIsHome(fakeHa.states(), persons, ALL);
  assert.equal(r.anyoneHome, true);
  assert.deepEqual(r.home.map((p) => p.name), ['Peter']);
  assert.equal(r.away.length, 2);
  assert.equal(r.away.find((p) => p.name === 'Cheyenne').state, 'Werk', 'the GPS zone is shown');
});

test('nobody home', () => {
  fakeHa.world.persons = { peter: 'not_home', yvonne: 'not_home', cheyenne: 'not_home' };
  assert.equal(presence.whoIsHome(fakeHa.states(), persons, ALL).anyoneHome, false);
});

test('Bluetooth off: a Bluetooth tracker at home no longer makes Peter home', () => {
  fakeHa.world.persons = { peter: 'not_home', yvonne: 'not_home', cheyenne: 'not_home' };
  fakeHa.world.bluetooth.peter = 'home'; // e.g. his watch left on the table
  assert.equal(presence.whoIsHome(fakeHa.states(), persons, ALL).anyoneHome, true);
  const r = presence.whoIsHome(fakeHa.states(), persons, { gps: true, router: true, bluetooth: false });
  assert.equal(r.anyoneHome, false);
  const peter = r.people.find((p) => p.name === 'Peter');
  assert.equal(peter.trackers.find((t) => t.type === 'bluetooth').used, false);
});

test('only GPS (zones): the router tracker does not count', () => {
  fakeHa.world.persons = { peter: 'not_home', yvonne: 'not_home', cheyenne: 'not_home' };
  fakeHa.world.router.yvonne = 'home';
  assert.equal(presence.whoIsHome(fakeHa.states(), persons, ALL).anyoneHome, true);
  assert.equal(presence.whoIsHome(fakeHa.states(), persons, { gps: true, router: false, bluetooth: false }).anyoneHome, false);
});

test('a person who does not count is shown but ignored', () => {
  fakeHa.world.persons = { peter: 'not_home', yvonne: 'not_home', cheyenne: 'home' };
  const list = [{ entity_id: 'person.peter', counts: true }, { entity_id: 'person.yvonne', counts: true }, { entity_id: 'person.cheyenne', counts: false }];
  const r = presence.whoIsHome(fakeHa.states(), list, ALL);
  assert.equal(r.anyoneHome, false);
  assert.equal(r.people.length, 3);
  assert.equal(r.people.find((p) => p.name === 'Cheyenne').counts, false);
});

test('unknown location (no counted tracker knows) counts as home', () => {
  fakeHa.world.persons = { peter: 'unknown', yvonne: 'not_home', cheyenne: 'not_home' };
  fakeHa.world.bluetooth.peter = 'unknown';
  const r = presence.whoIsHome(fakeHa.states(), persons, ALL);
  assert.equal(r.unknown.length, 1);
  assert.equal(r.anyoneHome, true);
});

test('a person without trackers uses the person state; a missing person is unknown', () => {
  const states = [{ entity_id: 'person.x', state: 'home', attributes: { friendly_name: 'X' } }];
  assert.equal(presence.whoIsHome(states, ['person.x'], ALL).anyoneHome, true);
  assert.equal(presence.whoIsHome([], ['person.ghost'], ALL).unknown.length, 1);
});

test('old settings with plain person ids still work', () => {
  assert.deepEqual(presence.normalisePersons(['person.a']), [{ entity_id: 'person.a', counts: true, coming_home: true }]);
});

test('distance between two points', () => {
  assert.ok(Math.abs(presence.km({ lat: 51.37, lon: 5.19 }, fakeHa.north(10)) - 10) < 0.05);
});

test('coming home: close and getting closer', () => {
  fakeHa.world.persons = { peter: 'not_home', yvonne: 'not_home', cheyenne: 'not_home' };
  const cfg = { coming_home_km: 10 };
  const list = ['person.peter', { entity_id: 'person.yvonne', counts: true, coming_home: false }, 'person.cheyenne'];
  const memory = {};
  const step = (km, at) => {
    fakeHa.world.pos.peter = fakeHa.north(km);
    fakeHa.world.pos.yvonne = fakeHa.north(km);
    const states = fakeHa.states();
    return presence.onTheWay(states, list, presence.whoIsHome(states, list, ALL), cfg, memory, at);
  };
  const t0 = 1_800_000_000_000;
  assert.equal(step(15, t0).approaching, false, 'one position says nothing about the direction');
  assert.equal(step(12, t0 + 60000).approaching, false, 'closer, but still too far');
  const r = step(8, t0 + 120000);
  assert.equal(r.approaching, true);
  assert.equal(r.people.find((p) => p.name === 'Peter').towards, true);
  assert.equal(r.people.some((p) => p.name === 'Yvonne'), false, 'Yvonne has coming home off');
  assert.equal(step(9, t0 + 180000).approaching, false, 'driving away again');
});

test('coming home: an old position does not count, nor GPS noise', () => {
  fakeHa.world.persons = { peter: 'not_home', yvonne: 'not_home', cheyenne: 'not_home' };
  const memory = {};
  const cfg = { coming_home_km: 10 };
  const step = (km, at) => {
    fakeHa.world.pos.peter = fakeHa.north(km);
    const states = fakeHa.states();
    return presence.onTheWay(states, ['person.peter'], presence.whoIsHome(states, ['person.peter'], ALL), cfg, memory, at);
  };
  const t0 = 1_800_000_000_000;
  step(9, t0);
  assert.equal(step(8, t0 + 60000).approaching, true);
  assert.equal(step(8.02, t0 + 25 * 60000).approaching, false, 'last real move was 24 minutes ago');
});

test('coming home: once home, the history is cleared', () => {
  const memory = { track: { 'person.peter': [{ km: 5, at: 0 }] } };
  fakeHa.world.persons.peter = 'home';
  const states = fakeHa.states();
  presence.onTheWay(states, ['person.peter'], presence.whoIsHome(states, ['person.peter'], ALL), { coming_home_km: 10 }, memory, 1);
  assert.equal(memory.track['person.peter'], undefined);
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
