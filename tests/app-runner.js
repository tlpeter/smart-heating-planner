'use strict';

// Start the real app against the fake Home Assistant, with its own empty
// data folder and options. Used by the settings and control tests.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const fakeHa = require('./fake-ha');

const APP = path.join(__dirname, '..', 'smart_heating_planner', 'app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startApp({ port, options = {}, env = {} }) {
  const fake = await fakeHa.start(0);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shp-app-'));
  fs.writeFileSync(path.join(dataDir, 'options.json'), JSON.stringify({ log_level: 'info', refresh_seconds: 600, ...options }));
  const app = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: { ...process.env, ...env, DATA_DIR: dataDir, HA_WS_URL: fake.url, HA_TOKEN: 'test-token', SHP_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  app.stdout.on('data', (d) => output.push(String(d)));
  app.stderr.on('data', (d) => output.push(String(d)));
  const base = `http://127.0.0.1:${port}`;

  async function req(method, p, body) {
    const res = await fetch(base + p, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }

  for (let i = 0; i < 100; i++) {
    try {
      const s = (await req('GET', '/api/status')).data;
      if (s.connected && s.ready) break;
    } catch { /* not up yet */ }
    if (i === 99) throw new Error(`The app did not start:\n${output.join('')}`);
    await sleep(100);
  }

  function stop() {
    app.kill();
    fake.wss.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  return { base, req, stop, dataDir, output };
}

module.exports = { startApp, sleep, APP };
