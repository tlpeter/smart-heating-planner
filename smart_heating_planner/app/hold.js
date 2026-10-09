'use strict';

// A manual hold: "keep the house at 21 °C for 2 hours", set on the Home page.
// It ends by itself. Saved in /data/hold.json so it survives a restart.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const { DATA_DIR } = require('./options');
const { roundTemp, MIN_TEMP, MAX_TEMP } = require('./schedule');

const FILE = path.join(DATA_DIR, 'hold.json');

function get(now = Date.now()) {
  const h = readJson(FILE, null);
  if (!h || !(h.until > now) || !Number.isFinite(h.temp)) return null;
  return h;
}

// until: end time in ms. Returns { ok, error, hold }.
function set(temp, until, now = Date.now()) {
  const t = Number(temp);
  if (!Number.isFinite(t) || t < MIN_TEMP || t > MAX_TEMP) return { ok: false, error: `Temperature must be between ${MIN_TEMP} and ${MAX_TEMP} °C` };
  if (!(until > now) || until - now > 7 * 86400000) return { ok: false, error: 'The end time must be within the next 7 days' };
  const hold = { temp: roundTemp(t), until: Math.round(until), since: now };
  writeJsonAtomic(FILE, hold);
  return { ok: true, hold };
}

function clear() {
  writeJsonAtomic(FILE, null);
}

module.exports = { get, set, clear };
