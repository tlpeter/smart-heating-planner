'use strict';

// HeatMeister radiator fans (SDR Engineering), in Home Assistant through MQTT.
//
// Every HeatMeister is one device with a fixed set of entities, all with the
// same start (the "prefix"), for example:
//   sensor.heatbooster_woonkamer_garage_temp_inlet
//   sensor.heatbooster_woonkamer_garage_fan_control_state
// The product used to be called "Heatbooster"; newer installs may use
// "heatmeister_". The app finds the devices by these names and only READS
// them. A HeatMeister controls its own fan (on the radiator temperature, and
// optionally on the room temperature).

// The part after the prefix -> what it is.
const PARTS = {
  temp_inlet: 'inlet',
  temp_outlet: 'outlet',
  temp_delta_io: 'delta',
  temp_inlet_rate: 'inlet_rate',
  temp_ambient: 'room',
  fan_control_state: 'control_state',
  fan_speed: 'fan_speed',
  fan_enabled: 'fan_on',
  fan_boostmode: 'boost',
  fan_controlmode: 'manual_mode',
  ambientcontrol_enable: 'room_control',
  ambientcontrol_temp: 'room_target',
  demand_trim: 'demand_trim',
};
const PART_RE = new RegExp(`^(sensor|number|switch|binary_sensor)\\.((?:heatbooster|heatmeister|heat_meister)_[a-z0-9_]+?)_(${Object.keys(PARTS).join('|')})$`);

// Control states in which the fan runs.
const RUNNING = new Set(['heat', 'overrun', 'manual', 'startup', 'defrost', 'cool', 'slave']);

function num(v) {
  const n = Number(v);
  return v === null || v === '' || !Number.isFinite(n) ? null : n;
}

// A readable name: "HeatMeister - Woonkamer-garage Control state" -> "Woonkamer-garage".
function nameFrom(friendlyName, prefix) {
  const m = /^heat\s*(?:meister|booster)\s*-\s*(.+?)\s+(?:water inlet temperature|control state|room temperature|fan speed|fan status)$/i.exec(friendlyName || '');
  if (m) return m[1];
  return prefix.replace(/^(heatbooster|heatmeister|heat_meister)_/, '').replace(/_/g, ' ');
}

// All HeatMeisters in the states: [{ prefix, name, entities: {part: entity_id} }].
function discover(states) {
  const found = new Map();
  for (const st of states || []) {
    const m = PART_RE.exec(st.entity_id);
    if (!m) continue;
    const prefix = m[2];
    const dev = found.get(prefix) || { prefix, name: null, entities: {} };
    dev.entities[PARTS[m[3]]] = st.entity_id;
    const fn = st.attributes && st.attributes.friendly_name;
    if (!dev.name && ['inlet', 'control_state', 'room', 'fan_speed', 'fan_on'].includes(PARTS[m[3]])) dev.name = nameFrom(fn, prefix);
    found.set(prefix, dev);
  }
  // A real HeatMeister has at least its control state or its inlet temperature.
  return [...found.values()]
    .filter((d) => d.entities.control_state || d.entities.inlet)
    .map((d) => ({ ...d, name: d.name || nameFrom('', d.prefix) }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}

// What one HeatMeister is doing now.
function read(states, prefix) {
  const byId = new Map((states || []).map((s) => [s.entity_id, s]));
  const dev = discover(states).find((d) => d.prefix === prefix);
  if (!dev) return { prefix, available: false };
  const val = (part) => {
    const id = dev.entities[part];
    const st = id ? byId.get(id) : null;
    return st && st.state !== 'unavailable' && st.state !== 'unknown' ? st.state : null;
  };
  const control = val('control_state');
  const out = {
    prefix,
    name: dev.name,
    available: control !== null || val('inlet') !== null,
    control_state: control,
    running: RUNNING.has(control) || val('fan_on') === 'on',
    fan_speed: num(val('fan_speed')),
    inlet: num(val('inlet')),
    outlet: num(val('outlet')),
    delta: num(val('delta')),
    room: num(val('room')),
    room_control: val('room_control') === 'on',
    room_target: num(val('room_target')),
    boost: val('boost') === 'on',
    manual: val('manual_mode') === 'on',
  };
  return out;
}

// The MQTT topic a HeatMeister listens to for an outside room temperature.
function defaultTopic(name) {
  return `${name}/temp-ambient-ext`;
}

// Should the room temperature be sent (again) to one topic?
// last: { value, at } of the last send, or undefined.
// Sends when the value changed by 0.1 °C or more, or every intervalMinutes.
function shouldPublish({ value, last, now, intervalMinutes }) {
  if (!Number.isFinite(value)) return false;
  if (!last) return true;
  if (Math.abs(value - last.value) >= 0.1 - 1e-9) return true;
  return now - last.at >= intervalMinutes * 60000;
}

module.exports = { discover, read, nameFrom, defaultTopic, shouldPublish, PARTS, RUNNING };
