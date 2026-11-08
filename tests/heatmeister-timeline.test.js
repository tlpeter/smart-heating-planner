'use strict';

// "Why the HeatMeisters run": control states from Home Assistant's history
// turned into blocks, with the reason and the plan next to them.

const test = require('node:test');
const assert = require('node:assert/strict');
const tl = require('../smart_heating_planner/app/heatmeister-timeline');

const M = 60000;
const from = 0;
const to = 6 * 60 * M;
const e = (min, s) => ({ lu: (min * M) / 1000, s: String(s) });

function day() {
  const hist = {
    'sensor.g_state': [e(0, 'idle'), e(60, 'heat'), e(180, 'overrun'), e(200, 'idle'), e(240, 'defrost'), e(250, 'heat')],
    'number.g_fan': [e(0, 0), e(60, 40), e(90, 100), e(180, 30), e(200, 0), e(250, 100)],
    'sensor.g_in': [e(0, 24), e(60, 32), e(120, 38), e(180, 33), e(240, 36), e(245, 29), e(250, 35)],
    'sensor.g_rate': [e(0, 0), e(60, 0.8), e(180, -0.3), e(240, -1.4), e(250, 0.6)],
    'sensor.g_room': [e(0, 19), e(60, 19.1)],
    'number.g_t': [e(0, 20)],
    'switch.g_rc': [e(0, 'on')],
    'sensor.v_state': [e(0, 'slave')],
  };
  const devices = [
    { prefix: 'g', name: 'Garage', follows: '', all: { control_state: ['sensor.g_state'], fan_speed: ['number.g_fan'], inlet: ['sensor.g_in'], inlet_rate: ['sensor.g_rate'], room: ['sensor.g_room'], room_target: ['number.g_t'], room_control: ['switch.g_rc'] } },
    { prefix: 'v', name: 'Voor', follows: 'g', all: { control_state: ['sensor.v_state'] } },
    { prefix: 'x', name: 'Gang', follows: 'g', all: { fan_speed: ['number.g_fan'] } },
  ];
  const climateHist = [
    { lu: 0, s: 'heat', a: { temperature: 20, hvac_action: 'heating' } },
    { lu: 200 * 60, s: 'heat', a: { temperature: 17, hvac_action: 'idle' } },
  ];
  return tl.build({ devices, hist, climateHist, plannedAt: () => 20, from, to });
}

test('control states: names (firmware 2.9) and numbers (older firmware)', () => {
  assert.equal(tl.stateName('heat'), 'heat');
  assert.equal(tl.stateName('3'), 'heat');
  assert.equal(tl.stateName('4'), 'defrost');
  assert.equal(tl.stateName('Startup support'), 'startup');
  assert.equal(tl.stateName('sensor error'), 'sensor_error');
  assert.equal(tl.stateName('unavailable'), null);
  assert.equal(tl.stateName('banana'), null);
});

test('blocks per state, with the measured values and the plan as the reason', () => {
  const d = day();
  const g = d.devices[0];
  assert.deepEqual(g.segments.map((s) => [s.from / M, s.to / M, s.effective]),
    [[0, 60, 'idle'], [60, 180, 'heat'], [180, 200, 'overrun'], [200, 240, 'idle'], [240, 250, 'defrost'], [250, 360, 'heat']]);
  const heat = g.segments[1];
  assert.equal(heat.values.inlet_start, 32);
  assert.equal(heat.values.inlet_max, 38);
  assert.equal(heat.values.rate_start, 0.8);
  assert.equal(heat.values.fan_max, 100);
  assert.ok(heat.values.fan_avg > 80 && heat.values.fan_avg < 90, `average ${heat.values.fan_avg}`);
  assert.equal(heat.values.setpoint, 20);
  assert.equal(heat.values.planned, 20);
  assert.equal(heat.values.heat_asked, 1);
  assert.match(heat.why.join(' '), /Radiator in: 32\.0 °C at the start, up to 38\.0 °C \(changing \+0\.80 °C\/min\)/);
  assert.match(heat.why.join(' '), /Plan: thermostat set to 20\.0 °C, schedule 20\.0 °C, thermostat asked for heat/);
  assert.match(g.segments[4].why.join(' '), /dropped up to -1\.40 °C\/min/);
  assert.equal(g.segments[5].values.heat_asked, 0);
});

