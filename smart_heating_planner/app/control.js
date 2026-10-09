'use strict';

// When to really send a new target to the thermostat, and how to notice that
// someone changed it by hand (on the thermostat, in the tado app or in Home
// Assistant). Pure logic: easy to test.
//
// memory: { lastSent: { temp, at } | null, writes: [ms, ...] }

// SHP_GAP_MS / SHP_SETTLE_MS: tests only.
const MIN_GAP_MS = Number(process.env.SHP_GAP_MS) || 2 * 60000;   // at least 2 minutes between two writes
const SETTLE_MS = Number(process.env.SHP_SETTLE_MS) || 3 * 60000; // after a write, give the thermostat 3 minutes to show it
const DAY_MS = 86400000;
const TOLERANCE = 0.25;         // °C

// Did someone change the thermostat by hand?
// Only when the app set it before and the thermostat now shows something
// else, after the thermostat had time to show our value.
// Returns the new temperature, or null.
function manualChange({ now, thermostat, lastSent }) {
  if (!thermostat || !thermostat.available || !Number.isFinite(thermostat.target)) return null;
  if (!lastSent || now - lastSent.at < SETTLE_MS) return null;
  return Math.abs(thermostat.target - lastSent.temp) >= TOLERANCE ? thermostat.target : null;
}

// Should the app send the advice now?
// Returns { send: true } or { send: false, why }.
function shouldSend({ now, advice, thermostat, memory, maxWritesPerDay }) {
  if (!thermostat || !thermostat.available) return { send: false, why: 'thermostat unavailable' };
  if (thermostat.state === 'off') return { send: false, why: 'thermostat is off' };
  if (!advice.change) return { send: false, why: 'already matches' };
  const writes = (memory.writes || []).filter((t) => now - t < DAY_MS);
  if (memory.lastSent && now - memory.lastSent.at < MIN_GAP_MS) return { send: false, why: 'waiting a moment after the last change' };
  if (writes.length >= maxWritesPerDay) return { send: false, why: `limit of ${maxWritesPerDay} changes per 24 hours reached` };
  return { send: true };
}

// Remember a write.
function recordWrite(memory, temp, now) {
  memory.lastSent = { temp, at: now };
  memory.writes = [...(memory.writes || []).filter((t) => now - t < DAY_MS), now];
}

module.exports = { manualChange, shouldSend, recordWrite, MIN_GAP_MS, SETTLE_MS };
