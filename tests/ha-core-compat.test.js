'use strict';

// Compatibility smoke test against a real Home Assistant Core container.
// GitHub Actions pins the container to HA_CORE_VERSION. The test creates a
// throw-away owner account, then starts the real Smart Heating Planner
// against that Core instance. The Core uses the "demo" integration for a
// climate entity, and two persons from configuration.yaml.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HA_URL = process.env.HA_URL || 'http://127.0.0.1:8123';
const APP = path.join(__dirname, '..', 'smart_heating_planner', 'app');
const APP_PORT = Number(process.env.SHP_PORT) || 18299;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function waitForCore() {
  let last = 'not started';
  for (let i = 0; i < 180; i++) {
    try { return await json(`${HA_URL}/api/onboarding`); } catch (err) { last = err.message; await sleep(1000); }
  }
  throw new Error(`Home Assistant did not become ready: ${last}`);
}

async function onboard() {
  const clientId = `${HA_URL}/`;
  const user = await json(`${HA_URL}/api/onboarding/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, name: 'Compatibility test', username: 'shp_compat', password: 'shp-compatibility-only', language: 'en' }),
  });
  const token = await json(`${HA_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: user.auth_code, client_id: clientId }),
  });
  return token.access_token;
}

let app;
let dataDir;
const appApi = (p, opts) => json(`http://127.0.0.1:${APP_PORT}${p}`, opts);

test.after(() => {
  if (app) app.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the app works against a real Home Assistant Core', async () => {
  await waitForCore();
  const token = await onboard();
  assert.ok(token, 'no access token');

  // Wait until the demo climate entities exist.
  let states = [];
  for (let i = 0; i < 120; i++) {
    states = await json(`${HA_URL}/api/states`, { headers: { Authorization: `Bearer ${token}` } });
    if (states.some((s) => s.entity_id.startsWith('climate.')) && states.some((s) => s.entity_id === 'person.peter')) break;
    await sleep(1000);
  }
  const climate = states.find((s) => s.entity_id.startsWith('climate.') && s.attributes.temperature != null);
  assert.ok(climate, 'no demo climate entity with a target temperature');

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shp-core-'));
  app = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: { ...process.env, DATA_DIR: dataDir, HA_WS_URL: HA_URL.replace(/^http/, 'ws') + '/api/websocket', HA_TOKEN: token, SHP_PORT: String(APP_PORT) },
    stdio: 'inherit',
  });
  let status;
  for (let i = 0; i < 100; i++) {
    try { status = await appApi('/api/status'); if (status.ready) break; } catch { /* starting */ }
    await sleep(200);
  }
  assert.equal(status.connected, true, 'the app did not connect');
  assert.equal(status.timeZone, 'Europe/Amsterdam');

  const entities = await appApi('/api/entities');
  assert.ok(entities.thermostats.some((t) => t.entity_id === climate.entity_id), 'thermostat not found');
  assert.ok(entities.persons.some((p) => p.entity_id === 'person.peter'), 'person not found');
  assert.ok(entities.thermostats.every((t) => 'platform' in t), 'entity registry not read');

  await appApi('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thermostat: climate.entity_id, persons: ['person.peter', 'person.yvonne'] }),
  });
  status = await appApi('/api/status');
  assert.equal(status.thermostat.available, true);
  assert.equal(typeof status.thermostat.target, 'number');
  assert.equal(status.presence.unknown.length, 2, 'persons without a tracker should be "unknown"');
  assert.equal(typeof status.advice.target, 'number');
  // Live updates (subscribe_entities) work with this Home Assistant.
  for (let i = 0; i < 25 && !status.live; i++) { await sleep(200); status = await appApi('/api/status'); }
  assert.equal(status.live, true, 'no live updates from Home Assistant');
});
