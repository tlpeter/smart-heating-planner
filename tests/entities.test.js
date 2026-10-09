'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fakeHa = require('./fake-ha');
const { detect } = require('../smart_heating_planner/app/entities');

test('thermostats: HomeKit (local) first, tado cloud marked', () => {
  const r = detect(fakeHa.states(), fakeHa.registries().entities);
  assert.equal(r.thermostats[0].entity_id, 'climate.tado_smart_thermostat_ru3010610432');
  assert.equal(r.thermostats[0].local, true);
  assert.equal(r.thermostats.find((t) => t.entity_id === 'climate.verwarming').cloud, true);
});

test('persons with their trackers and tracker kinds', () => {
  const r = detect(fakeHa.states());
  assert.deepEqual(r.persons.map((p) => p.entity_id), ['person.cheyenne', 'person.peter', 'person.yvonne']);
  const peter = r.persons.find((p) => p.entity_id === 'person.peter');
  assert.deepEqual(peter.trackers.map((t) => t.type), ['gps', 'router', 'bluetooth']);
  assert.equal(r.homeZone, true);
});

test('HeatMeisters are offered', () => {
  const r = detect(fakeHa.states());
  assert.deepEqual(r.heatmeisters.map((h) => h.name), ['Eetkamer', 'Keuken', 'Woonkamer-garage']);
});
