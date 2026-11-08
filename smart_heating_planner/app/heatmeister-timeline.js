'use strict';

// "Why the HeatMeisters run": a timeline per HeatMeister of its control state
// (idle, heat, overrun, defrost, …), with the measured values at that moment
// and the plan of the app next to it, so you can see why the fan ran.
//
// The data comes from Home Assistant's own history (only reading), like the
// chart on Home. The app stores nothing for it and talks to no HeatMeister.
//
// The meaning of the control states comes from SDR Engineering's protocol
// specification: 0 idle, 1 overrun, 2 manual, 3 heat, 4 defrost,
// 5 startup support, 6 cool, 7 slave, 8 sensor error. Firmware 2.9 sends the
// name, older firmware the number; both are understood.

const ha = require('./ha');
const settings = require('./settings');
const schedule = require('./schedule');
const heatmeister = require('./heatmeister');

const HOURS = 24;
const RANGES = [24, 72, 168];
const CACHE_MS = 60 * 1000;
const cache = new Map(); // hours -> { key, at, data }

const STATE_NAMES = ['idle', 'overrun', 'manual', 'heat', 'defrost', 'startup', 'cool', 'slave', 'sensor_error'];

// What every state means, in plain words.
const MEANING = {
  idle: 'No warm (or cold) water in the radiator, so the fan is off.',
  heat: 'Warm water reaches the radiator: the HeatMeister runs the fan to give off the heat. The speed follows how much heat there is.',
  overrun: 'The warm water stopped, but the radiator is still warm: the fan keeps running for a while (the overrun) to use the heat that is left.',
  manual: 'Manual control: the fan runs at a fixed speed and does not follow the radiator.',
  defrost: 'The HeatMeister saw a heat pump defrost cycle (the water in the radiator cools down fast). It adjusts the fan so the heat pump can finish its defrost sooner.',
  startup: 'Startup support. The protocol gives only this name; what the HeatMeister does exactly in this state is not described there.',
  cool: 'Cold water reaches the radiator (heat pump cooling): the fan runs to cool the room.',
  slave: 'This HeatMeister follows another one over MQTT and does what that one decides.',
  sensor_error: 'A temperature sensor gives no good value, so the HeatMeister cannot decide well.',
  running: 'The fan runs (this HeatMeister has no control state in Home Assistant).',
  off: 'The fan is off (this HeatMeister has no control state in Home Assistant).',
  unknown: 'No data in Home Assistant for this time.',
};

function num(v) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
}
const bad = (s) => s === undefined || s === null || s === 'unavailable' || s === 'unknown' || s === '';

function timeOf(e) {
  const t = e.lu !== undefined ? e.lu : e.lc;
  return typeof t === 'number' ? Math.round(t * 1000) : Date.parse(e.last_updated || e.last_changed);
}

// A control state from Home Assistant as a name ("heat"), also from a number ("3").
function stateName(s) {
  if (bad(s)) return null;
  const t = String(s).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (/^\d+$/.test(t)) return STATE_NAMES[Number(t)] || null;
  if (t === 'startup_support') return 'startup';
  if (t === 'sensorerror' || t === 'error') return 'sensor_error';
  return STATE_NAMES.includes(t) ? t : null;
}

// One line through time from all entities of one part (the old id and "_2"):
// sorted [[time, value]], unavailable as null. `parse` turns a state into a value.
function track(hist, ids, parse, from) {
  const pts = [];
  for (const id of ids || []) {
    for (const e of (hist && hist[id]) || []) pts.push([Math.max(from, timeOf(e)), bad(e.s) ? null : parse(e.s), id]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  // With two ids for one part, a value beats an "unavailable" of the other at the same time.
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && p[1] === null) continue;
    if (last && last[0] === p[0]) out[out.length - 1] = [p[0], p[1]];
    else out.push([p[0], p[1]]);
  }
  return out;
}

// The value at time t (the last point at or before t), or null.
function at(points, t) {
  let v = null;
  for (const [pt, pv] of points) { if (pt > t) break; v = pv; }
  return v;
}

