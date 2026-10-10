'use strict';

// The chart on Home: the last 24 hours of the thermostat's room temperature
// and setpoint, and of the temperature sensors chosen in Settings.
// The data comes from Home Assistant's own history (only reading), so the
// app stores nothing for it.

const ha = require('./ha');
const settings = require('./settings');

const HOURS = 24;
const MAX_POINTS = 300; // per line, so the page stays light
const CACHE_MS = 60 * 1000;
let cache = null; // { key, at, data }

function num(v) {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) ? n : null;
}

// Home Assistant sends times as seconds (compressed format).
function timeOf(e) {
  const t = e.lu !== undefined ? e.lu : e.lc;
  return typeof t === 'number' ? Math.round(t * 1000) : Date.parse(e.last_updated || e.last_changed);
}

// Keep at most MAX_POINTS: one point per time bucket (the last one in it).
// A gap (no value) stays a gap.
function thin(points, from, to) {
  if (points.length <= MAX_POINTS) return points;
  const size = (to - from) / MAX_POINTS;
  const out = [];
  let bucket = null;
  for (const p of points) {
    const b = Math.floor((p[0] - from) / size);
    if (b === bucket && out.length) out[out.length - 1] = p;
    else out.push(p);
    bucket = b;
  }
  return out;
}

// Remove repeats: only the points where the value changes.
function changes(points) {
  const out = [];
  for (const p of points) {
    if (out.length && out[out.length - 1][1] === p[1]) continue;
    out.push(p);
  }
  return out;
}

// Turn Home Assistant's history into lines for the chart.
function build(climateHist, sensorHist, s, names, from, to) {
  const series = [];
  if (s.thermostat) {
    const list = (climateHist && climateHist[s.thermostat]) || [];
    const room = [];
    const setpoint = [];
    let attrs = {};
    for (const e of list) {
      if (e.a) attrs = e.a;
      const t = Math.max(from, timeOf(e));
      const off = e.s === 'unavailable' || e.s === 'unknown';
      room.push([t, off ? null : num(attrs.current_temperature)]);
      setpoint.push([t, off || e.s === 'off' ? null : num(attrs.temperature)]);
    }
    series.push({ id: 'room', entity_id: s.thermostat, name: 'Room (thermostat)', kind: 'room', points: thin(changes(room), from, to) });
    series.push({ id: 'setpoint', entity_id: s.thermostat, name: 'Setpoint', kind: 'setpoint', points: thin(changes(setpoint), from, to) });
  }
  for (const id of s.chart_sensors || []) {
    const list = (sensorHist && sensorHist[id]) || [];
    const pts = list.map((e) => [Math.max(from, timeOf(e)), num(e.s)]);
    series.push({ id, entity_id: id, name: names[id] || id, kind: 'sensor', points: thin(changes(pts), from, to) });
  }
  return { from, to, series };
}

async function get(now = Date.now()) {
  const s = settings.get();
  const key = JSON.stringify([s.thermostat, s.chart_sensors]);
  if (cache && cache.key === key && now - cache.at < CACHE_MS) return cache.data;
  const from = now - HOURS * 3600 * 1000;
  const start = new Date(from).toISOString();
  const end = new Date(now).toISOString();
  // The thermostat: with its attributes (room temperature and setpoint).
  const climateHist = s.thermostat ? await ha.call({
    type: 'history/history_during_period', start_time: start, end_time: end,
    entity_ids: [s.thermostat], minimal_response: false, no_attributes: false, significant_changes_only: false,
  }, 30000) : {};
  const sensors = s.chart_sensors || [];
  const sensorHist = sensors.length ? await ha.call({
    type: 'history/history_during_period', start_time: start, end_time: end,
    entity_ids: sensors, minimal_response: true, no_attributes: true, significant_changes_only: false,
  }, 30000) : {};
  // Names of the sensors, from their current state.
  const names = {};
  if (sensors.length) {
    const states = await ha.call({ type: 'get_states' });
    for (const st of states) if (sensors.includes(st.entity_id)) names[st.entity_id] = (st.attributes && st.attributes.friendly_name) || st.entity_id;
  }
  const data = build(climateHist, sensorHist, s, names, from, now);
  cache = { key, at: now, data };
  return data;
}

function clear() { cache = null; }

module.exports = { get, build, thin, changes, clear, HOURS, MAX_POINTS };
