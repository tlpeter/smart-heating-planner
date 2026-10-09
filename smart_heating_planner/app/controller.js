'use strict';

// Every refresh: read the states from Home Assistant, work out the advice and
// keep it for the page.
//
// With "Allow control" off (default) the app only WATCHES.
// With it on, it sets the thermostat's target when the advice differs, and
// notices when someone changed the thermostat by hand (then it keeps that
// temperature for a while, like a manual hold).

const path = require('path');
const ha = require('./ha');
const { options, DATA_DIR } = require('./options');
const settings = require('./settings');
const schedule = require('./schedule');
const presence = require('./presence');
const holdStore = require('./hold');
const activity = require('./activity');
const control = require('./control');
const { decideTarget, decideHeatmeister, heatDemand } = require('./decide');
const { readJson, writeJsonAtomic } = require('./jsonstore');

const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
// lastHomeAt: when someone was last home. hm: last Heatmeister advice per name.
// lastSent / writes: what the app sent to the thermostat, and when.
const memory = { lastHomeAt: null, hm: {}, lastKey: null, lastSent: null, writes: [], ...readJson(MEMORY_FILE, {}) };
// A write from an earlier period with control on says nothing about now.
if (!options.allow_control) memory.lastSent = null;

let status = { ready: false, message: 'Starting…' };
let lastControl = null; // { at, sent, why, error }
let timer = null;
let busy = false;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function thermostatFrom(states, id) {
  const st = id ? (states || []).find((s) => s.entity_id === id) : null;
  if (!st || st.state === 'unavailable' || st.state === 'unknown') {
    return { entity_id: id || null, available: false, state: st ? st.state : 'missing' };
  }
  const a = st.attributes || {};
  return {
    entity_id: id,
    name: a.friendly_name || id,
    available: true,
    state: st.state, // heat / off / auto
    target: num(a.temperature),
    current: num(a.current_temperature),
    hvac_action: a.hvac_action || null, // heating / idle / off
  };
}

// Work out the advice from a list of states. Changes the memory (last home,
// Heatmeister gap) and writes a line to the activity log when the advice
// changes. Returns the status for the page.
function evaluate(states, now = Date.now()) {
  const s = settings.get();
  const tz = ha.state.timeZone || 'UTC';
  const point = schedule.current(s.schedule, now, tz);
  const who = presence.whoIsHome(states, s.persons);
  if (who.anyoneHome) memory.lastHomeAt = now;
  const delay = presence.withAwayDelay(who.anyoneHome, memory.lastHomeAt, s.away_delay_minutes, now);
  const way = presence.onTheWay(states, s.proximity);
  const thermostat = thermostatFrom(states, s.thermostat);
  const hold = holdStore.get(now);

  // Without persons there is no presence: follow the schedule.
  const noPersons = !s.persons.length;
  const pres = { effectiveHome: noPersons || delay.effectiveHome, waitingUntil: delay.waitingUntil, approaching: way.approaching };
  const advice = decideTarget({ now, timeZone: tz, point, presence: pres, hold, settings: s, thermostat });

  const demand = heatDemand(thermostat);
  const byId = new Map((states || []).map((x) => [x.entity_id, x]));
  const heatmeisters = s.heatmeisters.map((h) => {
    const ctl = h.control_entity ? byId.get(h.control_entity) : null;
    const inletSt = h.inlet_entity ? byId.get(h.inlet_entity) : null;
    const inlet = inletSt ? num(inletSt.state) : null;
    const d = decideHeatmeister({ rule: s.heatmeister_rule, demand, inlet, prevOn: memory.hm[h.name] === true });
    memory.hm[h.name] = d.on;
    return { name: h.name, control_entity: h.control_entity, state: ctl ? ctl.state : null, inlet, advice: d.on, reason: d.reason };
  });

  // One activity line when the advice changes.
  const key = JSON.stringify([advice.target, advice.source, heatmeisters.map((h) => h.advice)]);
  if (key !== memory.lastKey) {
    memory.lastKey = key;
    activity.add({
      event: 'advice',
      target: advice.target,
      source: advice.source,
      reason: advice.reason,
      thermostat: thermostat.target ?? null,
      heatmeisters: heatmeisters.map((h) => ({ name: h.name, on: h.advice })),
      sent: false,
    }, now);
  }
  writeJsonAtomic(MEMORY_FILE, memory);

  return {
    ready: true,
    at: now,
    mode: options.allow_control ? 'control' : 'watch',
    timeZone: tz,
    setup: { thermostat: !!s.thermostat, persons: s.persons.length, heatmeisters: s.heatmeisters.length },
    advice,
    thermostat,
    presence: { ...who, ...pres, distanceKm: way.distanceKm, direction: way.direction, noPersons },
    schedule: point,
    hold,
    demand,
    heatmeisters,
    control: {
      allowed: options.allow_control,
      last: lastControl,
      lastSent: memory.lastSent,
      writesToday: (memory.writes || []).filter((t) => now - t < 86400000).length,
      maxWritesPerDay: options.max_writes_per_day,
    },
  };
}

