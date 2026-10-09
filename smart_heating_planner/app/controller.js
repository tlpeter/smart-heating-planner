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
const heatmeister = require('./heatmeister');
const { decideTarget, heatDemand } = require('./decide');
const { readJson, writeJsonAtomic } = require('./jsonstore');

const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
// lastHomeAt: when someone was last home. track: last positions per person
// (on the way home). lastSent / writes: what the app sent to the thermostat.
const memory = { lastHomeAt: null, track: {}, lastKey: null, lastSent: null, writes: [], ...readJson(MEMORY_FILE, {}) };
delete memory.hm; // older versions
// A write from an earlier period with control on says nothing about now.
if (!options.allow_control) memory.lastSent = null;

let status = { ready: false, message: 'Starting…' };
let lastControl = null; // { at, sent, why, error }
let lastMqtt = null; // { at, sent, error }
let timer = null;
let busy = false;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// The room temperature for the HeatMeisters: the chosen sensor, or the
// thermostat's own room temperature.
function roomTemperature(states, s, thermostat) {
  if (s.room_temperature_source) {
    const st = (states || []).find((x) => x.entity_id === s.room_temperature_source);
    return st ? num(st.state) : null;
  }
  return thermostat && thermostat.available ? thermostat.current : null;
}

// With "Send room temperature to HeatMeisters" on: send it to each topic
// when it changed, and every few minutes.
async function sendRoomTemperature(st, now) {
  const s = settings.get();
  memory.mqtt = memory.mqtt || {};
  const value = st.roomTemperature.value;
  const topics = s.heatmeisters.map((h) => h.topic).filter(Boolean);
  // A new setpoint on the thermostat (by the app, the schedule in Node-RED or
  // by hand): send right away, like the Node-RED flow does.
  const target = st.thermostat && st.thermostat.available ? st.thermostat.target : null;
  const targetChanged = target !== null && memory.mqttTarget !== undefined && memory.mqttTarget !== null && target !== memory.mqttTarget;
  if (target !== null) memory.mqttTarget = target;
  let sent = 0;
  for (const topic of topics) {
    if (!heatmeister.shouldPublish({ value, last: memory.mqtt[topic], now, intervalMinutes: s.room_temperature_interval, targetChanged })) continue;
    try {
      await ha.publishRoomTemperature(topic, value, topics);
      memory.mqtt[topic] = { value, at: now };
      sent++;
      lastMqtt = { at: now, sent: true };
    } catch (err) {
      ha.warn('Sending the room temperature failed:', topic, err.message);
      lastMqtt = { at: now, sent: false, error: err.message };
      break; // MQTT is down: try again next refresh
    }
  }
  // Forget topics that are no longer used.
  for (const t of Object.keys(memory.mqtt)) if (!topics.includes(t)) delete memory.mqtt[t];
  if (sent || lastMqtt) writeJsonAtomic(MEMORY_FILE, memory);
  st.roomTemperature.last = lastMqtt;
  st.heatmeisters = st.heatmeisters.map((h) => ({ ...h, sent: memory.mqtt[h.topic] || null }));
  return st;
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
  const who = presence.whoIsHome(states, s.persons, s.tracker_types);
  if (who.anyoneHome) memory.lastHomeAt = now;
  const delay = presence.withAwayDelay(who.anyoneHome, memory.lastHomeAt, s.away_delay_minutes, now);
  const way = presence.onTheWay(states, s.persons, who, s, memory, now);
  const thermostat = thermostatFrom(states, s.thermostat);
  const hold = holdStore.get(now);

  // Without persons that count there is no presence: follow the schedule.
  const noPersons = !s.persons.some((p) => p.counts);
  // Option "only when someone is home" off: always the schedule.
  const ignored = s.schedule_needs_presence === false;
  const pres = { effectiveHome: noPersons || ignored || delay.effectiveHome, waitingUntil: ignored ? null : delay.waitingUntil, approaching: way.approaching, ignored };
  const advice = decideTarget({ now, timeZone: tz, point, presence: pres, hold, settings: s, thermostat });

  const demand = heatDemand(thermostat);
  const roomTemp = roomTemperature(states, s, thermostat);
  const heatmeisters = s.heatmeisters.map((h) => ({
    ...heatmeister.read(states, h.prefix),
    name: h.name,
    topic: h.topic,
    sent: (memory.mqtt || {})[h.topic] || null,
  }));

  // One activity line when the advice changes.
  const key = JSON.stringify([advice.target, advice.source]);
  if (key !== memory.lastKey) {
    memory.lastKey = key;
    activity.add({
      event: 'advice',
      target: advice.target,
      source: advice.source,
      reason: advice.reason,
      thermostat: thermostat.target ?? null,
      sent: false,
    }, now);
  }
  writeJsonAtomic(MEMORY_FILE, memory);

  return {
    ready: true,
    at: now,
    mode: options.allow_control ? 'control' : 'watch',
    timeZone: tz,
    setup: { thermostat: !!s.thermostat, persons: s.persons.filter((p) => p.counts).length, heatmeisters: s.heatmeisters.length },
    advice,
    thermostat,
    presence: { ...who, ...pres, onTheWay: way.people, noPersons },
    schedule: point,
    hold,
    demand,
    heatmeisters,
    roomTemperature: {
      allowed: options.allow_heatmeister_temperature,
      value: roomTemp,
      source: s.room_temperature_source || 'thermostat',
      last: lastMqtt,
    },
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
    if (options.allow_heatmeister_temperature && settings.get().heatmeisters.length) st = await sendRoomTemperature(st, now);
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