test('a slave gets the state of its master; one without a control state follows the master it is set to follow', () => {
  const d = day();
  const voor = d.devices[1];
  assert.ok(voor.segments.every((s) => s.state === 'slave' && s.source === 'master'));
  assert.deepEqual(voor.segments.map((s) => s.effective), ['idle', 'heat', 'overrun', 'idle', 'defrost', 'heat']);
  assert.match(voor.segments[1].why[0], /slave; the state is that of Garage/);
  const gang = d.devices[2];
  assert.equal(gang.source, 'master');
  assert.equal(gang.segments[1].effective, 'heat');
  assert.equal(gang.segments[1].values.fan_max, 100, 'its own fan values are kept');
  assert.deepEqual(voor.items, [], 'what the master shows is not told again at the slave');
});

test('no control state and no master: only running or off from the fan', () => {
  const d = tl.build({
    devices: [{ prefix: 'a', name: 'A', follows: '', all: { fan_speed: ['number.a'] } }],
    hist: { 'number.a': [e(0, 0), e(30, 50), e(90, 0)] },
    from, to,
  });
  assert.equal(d.devices[0].source, 'fan');
  assert.deepEqual(d.devices[0].segments.map((s) => s.effective), ['off', 'running', 'off']);
});

test('what stands out: full speed while too cold, heat without a request, defrosts, manual and sensor errors', () => {
  const g = day().devices[0];
  const text = g.items.map((i) => i.text).join('\n');
  assert.match(text, /full speed .* room stayed below its target/);
  assert.match(text, /1 h 50 min of heating while the thermostat did not ask for heat/);
  assert.match(text, /1× a heat pump defrost cycle/);
  const d = tl.build({
    devices: [{ prefix: 'a', name: 'A', follows: '', all: { control_state: ['s.a'] } }],
    hist: { 's.a': [e(0, 'manual'), e(60, 'sensor_error'), e(90, 'idle')] },
    from, to,
  });
  const t2 = d.devices[0].items.map((i) => `${i.level}: ${i.text}`).join('\n');
  assert.match(t2, /warn: Manual control for 1 h 00 min/);
  assert.match(t2, /warn: Sensor error for 30 min/);
});

test('short flickers (under a minute) are folded into the block before', () => {
  const d = tl.build({
    devices: [{ prefix: 'a', name: 'A', follows: '', all: { control_state: ['s.a'] } }],
    hist: { 's.a': [{ lu: 0, s: 'heat' }, { lu: 600, s: 'idle' }, { lu: 620, s: 'heat' }, { lu: 1200, s: 'overrun' }] },
    from, to,
  });
  assert.deepEqual(d.devices[0].segments.map((s) => s.effective), ['heat', 'overrun']);
});

test('the HeatMeisters chosen in Settings, else all found', () => {
  const states = [
    { entity_id: 'sensor.heatbooster_a_temp_inlet', state: '30', attributes: { friendly_name: 'HeatMeister - A Water inlet temperature' } },
    { entity_id: 'sensor.heatbooster_b_temp_inlet', state: '30', attributes: { friendly_name: 'HeatMeister - B Water inlet temperature' } },
  ];
  assert.deepEqual(tl.devicesFrom(states, { heatmeisters: [] }).map((d) => d.name), ['A', 'B']);
  assert.deepEqual(tl.devicesFrom(states, { heatmeisters: [{ prefix: 'heatbooster_b', name: 'Bee', follows: 'heatbooster_a' }] }).map((d) => [d.name, d.follows]), [['Bee', 'heatbooster_a']]);
});
