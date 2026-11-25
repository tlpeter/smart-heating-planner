'use strict';
const keys = ['indoor', 'outdoor', 'heating_demand', 'gas', 'flow', 'return'];
const selected = Object.fromEntries(keys.map((k) => [k, `sensor.eco_${k}`]));
function fixture(now = Date.now()) {
  const states = keys.map((key, i) => ({ entity_id: selected[key], state: String([19, 5, 50, 100, 45, 40][i]),
    last_updated: new Date(now).toISOString(), last_reported: new Date(now).toISOString(),
    attributes: { friendly_name: ['Indoor room temperature', 'Outdoor temperature', 'Heating demand', 'Gas total', 'Boiler flow temperature', 'Boiler return temperature'][i],
      unit_of_measurement: key === 'gas' ? 'm³' : key === 'heating_demand' ? '%' : '°C',
      ...(key === 'heating_demand' ? {} : { device_class: key === 'gas' ? 'gas' : 'temperature' }),
      state_class: key === 'gas' ? 'total_increasing' : 'measurement' } }));
  const entities = [{ entity_id: 'climate.test', device_id: 'thermostat' },
    ...keys.map((key) => ({ entity_id: selected[key], device_id: key === 'indoor' ? 'thermostat' : 'boiler' }))];
  const devices = [{ id: 'thermostat', name: 'Test thermostat' }, { id: 'boiler', name: 'Test boiler', model: 'Generic boiler' }];
  const history = Object.fromEntries(keys.map((k) => [selected[k], []]));
  for (let i = 0; i <= 72; i++) {
    const values = { indoor: i <= 36 ? 20 - i * .03 : 18.92 + (i - 36) * .12, outdoor: 5, heating_demand: i < 36 ? 0 : 50, gas: 100 + i * .01, flow: 45, return: 40 };
    for (const key of keys) history[selected[key]].push({ s: String(values[key]), lu: (now - (72 - i) * 600000) / 1000 });
  }
  return { states, entities, devices, history };
}
module.exports = { fixture, selected };
