'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../smart_heating_planner/app/schedule');

const TZ = 'Europe/Amsterdam';
// Friday 9 October 2026 in Amsterdam (summer time, UTC+2).
const at = (hhmm, day = 9) => new Date(`2026-10-${String(day).padStart(2, '0')}T${hhmm}:00+02:00`);

test('the default schedule is valid', () => {
  const r = schedule.validate(schedule.defaultSchedule());
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('the switch point that is valid now, and the next one', () => {
  const s = schedule.defaultSchedule();
  const r = schedule.current(s, at('15:25'), TZ);
  assert.equal(r.current.time, '08:30');
  assert.equal(r.current.temp, 18);
  assert.equal(r.next.time, '17:00');
  assert.equal(r.next.inMinutes, 95);
  assert.equal(r.next.at, at('17:00').getTime());
});

test('before the first point of the day the last point of the day before is valid', () => {
  const s = schedule.defaultSchedule();
  const r = schedule.current(s, at('05:00'), TZ); // Friday 05:00
  assert.equal(r.current.day, 'thu');
  assert.equal(r.current.time, '22:30');
  assert.equal(r.next.time, '06:30');
});

test('across the week: Monday early uses Sunday evening', () => {
  const s = schedule.defaultSchedule();
  const r = schedule.current(s, at('03:00', 12), TZ); // Monday 12 October
  assert.equal(r.current.day, 'sun');
  assert.equal(r.current.time, '23:00');
  assert.equal(r.next.day, 'mon');
});

test('one switch point in the whole week is always valid', () => {
  const s = { wed: [{ time: '12:00', temp: 19 }] };
  const r = schedule.current(s, at('11:00'), TZ);
  assert.equal(r.current.temp, 19);
  assert.equal(r.next.day, 'wed');
  assert.ok(r.next.inMinutes > 0 && r.next.inMinutes <= 7 * 1440);
});

test('exactly at a switch time the new point is valid', () => {
  const r = schedule.current(schedule.defaultSchedule(), at('17:00'), TZ);
  assert.equal(r.current.time, '17:00');
});

test('empty schedule gives null', () => {
  assert.equal(schedule.current({}, at('12:00'), TZ), null);
});

test('daylight saving: the clock time is used, not UTC', () => {
  // Sunday 25 October 2026 03:30 local is after the switch to winter time.
  const s = { sun: [{ time: '03:00', temp: 15 }, { time: '07:00', temp: 20 }] };
  const r = schedule.current(s, new Date('2026-10-25T03:30:00+01:00'), TZ);
  assert.equal(r.current.time, '03:00');
});

test('validation refuses wrong times, temperatures and doubles, and sorts', () => {
  const bad = schedule.validate({ mon: [{ time: '25:00', temp: 20 }, { time: '07:00', temp: 40 }, { time: '08:00', temp: 19 }, { time: '08:00', temp: 18 }] });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 3);
  const good = schedule.validate({ mon: [{ time: '18:00', temp: 20.3 }, { time: '07:00', temp: 19, preheat: true }] });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value.mon, [{ time: '07:00', temp: 19, preheat: true }, { time: '18:00', temp: 20.5, preheat: false }]);
  assert.deepEqual(good.value.tue, []);
});

test('validation needs at least one switch point and at most 12 per day', () => {
  assert.equal(schedule.validate({}).ok, false);
  const many = Array.from({ length: 13 }, (_, i) => ({ time: `${String(i + 6).padStart(2, '0')}:00`, temp: 19 }));
  assert.equal(schedule.validate({ mon: many }).ok, false);
});
