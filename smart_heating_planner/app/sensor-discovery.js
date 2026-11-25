'use strict';

// Suggestions only. Scanning never saves settings or asks the controller to act.
const ha = require('./ha');
const eco = require('./eco');
const ROLES = [
  ['indoor', 'Indoor temperature', '°C'], ['outdoor', 'Outdoor temperature', '°C'],
  ['heating_demand', 'Heating demand', '%'], ['gas', 'Cumulative gas', 'm³'],
  ['flow', 'Flow temperature', '°C'], ['return', 'Return temperature', '°C'],
];
const MAX_PER_ROLE = 20;
const MAX_HISTORY = 18;
const CACHE_MS = 60000;
let cached = null;
const fresh = (t, now) => Number.isFinite(t) && now - t <= 30 * 60000 && t <= now + 60000;
const validId = (s) => typeof s === 'string' && /^sensor\.[a-z0-9_]{1,180}$/.test(s);

function selections(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Sensor selections must be an object');
  const out = {};
  for (const [role] of ROLES) {
    const id = input[role] ?? '';
    if (id !== '' && !validId(id)) throw new Error(`Invalid ${role} sensor entity`);
    out[role] = id;
  }
  return out;
}

function candidate(st, role, registry, devices, thermostat, now) {
  const a = st.attributes || {};
  const reg = registry.get(st.entity_id) || {};
  const device = devices.get(reg.device_id) || {};
  const th = registry.get(thermostat) || {};
  const thDevice = devices.get(th.device_id) || {};
  const linked = !!reg.device_id && (reg.device_id === th.device_id || device.via_device_id === th.device_id || thDevice.via_device_id === reg.device_id || (device.via_device_id && device.via_device_id === thDevice.via_device_id));
  const text = `${st.entity_id} ${a.friendly_name || ''} ${reg.original_name || ''}`.toLowerCase();
  const unit = a.unit_of_measurement || '';
  const cls = a.device_class || reg.device_class || reg.original_device_class || '';
  const stateClass = a.state_class || '';
  const numeric = eco.number(st.state);
  const outdoor = /outdoor|outside|buiten|exterior|external.*temp|weather/.test(text);
  const flow = /aanvoer|supply|flow.*temp|temp.*flow|inlet/.test(text);
  const returning = /retour|return|outlet/.test(text);
  const water = flow || returning || /dhw|hot.water|tapwater|boiler.*water|ketel.*temp/.test(text);
  const heating = /heating|heat.demand|heat.request|modulation|modulatie|verwarming/.test(text) && !/battery|humidity|fan|valve|position/.test(text);
  let plausible; let certain; let compatible; let score = 0;
  const reasons = [];
  if (role === 'gas') {
    plausible = cls === 'gas' || /gas/.test(text);
    compatible = ['m³', 'm3'].includes(unit) && ['total', 'total_increasing'].includes(stateClass) && (!cls || cls === 'gas');
    certain = compatible && cls === 'gas';
    score = (cls === 'gas' ? 45 : 0) + (compatible ? 30 : 0);
    reasons.push('Cumulative gas needs m³ and state class total or total_increasing');
  } else if (role === 'heating_demand') {
    plausible = unit === '%' || heating;
    compatible = unit === '%' && !cls && (!stateClass || stateClass === 'measurement') && heating;
    certain = compatible;
    score = heating ? 55 : 0;
    reasons.push(heating ? 'Heating-demand meaning and percentage unit checked' : 'A percentage alone does not identify heating demand');
  } else {
    const temp = cls === 'temperature' || ['°C', '°F', 'K'].includes(unit);
    const roleMatch = role === 'indoor' ? !outdoor && !water : role === 'outdoor' ? outdoor : role === 'flow' ? flow : returning;
    plausible = temp && roleMatch;
    compatible = unit === '°C' && (!cls || cls === 'temperature') && (!stateClass || stateClass === 'measurement') && roleMatch;
    const indoorName = /room|ambient|indoor|binnen|current.temperature|woon/.test(text);
    certain = compatible && (role !== 'indoor' || linked || indoorName);
    score = (cls === 'temperature' ? 20 : 0) + (roleMatch ? 20 : 0) + (role === 'indoor' && indoorName ? 20 : 0);
    reasons.push(roleMatch ? `Temperature metadata and ${role} role checked` : `Does not match the ${role} role`);
  }
  if (linked) { score += 40; reasons.push('Linked to the selected thermostat device'); }
  if (/boiler|ketel|opentherm|ems/.test(`${device.name || ''} ${device.model || ''}`.toLowerCase()) && ['flow', 'return', 'heating_demand'].includes(role)) {
    score += 15; reasons.push('Device metadata identifies heating equipment');
  }
  if (!cls || !stateClass) reasons.push('Some metadata are missing; confirm the sensor role');
  const last = Date.parse(st.last_reported || st.last_updated || st.last_changed);
  const liveFresh = fresh(last, now);
  const available = numeric !== null && st.state !== 'unavailable' && st.state !== 'unknown' && !reg.disabled_by;
  const range = numeric !== null && (role === 'heating_demand' ? numeric >= 0 && numeric <= 100 : role === 'gas' ? numeric >= 0 : numeric >= -40 && numeric <= 120);
  return { entity_id: st.entity_id, name: a.friendly_name || st.entity_id, unit, device_class: cls, state_class: stateClass,
    exists: true, available, numeric: numeric !== null, compatible: compatible && range, liveFresh, lastReport: Number.isFinite(last) ? last : null,
    timestampSource: st.last_reported ? 'last_reported' : 'last_updated (report time unavailable)',
    plausible, certain: certain && range, score, reasons, history: { status: 'not_checked', samples: 0 } };
}

