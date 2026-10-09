'use strict';

// The real app with "Send temperature to HeatMeisters" ON (and "Allow control"
// off), against the fake Home Assistant. Like the owner's Node-RED flow: the
// thermostat setpoint goes to "<Name>/temp-ambient-ext" over MQTT when it
// changes. Optional: a room temperature instead.

const test = require('node:test');
const assert = require('node:assert/strict');
const fakeHa = require('./fake-ha');
const { startApp, sleep } = require('./app-runner');

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

test('by default the thermostat setpoint goes to every chosen HeatMeister', async () => {
  const r = await save({
    thermostat: 'climate.tado_smart_thermostat_ru3010610432',
    heatmeisters: [
      { prefix: 'heatbooster_woonkamer_garage', name: 'Woonkamer-garage' },
      { prefix: 'heatbooster_woonkamer_voor', name: 'Woonkamer-voor' },
      { prefix: 'heatbooster_woonkamer_gang', name: 'Woonkamer-gang', topic: 'woonkamer-gang/temp-ambient-ext' },
    ],
    room_temperature_interval_seconds: 600, // no timer sends during the first tests
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (const t of TOPICS) assert.deepEqual(fakeHa.world.mqtt[t], ['19'], t);
  const s = await status();
  assert.equal(s.roomTemperature.send, 'setpoint');
  assert.equal(s.roomTemperature.last.sent, true);
  assert.equal(s.heatmeisters[0].sent.value, 19);
});

test('no new message while the setpoint stays the same (the room temperature does not matter)', async () => {
  fakeHa.world.room = 20.5;
  await refreshed();
  for (const t of TOPICS) assert.equal(fakeHa.world.mqtt[t].length, 1);
});

test('a new setpoint is sent right away (like the Node-RED flow)', async () => {
  fakeHa.world.target = 21;
  await refreshed();
  for (const t of TOPICS) assert.deepEqual(fakeHa.world.mqtt[t], ['19', '21'], t);
  await refreshed();
  assert.equal(fakeHa.world.mqtt[TOPICS[0]].length, 2, 'no repeat while the setpoint stays');
});

test('"a room temperature": the thermostat room temperature, also on a new setpoint', async () => {
  await save({ heatmeister_send: 'room' });
  assert.equal(fakeHa.world.mqtt[TOPICS[0]].at(-1), '20.5');
  fakeHa.world.room = 20.7;
  await refreshed();
  assert.equal(fakeHa.world.mqtt[TOPICS[0]].at(-1), '20.7');
  const n = fakeHa.world.mqtt[TOPICS[0]].length;
  fakeHa.world.target = 19.5; // new setpoint, same room temperature
  await refreshed();
  assert.equal(fakeHa.world.mqtt[TOPICS[0]].length, n + 1);
});

test('"a room temperature" from another sensor', async () => {
  await save({ room_temperature_source: 'sensor.woonkamer_temp_hum_temperature' });
  fakeHa.world.room = 20.3;
  await refreshed();
  assert.equal(fakeHa.world.mqtt[TOPICS[0]].at(-1), '20.3');
  await save({ room_temperature_source: '', heatmeister_send: 'setpoint' });
});

test('MQTT down: shown as an error, tried again later', async () => {
  fakeHa.world.failMqtt = true;
  fakeHa.world.target = 22;
  let s = await refreshed();
  assert.ok(s.roomTemperature.last.error);
  fakeHa.world.failMqtt = false;
  s = await refreshed();
  assert.equal(s.roomTemperature.last.sent, true);
  assert.equal(fakeHa.world.mqtt[TOPICS[2]].at(-1), '22');
});

test('sent again by itself every N seconds, like the Node-RED flow (every 15 s)', async () => {
  await save({ room_temperature_interval_seconds: 5 });
  const n = fakeHa.world.mqtt[TOPICS[0]].length;
  await sleep(11500); // two ticks of 5 s, no refresh in between
  for (const t of TOPICS) assert.ok(fakeHa.world.mqtt[t].length >= n + 2, `${t}: ${fakeHa.world.mqtt[t].length - n} new`);
  assert.equal(fakeHa.world.mqtt[TOPICS[0]].at(-1), '22', 'the same setpoint, sent again');
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
