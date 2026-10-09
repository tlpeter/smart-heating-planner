'use strict';

// Settings made on the app's Settings and Schedule pages, saved in
// /data/settings.json. Every value from the page is checked here before it
// is saved.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const { DATA_DIR } = require('./options');
const schedule = require('./schedule');

const FILE = path.join(DATA_DIR, 'settings.json');
const MAX_HEATMEISTERS = 6;
const MAX_PERSONS = 10;

function defaults() {
  return {
    thermostat: '',
    persons: [],
    away_temp: 16,
    away_delay_minutes: 10,
    proximity: { distance_entity: '', direction_entity: '', distance_km: 10 },
    hold_default_minutes: 120,
    heatmeisters: [],
    heatmeister_rule: { mode: 'both', inlet_on: 35, inlet_off: 30 },
    schedule: schedule.defaultSchedule(),
  };
}

let current = null;

function load() {
  const saved = readJson(FILE, null);
  const base = defaults();
  if (!saved || typeof saved !== 'object') return base;
  return {
    ...base,
    ...saved,
    proximity: { ...base.proximity, ...(saved.proximity || {}) },
    heatmeister_rule: { ...base.heatmeister_rule, ...(saved.heatmeister_rule || {}) },
  };
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
      const list = [...new Set(input.persons.map((p) => entityOrEmpty(p, ['person'], 'Person', errors)).filter(Boolean))];
      if (list.length > MAX_PERSONS) errors.push(`At most ${MAX_PERSONS} persons`);
      v.persons = list.slice(0, MAX_PERSONS);
    }
  }
  if ('away_temp' in input) v.away_temp = schedule.roundTemp(num(input.away_temp, 5, 22, 'Away temperature', errors, old.away_temp));
  if ('away_delay_minutes' in input) v.away_delay_minutes = Math.round(num(input.away_delay_minutes, 0, 120, 'Away delay', errors, old.away_delay_minutes));
  if ('hold_default_minutes' in input) v.hold_default_minutes = Math.round(num(input.hold_default_minutes, 15, 1440, 'Default hold', errors, old.hold_default_minutes));
  if ('proximity' in input) {
    const p = input.proximity || {};
    v.proximity = {
      distance_entity: entityOrEmpty(p.distance_entity, ['sensor'], 'Distance sensor', errors),
      direction_entity: entityOrEmpty(p.direction_entity, ['sensor'], 'Direction sensor', errors),
      distance_km: num(p.distance_km, 0.5, 200, 'Preheat distance', errors, old.proximity.distance_km),
    };
  }
  if ('heatmeisters' in input) {
    if (!Array.isArray(input.heatmeisters)) errors.push('Heatmeisters must be a list');
    else {
      if (input.heatmeisters.length > MAX_HEATMEISTERS) errors.push(`At most ${MAX_HEATMEISTERS} Heatmeisters`);
      v.heatmeisters = input.heatmeisters.slice(0, MAX_HEATMEISTERS).map((h, i) => ({
        name: String((h && h.name) || `Heatmeister ${i + 1}`).trim().slice(0, 40),
        control_entity: entityOrEmpty(h && h.control_entity, ['fan', 'switch', 'number', 'select', 'light'], `Heatmeister ${i + 1} control`, errors),
        inlet_entity: entityOrEmpty(h && h.inlet_entity, ['sensor'], `Heatmeister ${i + 1} radiator temperature`, errors),
      }));
    }
  }
  if ('heatmeister_rule' in input) {
    const r = input.heatmeister_rule || {};
    const mode = ['demand', 'inlet', 'both'].includes(r.mode) ? r.mode : (errors.push('Heatmeister rule must be demand, inlet or both'), old.heatmeister_rule.mode);
    const on = num(r.inlet_on, 20, 80, 'Radiator "on" temperature', errors, old.heatmeister_rule.inlet_on);
    const off = num(r.inlet_off, 15, 75, 'Radiator "off" temperature', errors, old.heatmeister_rule.inlet_off);
    if (off >= on) errors.push('The "off" temperature must be lower than the "on" temperature');
    v.heatmeister_rule = { mode, inlet_on: on, inlet_off: off };
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