function discover(states, entityRegistry, deviceRegistry, selected, thermostat, now) {
  const registry = new Map(entityRegistry.map((e) => [e.entity_id, e]));
  const devices = new Map(deviceRegistry.map((d) => [d.id, d]));
  return ROLES.map(([role, label, unit]) => {
    const all = states.filter((s) => validId(s.entity_id)).map((s) => candidate(s, role, registry, devices, thermostat, now));
    const chosen = all.find((c) => c.entity_id === selected[role]);
    const list = all.filter((c) => c.plausible).sort(rank).slice(0, MAX_PER_ROLE);
    if (chosen && !list.some((c) => c.entity_id === chosen.entity_id)) list.push(chosen);
    if (selected[role] && !chosen) list.push({ entity_id: selected[role], name: selected[role], unit: '', exists: false,
      available: false, compatible: false, liveFresh: false, certain: false, score: 0, reasons: ['Selected entity does not exist'], history: { status: 'not_checked', samples: 0 } });
    return { key: role, label, unit, selected: selected[role], candidates: list, suggested: null };
  });
}
function rank(a, b) {
  return Number(b.compatible && b.available && b.liveFresh) - Number(a.compatible && a.available && a.liveFresh) || b.score - a.score || a.entity_id.localeCompare(b.entity_id);
}
function suggest(roles) {
  for (const r of roles) {
    const list = r.candidates.filter((c) => c.compatible && c.available && c.liveFresh && c.certain).sort(rank);
    const ambiguous = list.length > 1 && list[0].score - list[1].score < 10;
    r.suggested = list.length && !ambiguous ? list[0].entity_id : null;
    r.reason = ambiguous ? 'Several plausible sensors: choose one from the list' : r.suggested ? 'Suggested sensor; review the checks before saving' : 'No confident suggestion; select or enter a sensor';
  }
  return roles;
}
function inspect(history, id, now, role) {
  const points = eco.series(history, id).filter((p) => p.at >= now - 7 * 24 * eco.HOUR && p.at <= now + 60000);
  const valid = points.filter((p) => p.value !== null && (role === 'gas' ? p.value >= 0 : role === 'heating_demand' ? p.value >= 0 && p.value <= 100 : p.value >= -40 && p.value <= 120));
  const intervals = points.slice(1).map((p, i) => p.at - points[i].at).filter((d) => d > 0).sort((a, b) => a - b);
  const gaps = intervals.filter((d) => d > 30 * 60000).length;
  const resets = role === 'gas' ? valid.slice(1).filter((p, i) => p.value < valid[i].value).length : 0;
  let status = !points.length ? 'no_history' : valid.length < 12 ? 'insufficient_history' : !fresh(valid.at(-1).at, now) ? 'stale_history' : gaps > 0 ? 'history_gaps' : 'usable_history';
  if (resets) status = 'meter_reset';
  return { status, samples: valid.length, invalidSamples: points.length - valid.length, gaps, resets,
    from: valid[0]?.at ?? null, to: valid.at(-1)?.at ?? null,
    medianMinutes: intervals.length ? intervals[Math.floor(intervals.length / 2)] / 60000 : null,
    note: 'Recorder stores state changes, not every unchanged report. History gaps do not prove that the sensor stopped reporting.' };
}

