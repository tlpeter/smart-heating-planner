'use strict';

// The real app with "Set HeatMeister room target" ON (and the other options
// off), against the fake Home Assistant. Like the owner's Node-RED flow: the
// room target of each chosen HeatMeister (number ..._ambientcontrol_temp,
// "_2" for Woonkamer-voor) follows the thermostat's setpoint, with
// number.set_value. Home Assistant sends it to the HeatMeister over MQTT.

const test = require('node:test');
const assert = require('node:assert/strict');
const fakeHa = require('./fake-ha');
const { startApp, sleep } = require('./app-runner');

const PORT = Number(process.env.SHP_TARGET_TEST_PORT) || 18196;
const TARGETS = [
  'number.heatbooster_woonkamer_garage_ambientcontrol_temp',
  'number.heatbooster_woonkamer_voor_ambientcontrol_temp_2',
  'number.heatbooster_woonkamer_gang_ambientcontrol_temp',
];

let app;
const req = (...a) => app.req(...a);
const status = async () => (await req('GET', '/api/status')).data;
const save = (body) => req('POST', '/api/settings', body);
const refreshed = async () => { await save({}); return status(); };
const writes = () => fakeHa.calls.filter((c) => c.type === 'call_service');
const targets = () => fakeHa.world.hm.map((h) => h.roomTarget);

test.before(async () => {
  app = await startApp({ port: PORT, options: { allow_heatmeister_target: true }, env: { SHP_LIVE_MS: '50' } });
});
test.after(() => { if (app) app.stop(); });

test('nothing is set before HeatMeisters are chosen', async () => {
  const s = await status();
  assert.equal(s.heatmeisterTarget.allowed, true);
  assert.equal(writes().length, 0);
});

test('every chosen HeatMeister gets the thermostat setpoint as room target (Woonkamer-voor through its "_2" id)', async () => {
  fakeHa.world.target = 20;
  for (const h of fakeHa.world.hm) h.roomTarget = 19;
  const r = await save({
    thermostat: 'climate.tado_smart_thermostat_ru3010610432',
    heatmeisters: [
      { prefix: 'heatbooster_woonkamer_garage', name: 'Woonkamer-garage' },
      { prefix: 'heatbooster_woonkamer_voor', name: 'Woonkamer-voor', follows: 'heatbooster_woonkamer_garage' },
      { prefix: 'heatbooster_woonkamer_gang', name: 'Woonkamer-gang', topic: 'woonkamer-gang/temp-ambient-ext', follows: 'heatbooster_woonkamer_garage' },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(targets(), [20, 20, 20]);
  assert.deepEqual(writes().map((c) => c.target.entity_id).sort(), [...TARGETS].sort());
  const s = await status();
  assert.equal(s.heatmeisterTarget.value, 20);
  assert.equal(s.heatmeisters.find((h) => h.name === 'Woonkamer-voor').target_sent.value, 20);
  const { data } = await req('GET', '/api/activity');
  assert.ok(data.some((x) => x.event === 'hm-target'));
});

test('nothing is sent again while the target is right', async () => {
  const n = writes().length;
  await refreshed();
  await refreshed();
  assert.equal(writes().length, n);
});

test('a new setpoint (also from the tado app) goes to the HeatMeisters by itself, without a refresh from the page', async () => {
  fakeHa.world.target = 18.5;
  fakeHa.notify(['climate.tado_smart_thermostat_ru3010610432']);
  for (let i = 0; i < 40 && targets().some((t) => t !== 18.5); i++) await sleep(50);
  assert.deepEqual(targets(), [18.5, 18.5, 18.5]);
});

test('a setpoint below the HeatMeister minimum (14 °C) gives its minimum', async () => {
  fakeHa.world.target = 5;
  await refreshed();
  assert.deepEqual(targets(), [14, 14, 14]);
  fakeHa.world.target = 19;
  await refreshed();
  assert.deepEqual(targets(), [19, 19, 19]);
});

test('a failing HeatMeister is shown and tried again at the next refresh', async () => {
  fakeHa.world.failHmTarget = true;
  fakeHa.world.target = 21;
  let s = await refreshed();
  assert.ok(s.heatmeisters[0].target_sent.error);
  const n = writes().length;
  await refreshed();
  // A failure is not counted as "just sent": tried again.
  assert.ok(writes().length > n);
  fakeHa.world.failHmTarget = false;
  s = await refreshed();
  assert.deepEqual(targets(), [21, 21, 21]);
  assert.equal(s.heatmeisters[0].target_sent.error, undefined);
});

test('SAFETY: only number.set_value, only on the room targets of the chosen HeatMeisters', () => {
  assert.ok(writes().length > 0);
  for (const c of writes()) {
    assert.equal(`${c.domain}.${c.service}`, 'number.set_value');
    assert.ok(TARGETS.includes(c.target.entity_id), c.target.entity_id);
    assert.equal(typeof c.service_data.value, 'number');
  }
  const other = new Set(fakeHa.calls.filter((c) => c.type !== 'call_service').map((c) => c.type));
  for (const t of other) assert.ok(['get_states', 'get_config', 'config/entity_registry/list', 'config/device_registry/list', 'subscribe_entities', 'unsubscribe_events'].includes(t), t);
});
