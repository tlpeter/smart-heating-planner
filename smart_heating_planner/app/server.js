'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ha = require('./ha');
const { options } = require('./options');
const settings = require('./settings');
const controller = require('./controller');
const holdStore = require('./hold');
const activity = require('./activity');
const schedule = require('./schedule');
const { detect } = require('./entities');
const diagnostics = require('./diagnostics');

const PORT = Number(process.env.SHP_PORT) || 8099; // SHP_PORT: tests only
const APP_VERSION = require('./package.json').version;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'application/javascript; charset=utf-8']],
]);

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Read a JSON object body: at most 100 kB, and it must be a plain object.
const MAX_BODY = 100000;
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (status, message) => {
      if (done) return;
      done = true;
      const err = new Error(message);
      err.status = status;
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { fail(413, 'Request too large'); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('error', () => fail(400, 'Request failed'));
    req.on('end', () => {
      if (done) return;
      let body = {};
      const text = Buffer.concat(chunks).toString('utf8');
      if (text) {
        try { body = JSON.parse(text); } catch { fail(400, 'Invalid JSON'); return; }
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { fail(400, 'Expected a JSON object'); return; }
      done = true;
      resolve(body);
    });
  });
}

async function loadEntities() {
  const [states, entities] = await Promise.all([
    ha.call({ type: 'get_states' }),
    ha.call({ type: 'config/entity_registry/list' }).catch(() => []),
  ]);
  return detect(states, entities);
}

async function api(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/status') {
    return sendJson(res, 200, { version: APP_VERSION, connected: ha.state.connected, ha_version: ha.state.version, ...controller.getStatus() });
  }
  if (req.method === 'GET' && p === '/api/settings') return sendJson(res, 200, settings.get());
  if (req.method === 'POST' && p === '/api/settings') {
    const body = await readBody(req);
    const result = settings.save(body);
    if (!result.ok) return sendJson(res, 400, { error: result.errors.join('; '), errors: result.errors });
    ha.log('Settings saved:', Object.keys(body).join(', '));
    await controller.refresh();
    return sendJson(res, 200, result.value);
  }
  if (req.method === 'GET' && p === '/api/entities') {
    if (!ha.state.connected) return sendJson(res, 503, { error: 'Not connected to Home Assistant' });
    return sendJson(res, 200, await loadEntities());
  }
  if (req.method === 'POST' && p === '/api/hold') {
    const body = await readBody(req);
    const now = Date.now();
    let until;
    if (body.until === 'next') {
      const point = schedule.current(settings.get().schedule, now, ha.state.timeZone || 'UTC');
      until = point ? point.next.at : null;
    } else {
      const minutes = Number(body.minutes ?? settings.get().hold_default_minutes);
      until = Number.isFinite(minutes) ? now + Math.round(minutes) * 60000 : null;
    }
    const r = holdStore.set(body.temp, until, now);
    if (!r.ok) return sendJson(res, 400, { error: r.error });
    ha.log('Manual hold set:', r.hold.temp, '°C until', new Date(r.hold.until).toISOString());
    return sendJson(res, 200, await controller.refresh());
  }
  if (req.method === 'DELETE' && p === '/api/hold') {
    holdStore.clear();
    ha.log('Manual hold ended');
    return sendJson(res, 200, await controller.refresh());
  }
  if (req.method === 'GET' && p === '/api/activity') return sendJson(res, 200, activity.recent(200));
  if (req.method === 'GET' && p === '/api/diagnostics') {
    const body = {
      app_version: APP_VERSION,
      ha_version: ha.state.version,
      created: new Date().toISOString(),
      options,
      settings: diagnostics.redact(settings.get()),
      status: diagnostics.redact(diagnostics.summarisePresence(controller.getStatus())),
      activity: diagnostics.redact(activity.recent(50)),
      log: ha.recentLog().map(diagnostics.redactLine),
    };
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="smart-heating-planner-diagnostics-${APP_VERSION}.json"`,
    });
    return res.end(JSON.stringify(body, null, 2));
  }
  return sendJson(res, 404, { error: 'Not found' });
}

// SAFETY: only the Home Assistant ingress proxy may talk to the app. Other
// add-ons or devices on the network are refused.
const INGRESS_PROXY = new Set(['172.30.32.2', '::ffff:172.30.32.2', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

const server = http.createServer(async (req, res) => {
  const remote = req.socket.remoteAddress;
  if (!INGRESS_PROXY.has(remote)) {
    ha.warn('Refused request from', remote, '- only Home Assistant ingress is allowed');
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = STATIC_FILES.get(url.pathname);
    if (req.method === 'GET' && file) {
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(PUBLIC_DIR, file[0])));
    }
    res.writeHead(404);
    return res.end('Not found');
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) ha.warn('Request failed:', req.method, url.pathname, err.message);
    return sendJson(res, status, { error: err.message });
  }
});

ha.onConnect(() => controller.start());
server.listen(PORT, () => {
  ha.log(`Smart Heating Planner ${APP_VERSION} listening on port ${PORT} (watch only: nothing is sent)`);
  ha.connect();
});

module.exports = { server };