// Time-weighted average and the max of a line between a and b.
function stats(points, a, b) {
  let sum = 0; let dur = 0; let max = null; let min = null;
  let cur = at(points, a);
  let t = a;
  const step = (until) => {
    if (cur !== null && until > t) { sum += cur * (until - t); dur += until - t; }
    t = until;
  };
  if (cur !== null) { max = cur; min = cur; }
  for (const [pt, pv] of points) {
    if (pt <= a) continue;
    if (pt >= b) break;
    step(pt);
    cur = pv;
    if (pv !== null) { max = max === null ? pv : Math.max(max, pv); min = min === null ? pv : Math.min(min, pv); }
  }
  step(b);
  return { avg: dur ? sum / dur : null, max, min, share: (b - a) ? dur / (b - a) : 0 };
}

// Share of the time between a and b that test(value) is true.
function shareWhere(points, a, b, testFn) {
  let yes = 0;
  let cur = at(points, a);
  let t = a;
  for (const [pt, pv] of points) {
    if (pt <= a) continue;
    if (pt >= b) break;
    if (cur !== null && testFn(cur)) yes += pt - t;
    t = pt; cur = pv;
  }
  if (cur !== null && testFn(cur)) yes += b - t;
  return b > a ? yes / (b - a) : 0;
}

// Turn a state line into segments [{ from, to, state }], same states joined.
function segmentsOf(points, from, to) {
  const out = [];
  let cur = at(points, from);
  let start = from;
  const push = (end) => {
    if (end <= start) return;
    const state = cur || 'unknown';
    const last = out[out.length - 1];
    if (last && last.state === state) last.to = end;
    else out.push({ from: start, to: end, state });
  };
  for (const [pt, pv] of points) {
    if (pt <= from) continue;
    if (pt >= to) break;
    if (pv === cur) continue;
    push(pt);
    cur = pv; start = pt;
  }
  push(to);
  return out;
}

// Short segments (less than a minute) are folded into the one before them,
// so a state that flickers does not fill the timeline.
function fold(segs, minMs = 60000) {
  const out = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && s.to - s.from < minMs) { last.to = s.to; continue; }
    if (last && last.state === s.state) { last.to = s.to; continue; }
    out.push({ ...s });
  }
  return out;
}

const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const fmt = (v, unit = ' °C') => (v === null || v === undefined ? '–' : `${r1(v).toFixed(1)}${unit}`);
const mins = (ms) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
};

// Why this segment: the meaning of the state plus what the numbers show.
function explain(seg) {
  const why = [];
  const s = seg.effective;
  const v = seg.values;
  if (seg.source === 'master') why.push(`This HeatMeister is a slave; the state is that of ${seg.master}.`);
  if (s === 'heat' || s === 'startup' || s === 'cool') {
    if (v.inlet_start !== null) {
      why.push(`Radiator in: ${fmt(v.inlet_start)} at the start${v.inlet_max !== null && v.inlet_max - v.inlet_start >= 0.5 ? `, up to ${fmt(v.inlet_max)}` : ''}${v.rate_start !== null ? ` (changing ${v.rate_start >= 0 ? '+' : ''}${v.rate_start.toFixed(2)} °C/min)` : ''}.`);
    }
    if (v.room_start !== null) why.push(`Room ${fmt(v.room_start)}${v.room_control && v.room_target !== null ? `, HeatMeister target ${fmt(v.room_target)}` : ''}.`);
  }
  if (s === 'defrost' && v.rate_min !== null) why.push(`Radiator in dropped up to ${v.rate_min.toFixed(2)} °C/min${v.inlet_max !== null && v.inlet_min !== null && v.inlet_max - v.inlet_min >= 0.5 ? ` (from ${fmt(v.inlet_max)} to ${fmt(v.inlet_min)})` : ''}.`);
  if (s === 'overrun' && v.inlet_start !== null) why.push(`Radiator in ${fmt(v.inlet_start)} when the warm water stopped; ${fmt(v.inlet_min)} at the end.`);
  if (s === 'idle' && v.inlet_start !== null && v.room_start !== null) why.push(`Radiator in ${fmt(v.inlet_start)}, room ${fmt(v.room_start)}: not warm enough to give off heat.`);
  if (v.fan_avg !== null && v.fan_max !== null && v.fan_max > 0) why.push(`Fan ${Math.round(v.fan_avg)} % on average, at most ${Math.round(v.fan_max)} %.`);
  if (v.boost) why.push('Boost was on: the fan runs at full speed.');
  if (v.manual && s !== 'manual') why.push('Manual control was on: the fan does not follow the radiator.');
  // The plan of the app at that moment.
  const plan = [];
  if (v.setpoint !== null) plan.push(`thermostat set to ${fmt(v.setpoint)}`);
  if (v.planned !== null) plan.push(`schedule ${fmt(v.planned)}`);
  if (v.heat_asked !== null) plan.push(v.heat_asked >= 0.5 ? 'thermostat asked for heat' : v.heat_asked > 0 ? 'thermostat asked for heat part of the time' : 'thermostat did not ask for heat');
  if (plan.length) why.push(`Plan: ${plan.join(', ')}.`);
  return { meaning: MEANING[s] || MEANING.unknown, why };
}

