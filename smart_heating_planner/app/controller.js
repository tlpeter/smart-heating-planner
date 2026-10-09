'use strict';

// Every refresh: read the states from Home Assistant, work out the advice and
// keep it for the page. In this version the app only WATCHES: it sends
// nothing to the thermostat or the Heatmeisters.

const path = require('path');
const ha = require('./ha');
const { options, DATA_DIR } = require('./options');
const settings = require('./settings');
const schedule = require('./schedule');
const presence = require('./presence');
const holdStore = require('./hold');
const activity = require('./activity');
const { decideTarget, decideHeatmeister, heatDemand } = require('./decide');
const { readJson, writeJsonAtomic } = require('./jsonstore');

const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
// lastHomeAt: when someone was last home. hm: last Heatmeister advice per name.
const memory = { lastHomeAt: null, hm: {}, lastKey: null, ...readJson(MEMORY_FILE, {}) };

let status = { ready: false, message: 'Starting…' };
let timer = null;

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
      target: advice.target,
      source: advice.source,
      reason: advice.reason,
      thermostat: thermostat.target ?? null,
      heatmeisters: heatmeisters.map((h) => ({ name: h.name, on: h.advice })),
      sent: false, // this version never sends anything
    }, now);
  }
  writeJsonAtomic(MEMORY_FILE, memory);

  return {
    ready: true,
    at: now,
    mode: 'watch',
    timeZone: tz,
    setup: { thermostat: !!s.thermostat, persons: s.persons.length, heatmeisters: s.heatmeisters.length },
    advice,
    thermostat,
    presence: { ...who, ...pres, distanceKm: way.distanceKm, direction: way.direction, noPersons },
    schedule: point,
    hold,
    demand,
    heatmeisters,
  };
}

async function refresh() {
  if (!ha.state.connected) {
    status = { ready: false, message: ha.state.lastError || 'Not connected to Home Assistant yet' };
    return status;
  }
  try {
    const states = await ha.call({ type: 'get_states' });
    status = evaluate(states);
  } catch (err) {
    ha.warn('Refresh failed:', err.message);
    status = { ...status, ready: status.ready, error: err.message };
  }
  return status;
}

function start() {
  if (timer) clearInterval(timer);
  timer = setInterval(refresh, options.refresh_seconds * 1000);
  refresh();
}

module.exports = { evaluate, refresh, start, getStatus: () => status, thermostatFrom };