async function readHistory(ids, now) {
  const key = [...ids].sort().join(',');
  if (cached && cached.key === key && now - cached.at < CACHE_MS) return cached.promise;
  const promise = ha.call({ type: 'history/history_during_period', start_time: new Date(now - 7 * 24 * eco.HOUR).toISOString(),
    end_time: new Date(now).toISOString(), entity_ids: ids, minimal_response: false, no_attributes: true, significant_changes_only: false }, 30000)
    .then((history) => ({ history, error: null }), (err) => ({ history: {}, error: `Recorder unavailable: ${err.message}` }));
  cached = { key, at: now, promise };
  return promise;
}
async function scan(input, thermostat, now = Date.now()) {
  const selected = selections(input);
  const warnings = [];
  const registry = async (type) => ha.call({ type }).catch(() => { warnings.push(type === 'config/device_registry/list' ? 'Device details are unavailable; suggestions may be less precise' : 'Entity details are unavailable; device links may be incomplete'); return []; });
  const [states, entities, devices] = await Promise.all([ha.call({ type: 'get_states' }), registry('config/entity_registry/list'), registry('config/device_registry/list')]);
  const roles = suggest(discover(states, entities, devices, selected, thermostat, now));
  const wanted = new Set();
  for (const r of roles) {
    if (selected[r.key] && r.candidates.some((c) => c.entity_id === selected[r.key] && c.exists)) wanted.add(selected[r.key]);
    r.candidates.filter((c) => c.compatible && c.available).slice(0, 2).forEach((c) => wanted.add(c.entity_id));
  }
  const ids = [...wanted].slice(0, MAX_HISTORY);
  const { history, error } = ids.length ? await readHistory(ids, now) : { history: {}, error: null };
  for (const r of roles) for (const c of r.candidates) {
    if (ids.includes(c.entity_id)) c.history = error ? { status: 'recorder_error', samples: 0 } : inspect(history, c.entity_id, now, r.key);
  }
  const effective = { ...eco.defaults(), ...selected };
  for (const r of roles) if (!effective[r.key]) effective[r.key] = r.suggested || '';
  const model = eco.learn(history, effective, now);
  const required = roles.slice(0, 3).every((r) => r.candidates.some((c) => c.entity_id === effective[r.key] && c.compatible && c.available && c.liveFresh));
  const ready = !error && required && model.ready;
  return { scannedAt: now, warnings, error, roles, inspectedSensors: ids.length, historyLimit: MAX_HISTORY,
    learning: { ready, heatingSamples: model.heatingSamples, coolingSamples: model.coolingSamples, latest: model.latest,
      reason: ready ? 'The selected/suggested combination has enough recent paired samples for learning' : error || 'Not ready for learning: check sensor selection, freshness and paired heating/cooling samples' } };
}

module.exports = { ROLES, MAX_HISTORY, selections, candidate, discover, suggest, inspect, scan, clear: () => { cached = null; } };
