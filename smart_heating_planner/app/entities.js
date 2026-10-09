'use strict';

// Find the entities the Settings page offers: thermostats, persons, proximity
// sensors and Heatmeister entities. Only reads states and the registries.

// Integrations that reach tado through its cloud. tado limits the number of
// cloud requests per day (100 without a subscription), so a local HomeKit
// thermostat is the better choice.
const TADO_CLOUD = new Set(['tado', 'tado_ce', 'tado_hijack', 'tado_x']);

function friendly(st) {
  return (st.attributes && st.attributes.friendly_name) || st.entity_id;
}

// states: HA states. entities/devices: registry lists (may be empty).
function detect(states, entities = [], devices = []) {
  const reg = new Map(entities.map((e) => [e.entity_id, e]));
  const dev = new Map(devices.map((d) => [d.id, d]));
  const platformOf = (id) => (reg.get(id) || {}).platform || null;
  const deviceOf = (id) => {
    const e = reg.get(id);
    return e && e.device_id ? dev.get(e.device_id) || null : null;
  };

  const thermostats = [];
  const persons = [];
  const distance = [];
  const direction = [];
  const controls = [];
  const temperatures = [];

  for (const st of states || []) {
    const id = st.entity_id;
    const domain = id.split('.')[0];
    const a = st.attributes || {};
    const item = { entity_id: id, name: friendly(st), state: st.state };
    if (domain === 'climate') {
      const platform = platformOf(id);
      thermostats.push({
        ...item,
        platform,
        cloud: platform ? TADO_CLOUD.has(platform) : false,
        local: platform === 'homekit_controller',
      });
    } else if (domain === 'person') {
      persons.push(item);
    } else if (domain === 'sensor') {
      if (/_nearest_distance$/.test(id) || (a.device_class === 'distance' && /distance/.test(id))) distance.push(item);
      if (/_direction_of_travel$/.test(id)) direction.push(item);
      if (a.device_class === 'temperature' || a.unit_of_measurement === '°C') temperatures.push({ ...item, heatmeister: isHeatmeister(id, st, deviceOf(id)) });
    } else if (['fan', 'switch', 'number', 'select', 'light'].includes(domain)) {
      const hm = isHeatmeister(id, st, deviceOf(id));
      // Show all fans; other types only when they look like a Heatmeister.
      if (hm || domain === 'fan') controls.push({ ...item, heatmeister: hm });
    }
  }
  const byHm = (x, y) => (y.heatmeister - x.heatmeister) || x.entity_id.localeCompare(y.entity_id);
  const byId = (x, y) => x.entity_id.localeCompare(y.entity_id);
  // Local thermostats first, cloud ones last.
  thermostats.sort((x, y) => (y.local - x.local) || (x.cloud - y.cloud) || byId(x, y));
  return {
    thermostats,
    persons: persons.sort(byId),
    distance: distance.sort(byId),
    direction: direction.sort(byId),
    controls: controls.sort(byHm),
    temperatures: temperatures.sort(byHm),
  };
}

// Heatmeister entities come in through MQTT (SDR Engineering). Recognise them
// by the device's maker or model, or by "heatmeister" in the name.
function isHeatmeister(id, st, device) {
  const text = [id, friendly(st), device && device.manufacturer, device && device.model, device && device.name]
    .filter(Boolean).join(' ').toLowerCase();
  return /heat\s*meister|sdr engineering/.test(text);
}

module.exports = { detect, TADO_CLOUD };
