'use strict';

// Saved files: written atomically, no temporary files left behind, and read
// back after a "restart" (a fresh require of the modules).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shp-persistence-'));
process.env.DATA_DIR = dir;
const APP = path.join(__dirname, '..', 'smart_heating_planner', 'app');

function fresh(name) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(APP)) delete require.cache[k];
  return require(path.join(APP, name));
}

test('settings, hold and activity survive a restart', () => {
  const settings = fresh('settings');
  const r = settings.save({ thermostat: 'climate.tado', persons: ['person.peter'], away_temp: 15.5 });
  assert.equal(r.ok, true, r.errors.join('; '));
  fresh('hold').set(21, Date.now() + 3600000);
  fresh('activity').add({ target: 20, source: 'schedule', reason: 'test' });

  const s2 = fresh('settings').get();
  assert.equal(s2.thermostat, 'climate.tado');
  assert.deepEqual(s2.persons, [{ entity_id: 'person.peter', counts: true, coming_home: true }]);
  assert.equal(s2.away_temp, 15.5);
  assert.equal(fresh('hold').get().temp, 21);
  assert.equal(fresh('activity').recent(1)[0].reason, 'test');
});

test('a refused save changes nothing', () => {
  const settings = fresh('settings');
  const r = settings.save({ away_temp: 99 });
  assert.equal(r.ok, false);
  assert.equal(fresh('settings').get().away_temp, 15.5);
});

test('an ended hold is not returned, and clear removes it', () => {
  const hold = fresh('hold');
  assert.equal(hold.set(21, Date.now() - 1).ok, false);
  hold.set(21, Date.now() + 60000);
  assert.equal(hold.get(Date.now() + 120000), null);
  hold.clear();
  assert.equal(fresh('hold').get(), null);
});

test('settings from 0.2 are taken over (persons, Proximity distance, old Heatmeisters)', () => {
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    thermostat: 'climate.tado', persons: ['person.peter', 'person.yvonne'],
    proximity: { distance_entity: 'sensor.home_nearest_distance', direction_entity: '', distance_km: 7 },
    heatmeisters: [{ name: 'Woonkamer', control_entity: 'fan.x', inlet_entity: 'sensor.y' }],
    heatmeister_rule: { mode: 'both', inlet_on: 35, inlet_off: 30 },
  }));
  const s = fresh('settings').get();
  assert.deepEqual(s.persons.map((p) => [p.entity_id, p.counts, p.coming_home]), [['person.peter', true, true], ['person.yvonne', true, true]]);
  assert.equal(s.coming_home_km, 7);
  assert.equal(s.proximity, undefined);
  assert.equal(s.heatmeister_rule, undefined);
  assert.deepEqual(s.heatmeisters, [], 'old Heatmeister picks are dropped; choose them again');
  assert.deepEqual(s.tracker_types, { gps: true, router: true, bluetooth: true });
});

test('no temporary files are left behind', () => {
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
