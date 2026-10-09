'use strict';

// The decision: which temperature should the thermostat have now, and should
// the Heatmeisters run? Pure logic, no Home Assistant: easy to test.
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

// Should one Heatmeister run?
//   rule.mode: 'demand' - only while the thermostat asks for heat
//              'inlet'  - while the radiator is warm (inlet temperature)
//              'both'   - either of the two (default; also uses the
//                         warmth that is left in the radiator afterwards)
//   rule.inlet_on / rule.inlet_off: °C, with a gap so it does not flip
//   prevOn: what the advice was last time (for the gap)
// Returns { on, reason }.
function decideHeatmeister({ rule, demand, inlet, prevOn }) {
  const mode = rule.mode || 'both';
  const hasInlet = Number.isFinite(inlet);
  let warm = false;
  if (hasInlet) warm = prevOn ? inlet >= Number(rule.inlet_off) : inlet >= Number(rule.inlet_on);
  if (mode === 'demand') return { on: demand, reason: demand ? 'Thermostat is heating' : 'No heat demand' };
  if (mode === 'inlet') {
    if (!hasInlet) return { on: false, reason: 'No radiator temperature' };
    return { on: warm, reason: warm ? `Radiator is warm (${inlet} °C)` : `Radiator is cool (${inlet} °C)` };
  }
  if (demand) return { on: true, reason: 'Thermostat is heating' };
  if (warm) return { on: true, reason: `Radiator is still warm (${inlet} °C)` };
  return { on: false, reason: hasInlet ? `No heat demand, radiator ${inlet} °C` : 'No heat demand' };
}

module.exports = { decideTarget, decideHeatmeister, heatDemand };
