'use strict';

// Recorder observations, a conservative heat-loss model and preheat advice.
// This module never sends commands. The controller keeps the existing gates.
const HOUR = 3600000;
const FRESH = 30 * 60000;
const defaults = () => ({ enabled: false, mode: 'observe', demand: 50, step: 0.5,
  indoor: '', outdoor: '', heating_demand: '', gas: '', flow: '', return: '' });
const number = (v) => v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);
function stamp(e) {
  const t = e.lu ?? e.lc;
  return typeof t === 'number' ? t * 1000 : Date.parse(e.last_updated || e.last_changed);
}
function series(history, id) {
  return ((history || {})[id] || []).map((e) => ({ at: stamp(e), value: number(e.s ?? e.state) }))
    .filter((e) => Number.isFinite(e.at)).sort((a, b) => a.at - b.at);
}
function at(list, t) {
  // A long Recorder gap is unknown, even if the last value was numeric.
  let lo = 0; let hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].at <= t) lo = m + 1; else hi = m; }
  const p = list[lo - 1];
  return p && t - p.at <= FRESH ? p.value : null;
}
function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}
function learn(history, config, now) {
  const lines = Object.fromEntries(['indoor', 'outdoor', 'heating_demand', 'gas', 'flow', 'return'].map((k) => [k, series(history, config[k])]));
  const observations = [];
  for (let t = now - 7 * 24 * HOUR; t <= now - 600000; t += 600000) {
    const room = at(lines.indoor, t); const end = at(lines.indoor, t + 600000);
    const outdoor = at(lines.outdoor, t); const demand = at(lines.heating_demand, t);
    const endDemand = at(lines.heating_demand, t + 600000);
    if ([room, end, outdoor, demand, endDemand].some((v) => v === null) || demand < 0 || demand > 100 || Math.abs(endDemand - demand) > 15) continue;
    const rate = (end - room) * 6;
    if (Math.abs(rate) > 5 || room < 5 || room > 35 || outdoor < -40 || outdoor > 45) continue;
    observations.push({ at: t + 600000, room, outdoor, demand, rate });
  }
  const cooling = observations.filter((o) => o.demand === 0 && o.room - o.outdoor >= 5 && o.rate < -0.02);
  const loss = quantile(cooling.map((o) => -o.rate / (o.room - o.outdoor)), 0.75);
  const heating = observations.filter((o) => o.demand >= 20 && o.rate > 0.02);
  const capacity = loss === null ? null : quantile(heating.map((o) => (o.rate + loss * (o.room - o.outdoor)) / (o.demand / 100)), 0.25);
  const latest = Math.min(...[cooling, heating].map((list) => list.length ? list[list.length - 1].at : 0));
  const count = Math.min(cooling.length, heating.length);
  return { lines, loss, capacity, coolingSamples: cooling.length, heatingSamples: heating.length, latest,
    confidence: count >= 36 ? 'high' : count >= 12 ? 'medium' : 'low',
    ready: count >= 12 && now - latest < 24 * HOUR && loss > 0 && capacity > 0,
    outdoorMin: heating.length ? Math.min(...heating.map((o) => o.outdoor)) : null,
    outdoorMax: heating.length ? Math.max(...heating.map((o) => o.outdoor)) : null };
}
function live(states, config, now) {
  return Object.fromEntries(['indoor', 'outdoor', 'heating_demand', 'gas', 'flow', 'return'].map((k) => {
    const e = states.find((s) => s.entity_id === config[k]);
    const report = e ? (e.last_reported ? Date.parse(e.last_reported) : stamp(e)) : NaN;
    let v = e && now - report <= FRESH && report <= now + 60000 ? number(e.state) : null;
    const unit = e && e.attributes && e.attributes.unit_of_measurement;
    if (v !== null && ((['indoor', 'outdoor', 'flow', 'return'].includes(k) && unit !== '°C') || (k === 'heating_demand' && (unit !== '%' || v < 0 || v > 100)) || (k === 'gas' && (v < 0 || !['m³', 'm3'].includes(unit))))) v = null;
    return [k, v ?? null];
  }));
}
function duration(room, outdoor, target, demand, model) {
  // Integrate heat loss each minute; cap preheating at four hours.
  let value = room;
  for (let min = 0; min <= 240; min++) {
    if (value >= target) return min;
    const rate = model.capacity * demand / 100 - model.loss * (value - outdoor);
    if (rate <= 0) return Infinity;
    value += rate / 60;
  }
  return Infinity;
}
function plan({ config, model, values, baseline, point, presence, hold, thermostat, now, lastSent, writesRemaining = 48 }) {
  const result = { active: false, reason: 'Adaptive Eco Heating is off', predictedStart: null, normalStart: null,
    confidence: model ? model.confidence : 'low', demand: values.heating_demand, proposedTarget: baseline.target };
  const stop = (reason) => ({ ...result, reason });
  if (!config.enabled) return result;
  if (hold && hold.until > now) return stop('Manual hold takes priority');
  if (!point || point.next.temp <= point.current.temp) return stop('Keeping the current schedule and night setback');
  if (!presence.effectiveHome && !presence.approaching && !point.next.preheat) return stop('Nobody home: keeping the away temperature');
  if (!thermostat.available || thermostat.state === 'off' || !Number.isFinite(thermostat.target)) return stop('Thermostat is unavailable or off');
  if (['indoor', 'outdoor', 'heating_demand'].some((k) => values[k] === null)) return stop('Missing, stale or unsupported sensor data: normal heating');
  if (!model || !model.ready || now - model.latest >= 24 * HOUR) return stop('Not enough recent Recorder samples: normal heating');
  if (values.outdoor < model.outdoorMin - 5 || values.outdoor > model.outdoorMax + 5) return stop('Weather outside the learned range: normal heating');
  const comfort = point.next.temp;
  const full = duration(values.indoor, values.outdoor, comfort, 100, model);
  const gradual = duration(values.indoor, values.outdoor, comfort, config.demand, model);
  if (!Number.isFinite(full)) return stop('Cold weather: comfort prediction is uncertain; normal heating');
  const margin = 15;
  result.normalStart = point.next.at - (full + margin) * 60000;
  const steps = Math.ceil(Math.max(0, comfort - thermostat.target) / config.step);
  const ramp = steps * 10;
  const minutes = Math.max(Number.isFinite(gradual) ? gradual + margin : full + margin, ramp);
  result.predictedStart = point.next.at - Math.min(240, minutes) * 60000;
  if (now < result.predictedStart || values.indoor >= comfort) return stop('Waiting for the predicted preheat start');
  // Preferred demand is a soft target, never a boiler modulation command.
  const risk = now >= result.normalStart || !Number.isFinite(gradual) || minutes > 240 || writesRemaining < steps + 1;
  let target = comfort;
  if (!risk) {
    const previous = Math.max(baseline.target, Math.min(comfort, thermostat.target));
    const wait = lastSent && now - lastSent.at < 10 * 60000;
    target = wait || values.heating_demand > config.demand + 10 ? previous : Math.min(comfort, previous + config.step);
  }
  result.reason = risk ? 'Comfort deadline or write budget at risk: normal comfort target' : 'Gradual preheat towards scheduled comfort';
  result.proposedTarget = Math.max(baseline.target, target);
  result.active = config.mode === 'adaptive';
  if (!result.active) result.reason = `Observe only: ${result.reason}`;
  return result;
}

