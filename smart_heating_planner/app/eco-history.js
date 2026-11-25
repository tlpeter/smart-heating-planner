'use strict';

const ha = require('./ha');
const eco = require('./eco');
const schedule = require('./schedule');
let cache = { key: '', at: 0, model: null, error: null };

async function update(config, now) {
  if (!config.enabled) return null;
  const key = JSON.stringify(config);
  if (cache.key === key && now - cache.at < 15 * 60000) return cache.model;
  // Invalidate on sensor changes or a failed fetch. Never reuse an old model.
  cache = { key, at: now, model: null, error: null };
  try {
    const ids = [...new Set(['indoor', 'outdoor', 'heating_demand', 'gas', 'flow', 'return'].map((k) => config[k]).filter(Boolean))];
    if (!ids.length) return null;
    const history = await ha.call({ type: 'history/history_during_period',
      start_time: new Date(now - 7 * 24 * eco.HOUR).toISOString(), end_time: new Date(now).toISOString(),
      entity_ids: ids, minimal_response: false, no_attributes: true, significant_changes_only: false }, 30000);
    cache.model = eco.learn(history, config, now);
  } catch (err) { cache.error = `Recorder unavailable: ${err.message}`; }
  return cache.model;
}

function recordWindow(memory, config, settings, tz, now, controlAllowed, hold) {
  // Existing installs without gas evaluation should do no extra work here.
  if (!config.gas) return;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const g = (type) => Number(parts.find((p) => p.type === type).value);
  const day = g('day') - (g('hour') < 12 ? 1 : 0);
  const from = schedule.zonedTime(g('year'), g('month'), day, 22, 0, tz);
  const to = schedule.zonedTime(g('year'), g('month'), day + 1, 12, 0, tz);
  memory.ecoWindows = (memory.ecoWindows || []).filter((w) => now - w.from < 8 * 24 * eco.HOUR);
  for (const w of memory.ecoWindows) if (now > w.to && w.to - w.last > 10 * 60000) w.complete = false;
  if (now < from || now > to) return;
  const strategy = config.enabled && config.mode === 'adaptive' && controlAllowed ? 'adaptive' : 'normal';
  const scheduleKey = JSON.stringify([settings.schedule, settings.schedule_needs_presence, settings.away_temp, config]);
  // Observe and disabled are both the unchanged normal strategy.
  const windowSchedule = [];
  for (let t = from; t < to; t += 30 * 60000) {
    const point = schedule.current(settings.schedule, t, tz);
    windowSchedule.push(point ? [point.current.temp, point.current.preheat] : null);
  }
  const comparableKey = JSON.stringify([windowSchedule, settings.schedule_needs_presence, settings.away_temp,
    config.indoor, config.outdoor, config.heating_demand, config.gas]);
  let window = memory.ecoWindows.find((w) => w.from === from);
  if (!window) {
    window = { from, to, strategy, scheduleKey: comparableKey, configKey: scheduleKey, last: now, complete: now - from < 10 * 60000 };
    memory.ecoWindows.push(window);
  }
  if (now - window.last > 30 * 60000 || window.strategy !== strategy || window.configKey !== scheduleKey || hold || !controlAllowed) window.complete = false;
  window.last = now;
  // Complete means continuous observation, including the end of the window.
}

module.exports = { update, recordWindow,
  getModel: (config) => config.enabled && cache.key === JSON.stringify(config) ? cache.model : null,
  getError: () => cache.error };
