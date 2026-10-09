'use strict';

// Who is home?
//
// Uses Home Assistant "person" entities. A person is home when the state is
// "home" (the Home zone). The Companion App on the phone sets this through
// its location. A person whose location is not known ("unknown" or
// "unavailable") counts as home: better warm than cold.
//
// "On the way home" uses the Proximity integration (optional): a distance
// sensor and a direction-of-travel sensor.

function friendly(st, id) {
  return (st && st.attributes && st.attributes.friendly_name) || id;
}

// states: array of HA states. persons: list of person entity ids.
// Returns { home: [...], away: [...], unknown: [...], anyoneHome }.
function whoIsHome(states, persons) {
  const byId = new Map((states || []).map((s) => [s.entity_id, s]));
  const out = { home: [], away: [], unknown: [], anyoneHome: false };
  for (const id of persons || []) {
    const st = byId.get(id);
    const item = { entity_id: id, name: friendly(st, id), state: st ? st.state : 'missing' };
    if (!st || st.state === 'unknown' || st.state === 'unavailable') out.unknown.push(item);
    else if (st.state === 'home') out.home.push(item);
    else out.away.push(item);
  }
  out.anyoneHome = out.home.length > 0 || out.unknown.length > 0;
  return out;
}

// Distance in km from a sensor state (km, m or mi).
function distanceKm(st) {
  if (!st) return null;
  const v = Number(st.state);
  if (!Number.isFinite(v)) return null;
  const unit = String((st.attributes && st.attributes.unit_of_measurement) || 'km').toLowerCase();
  if (unit === 'm') return v / 1000;
  if (unit === 'mi') return v * 1.609344;
  return v;
}

// Is someone on the way home? Only when a distance sensor is chosen.
// Returns { approaching, distanceKm, direction }.
function onTheWay(states, cfg) {
  const out = { approaching: false, distanceKm: null, direction: null };
  if (!cfg || !cfg.distance_entity) return out;
  const byId = new Map((states || []).map((s) => [s.entity_id, s]));
  out.distanceKm = distanceKm(byId.get(cfg.distance_entity));
  const dir = cfg.direction_entity ? byId.get(cfg.direction_entity) : null;
  out.direction = dir ? dir.state : null;
  if (out.distanceKm === null) return out;
  const within = out.distanceKm > 0 && out.distanceKm <= Number(cfg.distance_km || 0);
  // Without a direction sensor, being close is enough.
  const towards = !cfg.direction_entity || out.direction === 'towards';
  out.approaching = within && towards;
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

module.exports = { whoIsHome, onTheWay, withAwayDelay, distanceKm };