// What stands out over the whole period, per HeatMeister. Careful wording:
// these are hints from the numbers, not certainties.
function insights(dev) {
  const out = [];
  const total = dev.segments.reduce((n, s) => n + (s.to - s.from), 0) || 1;
  const time = {};
  for (const s of dev.segments) time[s.effective] = (time[s.effective] || 0) + (s.to - s.from);
  // What a slave copies from its master is told at the master, not twice.
  const own = dev.segments.filter((s) => s.source !== 'master');
  const ownTime = {};
  for (const s of own) ownTime[s.effective] = (ownTime[s.effective] || 0) + (s.to - s.from);
  const heat = dev.segments.filter((s) => s.effective === 'heat');
  const heatMs = heat.reduce((n, s) => n + (s.to - s.from), 0);
  if (heatMs) {
    const full = heat.reduce((n, s) => n + (s.to - s.from) * (s.values.full_share || 0), 0);
    const cold = heat.reduce((n, s) => n + (s.to - s.from) * (s.values.below_target_share || 0), 0);
    if (full / heatMs >= 0.5 && cold / heatMs >= 0.5) {
      out.push({ level: 'tip', text: `While heating, the fan ran at (almost) full speed ${Math.round((full / heatMs) * 100)} % of the time and the room stayed below its target. The radiator may give too little heat at this water temperature: a higher flow temperature or more fans could help.` });
    }
    const unasked = heat.filter((s) => s.source !== 'master' && s.values.heat_asked === 0);
    const unaskedMs = unasked.reduce((n, s) => n + (s.to - s.from), 0);
    if (unaskedMs >= 30 * 60000) {
      out.push({ level: 'info', text: `${mins(unaskedMs)} of heating while the thermostat did not ask for heat. The warm water came from somewhere else (for example the heat pump's own weather curve or hot water), not from the plan.` });
    }
    const hot = heat.filter((s) => s.values.room_control && s.values.room_start !== null && s.values.room_target !== null && s.values.room_start > s.values.room_target + 0.5 && (s.values.fan_avg || 0) > 20);
    if (hot.length) out.push({ level: 'info', text: `${hot.length}× the fan ran while the room was already above the HeatMeister's target. Check that the room temperature it gets is right.` });
  }
  if (ownTime.overrun && ownTime.overrun / total >= 0.15) out.push({ level: 'info', text: `Overrun ${mins(ownTime.overrun)} (${Math.round((ownTime.overrun / total) * 100)} % of the time). A long overrun uses left-over heat; if it bothers you (noise), the overrun can be made shorter in the HeatMeister's settings.` });
  const defrosts = own.filter((s) => s.effective === 'defrost').length;
  if (defrosts) out.push({ level: 'info', text: `${defrosts}× a heat pump defrost cycle seen.` });
  if (ownTime.manual) out.push({ level: 'warn', text: `Manual control for ${mins(ownTime.manual)}: then the fan does not follow the heat.` });
  if (ownTime.sensor_error) out.push({ level: 'warn', text: `Sensor error for ${mins(ownTime.sensor_error)}: check the temperature sensors and their cables.` });
  return { time, items: out };
}