// With "Allow control" on: notice a change by hand, then send the advice.
async function act(states, current, now) {
  const s = settings.get();
  let st = current;

  const manual = control.manualChange({ now, thermostat: st.thermostat, lastSent: memory.lastSent });
  if (manual !== null) {
    const point = schedule.current(s.schedule, now, ha.state.timeZone || 'UTC');
    const until = s.manual_change_until === 'next' && point ? point.next.at : now + s.hold_default_minutes * 60000;
    const r = holdStore.set(manual, until, now, 'thermostat');
    // Take the new value as "what the thermostat has" so it is not noticed again.
    memory.lastSent = { temp: manual, at: now };
    if (r.ok) {
      ha.log('Thermostat changed by hand to', manual, '°C - kept until', new Date(until).toISOString());
      activity.add({ event: 'manual', target: manual, source: 'hold', reason: `Changed on the thermostat to ${manual} °C`, thermostat: manual, sent: false }, now);
    }
    st = evaluate(states, now);
  }

  const decision = control.shouldSend({ now, advice: st.advice, thermostat: st.thermostat, memory, maxWritesPerDay: options.max_writes_per_day });
  if (!decision.send) {
    lastControl = { at: now, sent: false, why: decision.why };
  } else {
    try {
      await ha.setTemperature(s.thermostat, st.advice.target, s.thermostat);
      control.recordWrite(memory, st.advice.target, now);
      lastControl = { at: now, sent: true, why: `set to ${st.advice.target} °C` };
      activity.add({ event: 'sent', target: st.advice.target, source: st.advice.source, reason: st.advice.reason, thermostat: st.thermostat.target, sent: true }, now);
    } catch (err) {
      ha.warn('Setting the thermostat failed:', err.message);
      // Count a failed try too, so a broken thermostat is not hammered.
      control.recordWrite(memory, st.thermostat.target, now);
      lastControl = { at: now, sent: false, error: err.message };
      activity.add({ event: 'error', target: st.advice.target, source: st.advice.source, reason: `Sending failed: ${err.message}`, thermostat: st.thermostat.target, sent: false }, now);
    }
    writeJsonAtomic(MEMORY_FILE, memory);
  }
  st.control.last = lastControl;
  st.control.lastSent = memory.lastSent;
  st.control.writesToday = (memory.writes || []).filter((t) => now - t < 86400000).length;
  return st;
}

async function refresh() {
  if (!ha.state.connected) {
    status = { ready: false, message: ha.state.lastError || 'Not connected to Home Assistant yet' };
    return status;
  }
  // One refresh at a time: a page request and the timer can come together.
  if (busy) return status;
  busy = true;
  try {
    const states = await ha.call({ type: 'get_states' });
    const now = Date.now();
    let st = evaluate(states, now);
    if (options.allow_control && settings.get().thermostat) st = await act(states, st, now);
    status = st;
  } catch (err) {
    ha.warn('Refresh failed:', err.message);
    status = { ...status, error: err.message };
  } finally {
    busy = false;
  }
  return status;
}

function start() {
  if (timer) clearInterval(timer);
  timer = setInterval(refresh, options.refresh_seconds * 1000);
  refresh();
}

module.exports = { evaluate, refresh, start, getStatus: () => status, thermostatFrom };
