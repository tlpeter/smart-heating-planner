'use strict';

// Find what the Settings page offers: thermostats, persons (with their
// trackers) and HeatMeisters. Only reads states and the entity registry.

const heatmeister = require('./heatmeister');
const { TYPE_OF } = require('./presence');

// Integrations that reach tado through its cloud. tado limits the number of
// cloud requests per day (100 without a subscription), so a local HomeKit
// thermostat is the better choice.
const TADO_CLOUD = new Set(['tado', 'tado_ce', 'tado_hijack', 'tado_x']);

function friendly(st) {
  return (st && st.attributes && st.attributes.friendly_name) || (st && st.entity_id);
}

// states: HA states. entities: the entity registry (may be empty).
function detect(states, entities = []) {
  const reg = new Map(entities.map((e) => [e.entity_id, e]));
  const byId = new Map((states || []).map((s) => [s.entity_id, s]));
  const platformOf = (id) => (reg.get(id) || {}).platform || null;

  const thermostats = [];
  const persons = [];
  const temperatures = [];
  const chartTemperatures = []; // for the chart: also a HeatMeister's own room temperature
  for (const st of states || []) {
    const id = st.entity_id;
    const domain = id.split('.')[0];
    if (domain === 'climate') {
      const platform = platformOf(id);
      thermostats.push({
        entity_id: id,
        name: friendly(st),
        state: st.state,
        platform,
        cloud: platform ? TADO_CLOUD.has(platform) : false,
        local: platform === 'homekit_controller',
      });
    } else if (domain === 'sensor') {
      const a = st.attributes || {};
      // Room temperature sensors (not the HeatMeisters' own water and room sensors).
      if ((a.device_class === 'temperature' || a.unit_of_measurement === '°C') && !/heat_?(booster|meister)_/.test(id)) {
        temperatures.push({ entity_id: id, name: friendly(st), state: st.state });
      }
      if ((a.device_class === 'temperature' || a.unit_of_measurement === '°C') && (!/heat_?(booster|meister)_/.test(id) || /_temp_ambient(?:_\d+)?$/.test(id))) {
        chartTemperatures.push({ entity_id: id, name: friendly(st), state: st.state });
      }
    } else if (domain === 'person') {
      const list = Array.isArray(st.attributes && st.attributes.device_trackers) ? st.attributes.device_trackers : [];
      persons.push({
        entity_id: id,
        name: friendly(st),
        state: st.state,
        trackers: list.map((tid) => {
          const t = byId.get(tid);
          return { entity_id: tid, name: t ? friendly(t) : tid, type: TYPE_OF[t && t.attributes && t.attributes.source_type] || 'router', state: t ? t.state : 'missing' };
        }),
      });
    }
  }
  const byEntity = (x, y) => x.entity_id.localeCompare(y.entity_id);
  // Local thermostats first, cloud ones last.
  thermostats.sort((x, y) => (y.local - x.local) || (x.cloud - y.cloud) || byEntity(x, y));
  return {
    thermostats,
    persons: persons.sort(byEntity),
    heatmeisters: heatmeister.discover(states).map((d) => ({
      prefix: d.prefix,
      name: d.name,
      topic: heatmeister.defaultTopic(d.name),
      entities: Object.keys(d.entities).length,
      control_state: heatmeister.read(states, d.prefix).control_state,
    })),
    temperatures: temperatures.sort(byEntity),
    chartTemperatures: chartTemperatures.sort(byEntity),
    homeZone: byId.has('zone.home'),
  };
}

module.exports = { detect, TADO_CLOUD };