// The whole timeline (pure: easy to test).
//   devices: [{ prefix, name, follows, all: { part: [entity ids] } }]
//   hist: Home Assistant history by entity id (minimal response)
//   climateHist: the thermostat's history (with attributes) or []
//   plannedAt(t): the schedule temperature at time t, or null
function build({ devices, hist, climateHist = [], plannedAt = () => null, from, to }) {
  // The thermostat: setpoint and "asks for heat" over time.
  const setpoint = [];
  const asking = [];
  let attrs = {};
  for (const e of climateHist || []) {
    if (e.a) attrs = e.a;
    const t = Math.max(from, timeOf(e));
    const off = bad(e.s);
    setpoint.push([t, off || e.s === 'off' ? null : num(attrs.temperature)]);
    asking.push([t, off || !attrs.hvac_action ? null : attrs.hvac_action === 'heating' ? 1 : 0]);
  }

  const tracks = devices.map((d) => {
    const all = d.all || {};
    const tr = (part, parse = num) => track(hist, all[part], parse, from);
    return {
      d,
      state: tr('control_state', stateName),
      fan: tr('fan_speed'),
      fanOn: tr('fan_on', (s) => (s === 'on' ? 1 : 0)),
      inlet: tr('inlet'),
      rate: tr('inlet_rate'),
      delta: tr('delta'),
      room: tr('room'),
      target: tr('room_target'),
      roomControl: tr('room_control', (s) => (s === 'on' ? 1 : 0)),
      boost: tr('boost', (s) => (s === 'on' ? 1 : 0)),
      manual: tr('manual_mode', (s) => (s === 'on' ? 1 : 0)),
    };
  });
  // The master: the one chosen to follow, else the first with its own (non-slave) states.
  const byPrefix = new Map(tracks.map((t) => [t.d.prefix, t]));
  const ownStates = (t) => t.state.some(([, v]) => v && v !== 'slave');
  const firstMaster = tracks.find(ownStates);

  const out = tracks.map((t) => {
    const masterT = (t.d.follows && byPrefix.get(t.d.follows)) || (firstMaster !== t ? firstMaster : null);
    let source = 'own';
    let line = t.state;
    if (!t.state.some(([, v]) => v)) {
      if (masterT && t.d.follows) { source = 'master'; line = masterT.state; } else {
        // No control state at all: only "running" or "off" from the fan.
        source = 'fan';
        const fanLine = t.fan.length ? t.fan : t.fanOn;
        line = fanLine.map(([pt, v]) => [pt, v === null ? null : v > 0 ? 'running' : 'off']);
      }
    }
    // A slave: its reason is the state of its master at that time.
    if (masterT && masterT !== t && line.some(([, v]) => v === 'slave')) {
      const times = [...new Set([...line, ...masterT.state].map(([pt]) => pt))].sort((a, b) => a - b);
      line = times.map((pt) => {
        const own = at(line, pt);
        const m = at(masterT.state, pt);
        return [pt, own === 'slave' && m && m !== 'slave' ? `${m}|m` : own];
      });
    }
    const segs = fold(segmentsOf(line, from, to)).map((raw) => {
      const viaMaster = source === 'master' || /\|m$/.test(raw.state);
      const effective = raw.state.replace(/\|m$/, '');
      const s = { ...raw, state: /\|m$/.test(raw.state) ? 'slave' : raw.state };
      const segSource = viaMaster ? 'master' : source;
      const fanSt = stats(t.fan, s.from, s.to);
      const inSt = stats(t.inlet, s.from, s.to);
      const rateSt = stats(t.rate, s.from, s.to);
      const roomNow = at(t.room, s.from);
      const targetNow = at(t.target, s.from);
      const values = {
        inlet_start: at(t.inlet, s.from), inlet_max: inSt.max, inlet_min: inSt.min,
        rate_start: at(t.rate, s.from + 1) ?? null, rate_min: rateSt.min,
        delta_avg: stats(t.delta, s.from, s.to).avg,
        room_start: roomNow, room_end: at(t.room, s.to),
        room_target: targetNow, room_control: at(t.roomControl, s.from) === 1,
        fan_avg: fanSt.avg, fan_max: fanSt.max,
        full_share: shareWhere(t.fan, s.from, s.to, (v) => v >= 90),
        below_target_share: t.target.length ? shareWhere(t.room, s.from, s.to, (v) => { const tg = at(t.target, s.from); return tg !== null && v < tg - 0.2; }) : 0,
        boost: stats(t.boost, s.from, s.to).max === 1,
        manual: stats(t.manual, s.from, s.to).max === 1,
        setpoint: at(setpoint, s.from),
        planned: plannedAt(s.from),
        heat_asked: asking.length ? r1(stats(asking, s.from, s.to).avg) : null,
      };
      for (const k of ['inlet_start', 'inlet_max', 'inlet_min', 'delta_avg', 'room_start', 'room_end', 'fan_avg', 'fan_max']) values[k] = r1(values[k]);
      for (const k of ['rate_start', 'rate_min']) values[k] = values[k] === null || values[k] === undefined ? null : Math.round(values[k] * 100) / 100;
      const seg = { from: s.from, to: s.to, state: s.state, effective, source: segSource, master: masterT ? masterT.d.name : null, values };
      return { ...seg, ...explain(seg) };
    });
    const dev = { prefix: t.d.prefix, name: t.d.name, source, master: source === 'master' && masterT ? masterT.d.name : null, segments: segs };
    return { ...dev, ...insights(dev) };
  });

  // The plan next to it: the setpoint and whether the thermostat asked for heat.
  const plan = {
    setpoint: segmentsOf(setpoint.map(([pt, v]) => [pt, v === null ? null : String(v)]), from, to)
      .map((s) => ({ from: s.from, to: s.to, value: s.state === 'unknown' ? null : Number(s.state) })),
    asking: segmentsOf(asking.map(([pt, v]) => [pt, v === null ? null : v ? 'yes' : 'no']), from, to)
      .map((s) => ({ from: s.from, to: s.to, value: s.state === 'unknown' ? null : s.state === 'yes' })),
  };
  return { from, to, devices: out, plan, meanings: MEANING };
}

