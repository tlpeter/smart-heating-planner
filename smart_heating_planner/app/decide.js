'use strict';

// The decision: which temperature should the thermostat have now?
// Pure logic, no Home Assistant: easy to test.
//
// The HeatMeisters run by themselves (they watch the radiator temperature);
// the app only shows what they do.
//
// Order (the first that applies wins):
//   1. A manual hold (set on the Home page) until its end time.
//   2. Someone is home (or just left, within the away delay): the schedule.
//   3. Nobody home, but the switch point has "preheat": the schedule.
//   4. Nobody home, but someone is on the way home: the schedule.
//   5. Nobody home: the away temperature, or the schedule when that is lower
//      (the night temperature is never raised because you are away).

const { roundTemp } = require('./schedule');

function fmtTime(ms, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}

// input: { now, timeZone, point, presence, hold, settings, thermostat }
//   point:      result of schedule.current() or null
//   presence:   { effectiveHome, waitingUntil, approaching }
//   hold:       { temp, until } or null
//   thermostat: { available, target, current, hvac_action }
// Returns { target, source, reason, change }.
function decideTarget(input) {
  const { now, timeZone, point, presence, hold, settings, thermostat } = input;
  const away = roundTemp(settings.away_temp);
  let target;
  let source;
  let reason;

  if (hold && hold.until > now) {
    target = roundTemp(hold.temp);
    source = 'hold';
    reason = hold.source === 'thermostat'
      ? `Changed on the thermostat: kept until ${fmtTime(hold.until, timeZone)}`
      : `Manual hold until ${fmtTime(hold.until, timeZone)}`;
  } else if (!point) {
    target = away;
    source = 'away';
    reason = 'No schedule: away temperature';
  } else if (presence.effectiveHome) {
    target = point.current.temp;
    source = 'schedule';
    reason = presence.waitingUntil
      ? `Nobody home, waiting until ${fmtTime(presence.waitingUntil, timeZone)} before lowering`
      : `Someone is home: schedule from ${point.current.time}`;
  } else if (point.current.preheat) {
    target = point.current.temp;
    source = 'preheat';
    reason = `Nobody home, but ${point.current.time} has "preheat on"`;
  } else if (presence.approaching) {
    target = point.current.temp;
    source = 'approaching';
    reason = 'Someone is on the way home';
  } else {
    target = Math.min(away, point.current.temp);
    source = 'away';
    reason = target < away ? 'Nobody home: schedule is lower than the away temperature' : 'Nobody home: away temperature';
  }

  // Would the thermostat need a different setting?
  const setNow = thermostat && thermostat.available ? Number(thermostat.target) : NaN;
  const change = Number.isFinite(setNow) && Math.abs(setNow - target) >= 0.25;
  return { target, source, reason, change };
}

// Heat demand: the thermostat says it is heating.
function heatDemand(thermostat) {
  return !!(thermostat && thermostat.available && thermostat.hvac_action === 'heating');
}

module.exports = { decideTarget, heatDemand };
