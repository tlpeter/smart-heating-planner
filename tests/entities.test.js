'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fakeHa = require('./fake-ha');
const { detect } = require('../smart_heating_planner/app/entities');

const registriesFromFake = () => fakeHa.registries();

test('thermostats: HomeKit (local) first, tado cloud marked', () => {
  const { entities, devices } = registriesFromFake();
  const r = detect(fakeHa.states(), entities, devices);
  assert.equal(r.thermostats[0].entity_id, 'climate.tado_smart_thermostat_ru3010610432');
  assert.equal(r.thermostats[0].local, true);
  const cloud = r.thermostats.find((t) => t.entity_id === 'climate.verwarming');
  assert.equal(cloud.cloud, true);
});

test('persons and proximity sensors are found', () => {
  const r = detect(fakeHa.states());
  assert.deepEqual(r.persons.map((p) => p.entity_id), ['person.cheyenne', 'person.peter', 'person.yvonne']);
  assert.deepEqual(r.distance.map((p) => p.entity_id), ['sensor.home_nearest_distance']);
  assert.deepEqual(r.direction.map((p) => p.entity_id), ['sensor.home_nearest_direction_of_travel']);
});

test('Heatmeister entities are recognised and listed first', () => {
  const { entities, devices } = registriesFromFake();
  const r = detect(fakeHa.states(), entities, devices);
  const hmControls = r.controls.filter((c) => c.heatmeister).map((c) => c.entity_id);
  assert.equal(hmControls.length, 3);
  assert.ok(r.controls[0].heatmeister);
  assert.ok(r.temperatures[0].heatmeister);
  // Other fans are still offered, after the Heatmeisters.
  assert.ok(r.controls.some((c) => c.entity_id === 'fan.bambu_p1s_aux_fan' && !c.heatmeister));
});

test('recognised by name alone, without the device registry', () => {
  const r = detect([{ entity_id: 'switch.hm_boost', state: 'off', attributes: { friendly_name: 'HeatMeister boost' } }]);
  assert.equal(r.controls.length, 1);
  assert.equal(r.controls[0].heatmeister, true);
});

test('old "heatbooster" entity ids with a "HeatMeister - …" name are recognised', () => {
  const r = detect([
    { entity_id: 'sensor.heatbooster_woonkamer_garage_demand_trim', state: '0.00', attributes: { friendly_name: 'HeatMeister - Woonkamer-garage Demand trim', unit_of_measurement: '°C', device_class: 'temperature' } },
    { entity_id: 'fan.heatbooster_woonkamer_garage', state: 'off', attributes: { friendly_name: 'Woonkamer-garage fan' } },
  ]);
  assert.equal(r.temperatures[0].heatmeister, true);
  assert.equal(r.controls[0].heatmeister, true);
});