// A complete overnight + morning window includes any cost of earlier heating.
function gasWindow(lines, from, to) {
  const raw = lines.gas.filter((p) => p.at >= from && p.at <= to);
  if (raw.some((p, i) => p.value === null || (i && p.value < raw[i - 1].value))) return null;
  let gas = 0; let outdoor = 0; let indoor = 0; let n = 0;
  for (let t = from; t < to; t += 600000) {
    const a = at(lines.gas, t); const b = at(lines.gas, Math.min(to, t + 600000));
    const out = at(lines.outdoor, t); const room = at(lines.indoor, t);
    if ([a, b, out, room].some((v) => v === null) || b < a) return null;
    gas += b - a; outdoor += out; indoor += room; n++;
  }
  return n ? { gas, outdoor: outdoor / n, indoor: indoor / n } : null;
}
function evaluation(model, windows, now) {
  const measured = !model ? [] : windows.filter((w) => w.complete && w.to <= now).map((w) => ({ ...w, measurement: gasWindow(model.lines, w.from, w.to) })).filter((w) => w.measurement);
  const adaptive = measured.filter((w) => w.strategy === 'adaptive').at(-1);
  const normal = adaptive && measured.filter((w) => w.strategy === 'normal' && Math.abs(w.measurement.outdoor - adaptive.measurement.outdoor) <= 2 && Math.abs(w.measurement.indoor - adaptive.measurement.indoor) <= 1 && w.scheduleKey === adaptive.scheduleKey).at(-1);
  return { windows: measured.map(({ measurement, from, to, strategy }) => ({ from, to, strategy, ...measurement })),
    differenceM3: normal ? adaptive.measurement.gas - normal.measurement.gas : null,
    reason: normal ? 'Comparable weather and indoor temperature; measured difference only. Hot water may affect gas use; no proven saving.' : 'No comparable complete normal/adaptive windows yet. Hot water may affect gas use; no proven saving.' };
}

module.exports = { defaults, number, stamp, series, at, learn, live, duration, plan, gasWindow, evaluation, HOUR };