// The HeatMeisters to show: the ones chosen in Settings, else all found.
function devicesFrom(states, s) {
  const found = heatmeister.discover(states);
  const chosen = (s.heatmeisters || []).filter((h) => found.some((f) => f.prefix === h.prefix));
  if (!chosen.length) return found.map((f) => ({ prefix: f.prefix, name: f.name, follows: '', all: f.all }));
  return chosen.map((h) => {
    const f = found.find((x) => x.prefix === h.prefix);
    return { prefix: h.prefix, name: h.name || f.name, follows: h.follows || '', all: f.all };
  });
}

async function get(now = Date.now(), hours = HOURS) {
  hours = RANGES.includes(Number(hours)) ? Number(hours) : HOURS;
  const s = settings.get();
  const states = await ha.call({ type: 'get_states' });
  const devices = devicesFrom(states, s);
  const key = JSON.stringify([s.thermostat, devices.map((d) => [d.prefix, d.follows])]);
  const c = cache.get(hours);
  if (c && c.key === key && now - c.at < CACHE_MS) return { ...c.data, hours };
  const from = now - hours * 3600 * 1000;
  const start = new Date(from).toISOString();
  const end = new Date(now).toISOString();
  const parts = ['control_state', 'fan_speed', 'fan_on', 'inlet', 'inlet_rate', 'delta', 'room', 'room_target', 'room_control', 'boost', 'manual_mode'];
  const ids = [...new Set(devices.flatMap((d) => parts.flatMap((p) => (d.all && d.all[p]) || [])))];
  const hist = ids.length ? await ha.call({
    type: 'history/history_during_period', start_time: start, end_time: end,
    entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false,
  }, 30000) : {};
  const climate = s.thermostat ? await ha.call({
    type: 'history/history_during_period', start_time: start, end_time: end,
    entity_ids: [s.thermostat], minimal_response: false, no_attributes: false, significant_changes_only: false,
  }, 30000) : {};
  const tz = ha.state.timeZone || 'UTC';
  const plannedAt = (t) => { const p = schedule.current(s.schedule, t, tz); return p ? p.current.temp : null; };
  const data = build({ devices, hist, climateHist: (climate && climate[s.thermostat]) || [], plannedAt, from, to: now });
  if (devices.length) cache.set(hours, { key, at: now, data }); else cache.delete(hours);
  return { ...data, hours };
}

function clear() { cache.clear(); }

module.exports = { get, build, explain, insights, stateName, track, segmentsOf, fold, stats, devicesFrom, clear, HOURS, RANGES, MEANING };
