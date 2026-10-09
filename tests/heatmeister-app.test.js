'use strict';

// The real app with "Send room temperature to HeatMeisters" ON (and "Allow
// control" off), against the fake Home Assistant. Like the owner's Node-RED
// flow: the tado room temperature goes to "<Name>/temp-ambient-ext" over MQTT.

const test = require('node:test');
const assert = require('node:assert/strict');
const fakeHa = require('./fake-ha');
const { startApp } = require('./app-runner');

const PORT = Number(process.env.SHP_MQTT_TEST_PORT) || 18197;
const TOPICS = ['Woonkamer-garage/temp-ambient-ext', 'Woonkamer-voor/temp-ambient-ext', 'woonkamer-gang/temp-ambient-ext'];

let app;
const req = (...a) => app.req(...a);
const status = async () => (await req('GET', '/api/status')).data;
const save = (body) => req('POST', '/api/settings', body);
const refreshed = async () => { await save({}); return status(); };
const writes = () => fakeHa.calls.filter((c) => c.type === 'call_service');

test.before(async () => {
  app = await startApp({ port: PORT, options: { allow_heatmeister_temperature: true } });
});
test.after(() => { if (app) app.stop(); });

test('nothing is sent before HeatMeisters are chosen', async () => {
  const s = await status();
  assert.equal(s.roomTemperature.allowed, true);
  assert.equal(writes().length, 0);
});

test('the thermostat room temperature goes to every chosen HeatMeister', async () => {
  const r = await save({
    thermostat: 'climate.tado_smart_thermostat_ru3010610432',
    heatmeisters: [
      { prefix: 'heatbooster_woonkamer_garage', name: 'Woonkamer-garage' },
      { prefix: 'heatbooster_woonkamer_voor', name: 'Woonkamer-voor' },
      { prefix: 'heatbooster_woonkamer_gang', name: 'Woonkamer-gang', topic: 'woonkamer-gang/temp-ambient-ext' },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (const t of TOPICS) assert.deepEqual(fakeHa.world.mqtt[t], ['19.4'], t);
  const s = await status();
  assert.equal(s.roomTemperature.last.sent, true);
  assert.equal(s.heatmeisters[0].sent.value, 19.4);
});

test('no new message while the temperature stays the same', async () => {
  await refreshed();
  for (const t of TOPICS) assert.equal(fakeHa.world.mqtt[t].length, 1);
});

test('a change of 0.1 °C or more is sent right away', async () => {
  fakeHa.world.room = 19.6;
  await refreshed();
  for (const t of TOPICS) assert.deepEqual(fakeHa.world.mqtt[t], ['19.4', '19.6']);
});

test('another room temperature sensor can be the source', async () => {
  await save({ room_temperature_source: 'sensor.woonkamer_temp_hum_temperature' });
  fakeHa.world.room = 20.3;
  await refreshed();
  assert.equal(fakeHa.world.mqtt[TOPICS[0]].at(-1), '20.3');
  await save({ room_temperature_source: '' });
});

test('MQTT down: shown as an error, tried again later', async () => {
  fakeHa.world.failMqtt = true;
  fakeHa.world.room = 21;
  let s = await refreshed();
  assert.ok(s.roomTemperature.last.error);
  fakeHa.world.failMqtt = false;
  s = await refreshed();
  assert.equal(s.roomTemperature.last.sent, true);
  assert.equal(fakeHa.world.mqtt[TOPICS[2]].at(-1), '21');
});

test('SAFETY: only mqtt.publish, only to the chosen topics, never the thermostat', () => {
  assert.ok(writes().length > 0);
  for (const c of writes()) {
    assert.equal(`${c.domain}.${c.service}`, 'mqtt.publish');
    assert.ok(TOPICS.includes(c.service_data.topic), c.service_data.topic);
    assert.match(c.service_data.payload, /^-?\d+(\.\d+)?$/);
    assert.equal(c.service_data.retain, false);
  }
});
