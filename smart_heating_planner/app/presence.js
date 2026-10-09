'use strict';

// Who is home, and who is on the way home?
//
// Uses Home Assistant "person" entities and the trackers behind them. A
// person can have several trackers: the Companion App (GPS), the router or
// network (router), and Bluetooth. You choose which kinds count; a person is
// home when one of their counted trackers is in the Home zone.
// A person whose location is not known counts as home: better warm than cold.
//
// "On the way home" needs no extra integration: the app works out the
// distance from the person's GPS position to the Home zone, and whether it is
// getting smaller.

// Kinds of tracker, as Home Assistant calls them (attribute source_type).
const TYPE_OF = { gps: 'gps', router: 'router', bluetooth: 'bluetooth', bluetooth_le: 'bluetooth' };
const BAD = new Set(['unknown', 'unavailable', undefined]);

function friendly(st, id) {
  return (st && st.attributes && st.attributes.friendly_name) || id;
}

// Settings may still have plain entity ids (older versions).
function normalisePersons(list) {
  return (list || []).map((p) => (typeof p === 'string'
    ? { entity_id: p, counts: true, coming_home: true }
    : { entity_id: p.entity_id, counts: p.counts !== false, coming_home: p.coming_home !== false }));
}

// One person: home, away or unknown, and through which trackers.
// types: { gps, router, bluetooth } - true when that kind counts.
function personState(byId, id, types) {
  const st = byId.get(id);
  const name = friendly(st, id);
  if (!st) return { entity_id: id, name, state: 'unknown', zone: 'missing', trackers: [] };
  const list = Array.isArray(st.attributes && st.attributes.device_trackers) ? st.attributes.device_trackers : [];
  const trackers = list.map((tid) => {
    const t = byId.get(tid);
    const type = TYPE_OF[t && t.attributes && t.attributes.source_type] || 'router';
    return { entity_id: tid, type, state: t ? t.state : 'missing', used: types[type] !== false };
  });
  // Without trackers in the attributes: use the person's own state.
  if (!trackers.length) {
    if (BAD.has(st.state)) return { entity_id: id, name, state: 'unknown', zone: st.state, trackers };
    return { entity_id: id, name, state: st.state === 'home' ? 'home' : 'away', zone: st.state, trackers };
  }
  const used = trackers.filter((t) => t.used && !BAD.has(t.state) && t.state !== 'missing');
  if (!used.length) return { entity_id: id, name, state: 'unknown', zone: 'no counted tracker', trackers };
  if (used.some((t) => t.state === 'home')) return { entity_id: id, name, state: 'home', zone: 'home', trackers };
  // Away: show the zone from GPS when there is one (e.g. "Werk").
  const gps = used.find((t) => t.type === 'gps');
  return { entity_id: id, name, state: 'away', zone: gps ? gps.state : 'not_home', trackers };
}

// states: HA states. persons: settings list. types: tracker kinds.
// Returns { home, away, unknown, anyoneHome, people }.
function whoIsHome(states, persons, types = {}) {
  const byId = new Map((states || []).map((s) => [s.entity_id, s]));
  const out = { home: [], away: [], unknown: [], anyoneHome: false, people: [] };
  for (const p of normalisePersons(persons)) {
    const r = personState(byId, p.entity_id, types);
    const item = { entity_id: r.entity_id, name: r.name, state: r.zone, counts: p.counts, trackers: r.trackers };
    out.people.push({ ...item, status: r.state });
    if (!p.counts) continue;
    out[r.state].push(item);
  }
  out.anyoneHome = out.home.length > 0 || out.unknown.length > 0;
  return out;
}

// Distance in km between two points (haversine).
function km(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function position(st) {
  const a = (st && st.attributes) || {};
  const lat = Number(a.latitude);
  const lon = Number(a.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0) ? { lat, lon } : null;
}

const MOVE_KM = 0.1;               // smaller changes are GPS noise
const FRESH_MS = 20 * 60000;       // a position older than this says nothing about "now"

// Who is on the way home? memory.track keeps the last positions per person
// (changed by this function). Only persons with coming_home on, who are away.
// Returns { approaching, people: [{ entity_id, name, km, towards }] }.
function onTheWay(states, persons, who, cfg, memory, now) {
  const byId = new Map((states || []).map((s) => [s.entity_id, s]));
  const home = position(byId.get('zone.home'));
  const out = { approaching: false, people: [] };
  memory.track = memory.track || {};
  if (!home) return out;
  for (const p of normalisePersons(persons)) {
    const person = who.people.find((x) => x.entity_id === p.entity_id);
    if (!p.counts || !p.coming_home || !person || person.status !== 'away') {
      delete memory.track[p.entity_id];
      continue;
    }
    // The GPS tracker's own position; the person's position can come from
    // another tracker (a router or Bluetooth tracker at home).
    const gps = person.trackers.find((t) => t.type === 'gps' && t.used && position(byId.get(t.entity_id)));
    const pos = gps ? position(byId.get(gps.entity_id)) : position(byId.get(p.entity_id));
    if (!pos) continue;
    const d = Math.round(km(home, pos) * 10) / 10;
    const list = memory.track[p.entity_id] || [];
    const last = list[list.length - 1];
    if (!last || Math.abs(last.km - d) >= MOVE_KM) list.push({ km: d, at: now });
    while (list.length > 3) list.shift();
    memory.track[p.entity_id] = list;
    const newest = list[list.length - 1];
    const older = list.length > 1 ? list[list.length - 2] : null;
    const towards = !!older && newest.km < older.km - MOVE_KM && now - newest.at < FRESH_MS;
    const close = d <= Number(cfg.coming_home_km || 0);
    out.people.push({ entity_id: p.entity_id, name: person.name, km: d, towards });
    if (towards && close) out.approaching = true;
  }
  return out;
}

// Wait a while before treating the house as empty, so a short trip to the
// shop or a phone that briefly loses its location does not lower the heating.
// lastHomeAt: when someone was last seen home (ms), or null.
// Returns { effectiveHome, waitingUntil }.
function withAwayDelay(anyoneHome, lastHomeAt, delayMinutes, now) {
  if (anyoneHome) return { effectiveHome: true, waitingUntil: null };
  if (!lastHomeAt || !(delayMinutes > 0)) return { effectiveHome: false, waitingUntil: null };
  const until = lastHomeAt + delayMinutes * 60000;
  return until > now ? { effectiveHome: true, waitingUntil: until } : { effectiveHome: false, waitingUntil: null };
}

module.exports = { whoIsHome, onTheWay, withAwayDelay, normalisePersons, km, TYPE_OF };
