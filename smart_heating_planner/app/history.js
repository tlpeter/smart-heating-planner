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

// Add the value of now at the end, when the history does not have it yet
// (Home Assistant writes its history every few seconds).
function withNow(points, value, to) {
  if (value === undefined) return points;
  const last = points.length ? points[points.length - 1][1] : undefined;
  if (last === value) return points;
  return [...points, [to, value]];
}

// Turn Home Assistant's history into lines for the chart.
// `current`: entity_id -> its state now (optional).
function build(climateHist, sensorHist, s, names, from, to, current = {}) {
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
    const now = current[s.thermostat];
    const nowOff = !now || now.state === 'unavailable' || now.state === 'unknown';
    const na = (now && now.attributes) || {};
    series.push({ id: 'room', entity_id: s.thermostat, name: 'Room (thermostat)', kind: 'room', points: withNow(thin(changes(room), from, to), now ? (nowOff ? null : num(na.current_temperature)) : undefined, to) });
    series.push({ id: 'setpoint', entity_id: s.thermostat, name: 'Setpoint', kind: 'setpoint', points: withNow(thin(changes(setpoint), from, to), now ? (nowOff || now.state === 'off' ? null : num(na.temperature)) : undefined, to) });
  }
  for (const id of s.chart_sensors || []) {
    const list = (sensorHist && sensorHist[id]) || [];
    const pts = list.map((e) => [Math.max(from, timeOf(e)), num(e.s)]);
    const now = current[id];
    series.push({ id, entity_id: id, name: names[id] || id, kind: 'sensor', points: withNow(thin(changes(pts), from, to), now ? num(now.state) : undefined, to) });
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
  // The names of the sensors and the values of now.
  const names = {};
  const current = {};
  const wanted = [s.thermostat, ...sensors].filter(Boolean);
  if (wanted.length) {
    const states = await ha.call({ type: 'get_states' });
    for (const st of states) {
      if (!wanted.includes(st.entity_id)) continue;
      current[st.entity_id] = st;
      names[st.entity_id] = (st.attributes && st.attributes.friendly_name) || st.entity_id;
    }
  }
  const data = build(climateHist, sensorHist, s, names, from, now, current);
  // Only keep it for a minute when there is a history (a fresh Home
  // Assistant may not have written it yet).
  const some = data.series.some((x) => x.points.length > 1);
  cache = some ? { key, at: now, data } : null;
  return data;
}

function clear() { cache = null; }

module.exports = { get, build, thin, changes, withNow, clear, HOURS, MAX_POINTS };
