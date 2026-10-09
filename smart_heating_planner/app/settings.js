'use strict';

// Settings made on the app's Settings and Schedule pages, saved in
// /data/settings.json. Every value from the page is checked here before it
// is saved.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const { DATA_DIR } = require('./options');
const schedule = require('./schedule');
const { normalisePersons } = require('./presence');
const { defaultTopic } = require('./heatmeister');

const FILE = path.join(DATA_DIR, 'settings.json');
const MAX_HEATMEISTERS = 6;
const MAX_PERSONS = 10;

function defaults() {
  return {
    thermostat: '',
    persons: [],
    // The schedule only counts when someone is home (off: always the schedule).
    schedule_needs_presence: true,
    away_temp: 16,
    away_delay_minutes: 10,
    // Which kinds of tracker count for "home" (person entities).
    tracker_types: { gps: true, router: true, bluetooth: true },
    coming_home_km: 10,
    hold_default_minutes: 120,
    manual_change_until: 'next',
    heatmeisters: [], // [{ prefix, name, topic }]
    // Room temperature for the HeatMeisters (MQTT): '' = the thermostat's.
    room_temperature_source: '',
    room_temperature_interval: 5,
    schedule: schedule.defaultSchedule(),
  };
}

let current = null;

function load() {
  const saved = readJson(FILE, null);
  const base = defaults();
  if (!saved || typeof saved !== 'object') return base;
  const out = {
    ...base,
    ...saved,
    tracker_types: { ...base.tracker_types, ...(saved.tracker_types || {}) },
    persons: normalisePersons(saved.persons),
  };
  // Older versions: a Proximity sensor distance, and Heatmeisters by entity.
  if (saved.proximity && saved.coming_home_km === undefined && Number(saved.proximity.distance_km) > 0) out.coming_home_km = Number(saved.proximity.distance_km);
  delete out.proximity;
  delete out.heatmeister_rule;
  out.heatmeisters = (out.heatmeisters || []).filter((h) => h && h.prefix).map((h) => ({ ...h, topic: h.topic || defaultTopic(h.name) }));
  return out;
}

function get() {
  if (!current) current = load();
  return current;
}

const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;
function entityOrEmpty(v, domains, label, errors) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!ENTITY.test(s) || (domains && !domains.includes(s.split('.')[0]))) {
    errors.push(`${label}: "${s}" is not a valid ${domains ? domains.join('/') : ''} entity`);
    return '';
  }
  return s;
}

function num(v, min, max, label, errors, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    errors.push(`${label} must be between ${min} and ${max}`);
    return fallback;
  }
  return n;
}

// Check (part of) the settings from the page and merge them with what is
// saved. Returns { ok, errors, value }.
function validate(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Expected an object'], value: null };
  }
  const old = get();
  const v = JSON.parse(JSON.stringify(old));

  if ('thermostat' in input) v.thermostat = entityOrEmpty(input.thermostat, ['climate'], 'Thermostat', errors);
  if ('persons' in input) {
    if (!Array.isArray(input.persons)) errors.push('Persons must be a list');
    else {
      const seen = new Set();
      const list = [];
      for (const p of normalisePersons(input.persons)) {
        const id = entityOrEmpty(p.entity_id, ['person'], 'Person', errors);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        list.push({ entity_id: id, counts: p.counts, coming_home: p.coming_home });
      }
      if (list.length > MAX_PERSONS) errors.push(`At most ${MAX_PERSONS} persons`);
      v.persons = list.slice(0, MAX_PERSONS);
    }
  }
  if ('schedule_needs_presence' in input) v.schedule_needs_presence = input.schedule_needs_presence !== false;
  if ('room_temperature_source' in input) v.room_temperature_source = entityOrEmpty(input.room_temperature_source, ['sensor'], 'Room temperature source', errors);
  if ('room_temperature_interval' in input) v.room_temperature_interval = Math.round(num(input.room_temperature_interval, 1, 60, 'Send room temperature every', errors, old.room_temperature_interval));
  if ('away_temp' in input) v.away_temp = schedule.roundTemp(num(input.away_temp, 5, 22, 'Away temperature', errors, old.away_temp));
  if ('away_delay_minutes' in input) v.away_delay_minutes = Math.round(num(input.away_delay_minutes, 0, 120, 'Away delay', errors, old.away_delay_minutes));
  if ('hold_default_minutes' in input) v.hold_default_minutes = Math.round(num(input.hold_default_minutes, 15, 1440, 'Default hold', errors, old.hold_default_minutes));
  if ('manual_change_until' in input) {
    if (['next', 'minutes'].includes(input.manual_change_until)) v.manual_change_until = input.manual_change_until;
    else errors.push('A change on the thermostat lasts until "next" (switch point) or "minutes"');
  }
  if ('tracker_types' in input) {
    const t = input.tracker_types || {};
    v.tracker_types = { gps: t.gps !== false, router: t.router !== false, bluetooth: t.bluetooth !== false };
    if (!v.tracker_types.gps && !v.tracker_types.router && !v.tracker_types.bluetooth) errors.push('At least one kind of tracker must count');
  }
  if ('coming_home_km' in input) v.coming_home_km = num(input.coming_home_km, 0.5, 200, '"Coming home" distance', errors, old.coming_home_km);
  if ('heatmeisters' in input) {
    if (!Array.isArray(input.heatmeisters)) errors.push('Heatmeisters must be a list');
    else {
      if (input.heatmeisters.length > MAX_HEATMEISTERS) errors.push(`At most ${MAX_HEATMEISTERS} Heatmeisters`);
      const seen = new Set();
      v.heatmeisters = [];
      for (const h of input.heatmeisters.slice(0, MAX_HEATMEISTERS)) {
        const prefix = String((h && h.prefix) || '');
        if (!/^(heatbooster|heatmeister|heat_meister)_[a-z0-9_]+$/.test(prefix)) { errors.push(`"${prefix}" is not a HeatMeister`); continue; }
        if (seen.has(prefix)) continue;
        seen.add(prefix);
        const name = String((h && h.name) || prefix).trim().slice(0, 40);
        const topic = String((h && h.topic) || defaultTopic(name)).trim();
        if (!/^[A-Za-z0-9_\-./ ]{1,100}$/.test(topic) || /[#+]/.test(topic)) { errors.push(`${name}: "${topic}" is not a valid MQTT topic (no + or #)`); continue; }
        v.heatmeisters.push({ prefix, name, topic });
      }
    }
  }
  if ('schedule' in input) {
    const s = schedule.validate(input.schedule);
    errors.push(...s.errors);
    if (s.ok) v.schedule = s.value;
  }
  return { ok: errors.length === 0, errors, value: v };
}

function save(input) {
  const result = validate(input);
  if (!result.ok) return result;
  writeJsonAtomic(FILE, result.value);
  current = result.value;
  return result;
}

module.exports = { get, save, validate, defaults, MAX_HEATMEISTERS };
