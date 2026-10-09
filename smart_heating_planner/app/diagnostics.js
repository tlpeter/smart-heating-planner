'use strict';

// "Download diagnostics": one file that helps to find a problem, to attach
// to a bug report on GitHub. Personal details are removed: names of persons
// and devices, places and free text. The Supervisor token is never included.

const REDACT_KEYS = /^(name|friendly_name|name_by_user|title|message|address|email|latitude|longitude|gps_accuracy)$/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const COORD = /-?\d{1,2}\.\d{4,},\s*-?\d{1,3}\.\d{4,}/g;

function redact(value, key = '') {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (REDACT_KEYS.test(k) && (typeof v !== 'object' || v == null)) out[k] = v == null ? v : '[removed]';
      else out[k] = redact(v, k);
    }
    return out;
  }
  if (typeof value === 'string') {
    return value
      // person.peter -> person.[removed]: a person entity is a name.
      .replace(/person\.[a-z0-9_]+/g, 'person.[removed]')
      .replace(/device_tracker\.[a-z0-9_]+/g, 'device_tracker.[removed]')
      .replace(EMAIL, '[email removed]')
      .replace(COORD, '[place removed]');
  }
  return value;
}

function redactLine(line) {
  return redact(String(line)).replace(/"[^"]*"/g, (m) => (/\s/.test(m) ? '"[text removed]"' : m));
}

// Who is where says where people are: keep only counts and tracker kinds.
function summarisePresence(status) {
  if (!status || !status.presence) return status;
  const p = status.presence;
  return {
    ...status,
    presence: {
      home: p.home.length, away: p.away.length, unknown: p.unknown.length,
      anyoneHome: p.anyoneHome, effectiveHome: p.effectiveHome, waitingUntil: p.waitingUntil,
      approaching: p.approaching, noPersons: p.noPersons,
      people: (p.people || []).map((x) => ({ status: x.status, counts: x.counts, trackers: (x.trackers || []).map((t) => ({ type: t.type, used: t.used, home: t.state === 'home' })) })),
    },
  };
}

module.exports = { redact, redactLine, summarisePresence };
