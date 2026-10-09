'use strict';

// The week schedule.
//
// A schedule has a list of switch points per weekday. Each switch point has a
// time, a temperature and a "preheat" flag. A switch point is valid from its
// time until the next switch point, also across midnight and across the week.
//
//   { mon: [{ time: '06:30', temp: 20, preheat: false }, ...], tue: [...], ... }
//
// preheat: also heat to this temperature when nobody is home (for example to
// have the house warm when you come home from work).

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEK = 7 * 1440;
const MAX_POINTS = 12;
const MIN_TEMP = 5;
const MAX_TEMP = 25;

function defaultSchedule() {
  const weekday = [
    { time: '06:30', temp: 20, preheat: false },
    { time: '08:30', temp: 18, preheat: false },
    { time: '17:00', temp: 20.5, preheat: false },
    { time: '22:30', temp: 16, preheat: false },
  ];
  const weekend = [
    { time: '08:00', temp: 20, preheat: false },
    { time: '23:00', temp: 16, preheat: false },
  ];
  const out = {};
  for (const d of DAYS) out[d] = (d === 'sat' || d === 'sun' ? weekend : weekday).map((p) => ({ ...p }));
  return out;
}

function toMinutes(time) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function toTime(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Round to 0.5 °C, like most thermostats.
function roundTemp(t) {
  return Math.round(Number(t) * 2) / 2;
}

// Check a schedule from the page. Returns { ok, errors, value }.
function validate(input) {
  const errors = [];
  const value = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['The schedule must be an object with a list per day'], value: null };
  }
  let total = 0;
  for (const d of DAYS) {
    const list = Array.isArray(input[d]) ? input[d] : [];
    if (list.length > MAX_POINTS) errors.push(`${d}: at most ${MAX_POINTS} switch points`);
    const seen = new Set();
    const day = [];
    for (const p of list.slice(0, MAX_POINTS)) {
      const min = toMinutes(p && p.time);
      const temp = Number(p && p.temp);
      if (min === null) { errors.push(`${d}: "${p && p.time}" is not a time (HH:MM)`); continue; }
      if (!Number.isFinite(temp) || temp < MIN_TEMP || temp > MAX_TEMP) {
        errors.push(`${d} ${p.time}: temperature must be between ${MIN_TEMP} and ${MAX_TEMP} °C`);
        continue;
      }
      if (seen.has(min)) { errors.push(`${d}: ${p.time} is in the list twice`); continue; }
      seen.add(min);
      day.push({ time: toTime(min), temp: roundTemp(temp), preheat: p.preheat === true });
    }
    day.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
    total += day.length;
    value[d] = day;
  }
  if (!errors.length && total === 0) errors.push('The schedule needs at least one switch point');
  return { ok: errors.length === 0, errors, value };
}

// Weekday (0 = Monday) and minutes since midnight of a moment, in a time zone.
function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

// All switch points of the week, sorted by minute of the week.
function flatten(schedule) {
  const out = [];
  DAYS.forEach((d, i) => {
    for (const p of (schedule && schedule[d]) || []) {
      const min = toMinutes(p.time);
      if (min !== null) out.push({ ...p, day: d, weekMinute: i * 1440 + min });
    }
  });
  return out.sort((a, b) => a.weekMinute - b.weekMinute);
}

// The switch point that is valid now, and the next one.
// Returns null for an empty schedule.
//   { current: { day, time, temp, preheat, id }, next: { ..., inMinutes, at } }
function current(schedule, now, timeZone) {
  const points = flatten(schedule);
  if (!points.length) return null;
  const date = now instanceof Date ? now : new Date(now);
  const { day, minutes } = localParts(date, timeZone);
  const nowWm = day * 1440 + minutes;
  let idx = -1;
  for (let i = 0; i < points.length; i++) if (points[i].weekMinute <= nowWm) idx = i;
  const cur = idx === -1 ? points[points.length - 1] : points[idx]; // before the first point: last of the week
  const nxt = idx + 1 < points.length ? points[idx + 1] : points[0];
  let inMinutes = nxt.weekMinute - nowWm;
  if (inMinutes <= 0) inMinutes += WEEK;
  // Whole minutes: the seconds of "now" are dropped.
  const at = Math.floor(date.getTime() / 60000) * 60000 + inMinutes * 60000;
  const strip = (p) => ({ day: p.day, time: p.time, temp: p.temp, preheat: p.preheat === true, id: `${p.day}-${p.time}` });
  return { current: strip(cur), next: { ...strip(nxt), inMinutes, at } };
}

module.exports = { DAYS, MIN_TEMP, MAX_TEMP, defaultSchedule, validate, current, toMinutes, toTime, roundTemp, localParts };
