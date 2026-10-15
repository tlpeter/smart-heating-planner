'use strict';

// Notifications (Settings › Notifications), like Smart Charging Planner: more
// recipients, each with its own notify action and messages, Android Auto
// (car_ui) and high importance. The real app with "Allow control" on, against
// the fake Home Assistant.

const test = require('node:test');
const assert = require('node:assert/strict');
const fakeHa = require('./fake-ha');
const { startApp, sleep } = require('./app-runner');

const PORT = Number(process.env.SHP_NOTIFY_TEST_PORT) || 18195;
const PHONES = ['mobile_app_peter_pixel', 'mobile_app_yvonne_iphone'];
let app;
const req = (...a) => app.req(...a);
const save = (body) => req('POST', '/api/settings', body);
const refreshed = async () => { await save({}); return (await req('GET', '/api/status')).data; };
const flat = (temp) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ time: '00:00', temp, preheat: false }]]));
const sent = (service) => fakeHa.world.notifications.filter((n) => !service || n.service === service);

test.before(async () => {
  app = await startApp({ port: PORT, options: { allow_control: true }, env: { SHP_GAP_MS: '50', SHP_SETTLE_MS: '100', SHP_LIVE_MS: '50' } });
  await save({
    thermostat: 'climate.tado_smart_thermostat_ru3010610432',
    persons: ['peter', 'yvonne', 'cheyenne'].map((n) => ({ entity_id: `person.${n}`, counts: true, coming_home: true })),
    tracker_types: { gps: true, router: false, bluetooth: false },
    away_temp: 16,
    away_delay_minutes: 0,
    schedule: flat(20),
  });
});
test.after(() => { if (app) app.stop(); });

test('nothing is sent without recipients', async () => {
  await refreshed();
  assert.equal(sent().length, 0);
});

test('the notify actions of Home Assistant are offered, phones first; the messages come in groups', async () => {
  const { data } = await req('GET', '/api/notify');
  assert.deepEqual(data.choices.slice(0, 3).map((c) => c.id), ['notify.mobile_app_cheyenne', 'notify.mobile_app_peter_pixel', 'notify.mobile_app_yvonne_iphone']);
  assert.ok(!data.choices.some((c) => c.id === 'notify.send_message'), 'send_message needs an entity');
  assert.deepEqual(data.categories.map((c) => c.id), ['problems', 'heating', 'presence']);
  assert.ok(data.messages.length >= 10);
  assert.deepEqual(data.recipients, []);
});

test('recipients are checked and saved: more phones, own messages, Android Auto and importance per phone', async () => {
  assert.equal((await req('POST', '/api/notify', { recipients: [{ name: 'X', service: 'notify.nope' }] })).status, 400, 'unknown notify action');
  assert.equal((await req('POST', '/api/notify', { recipients: [{ name: 'X', service: '' }] })).status, 400, 'no notify action');
  assert.equal((await req('POST', '/api/notify', { recipients: Array.from({ length: 11 }, () => ({ service: 'notify.mobile_app_peter_pixel' })) })).status, 400, 'at most 10');
  const r = await req('POST', '/api/notify', { recipients: [
    { name: 'Peter', service: 'mobile_app_peter_pixel', off: ['nope'] },
    { name: 'Yvonne', service: 'notify.mobile_app_yvonne_iphone', car_ui: false, high: false, off: ['heating_changed'] },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.recipients.map((x) => [x.id, x.service, x.car_ui, x.high, x.off]), [
    ['r1', 'notify.mobile_app_peter_pixel', true, true, []],
    ['r2', 'notify.mobile_app_yvonne_iphone', false, false, ['heating_changed']],
  ]);
});

test('a test goes to one phone, with the radiator icon, Android Auto and high importance', async () => {
  const r = await req('POST', '/api/notify/test', { recipient_id: 'r1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const n = sent().at(-1);
  assert.equal(n.service, 'mobile_app_peter_pixel');
  assert.equal(n.title, 'Smart Heating test');
  assert.deepEqual(n.data, { notification_icon: 'mdi:radiator', car_ui: true, importance: 'high' });
  await req('POST', '/api/notify/test', { recipient_id: 'r2' });
  assert.deepEqual(sent().at(-1).data, { notification_icon: 'mdi:radiator' }, 'Android Auto and high importance off for this phone');
  assert.equal((await req('POST', '/api/notify/test', { recipient_id: 'r9' })).status, 400);
});

test('everyone leaves: "Nobody home" and the heating change; a phone without that message does not get it', async () => {
  fakeHa.world.notifications = [];
  fakeHa.world.persons = { peter: 'not_home', yvonne: 'not_home', cheyenne: 'not_home' };
  await refreshed();
  await sleep(100);
  const titles = sent('mobile_app_peter_pixel').map((n) => n.title);
  assert.ok(titles.includes('Nobody home'), titles.join(' | '));
  assert.ok(titles.includes('Heating 16 °C'), titles.join(' | '));
  const y = sent('mobile_app_yvonne_iphone').map((n) => n.title);
  assert.ok(y.includes('Nobody home'));
  assert.ok(!y.includes('Heating 16 °C'), 'Yvonne turned "heating changed" off');
});

test('someone comes home: "<name> is home"', async () => {
  fakeHa.world.notifications = [];
  fakeHa.world.persons.yvonne = 'home';
  await sleep(100); // the minimum time between two thermostat changes
  await refreshed();
  await sleep(100);
  const titles = sent('mobile_app_peter_pixel').map((n) => n.title);
  assert.ok(titles.includes('Yvonne is home'), titles.join(' | '));
  assert.ok(titles.includes('Heating 20 °C'), titles.join(' | '));
});

test('a change on the thermostat by hand is reported', async () => {
  await sleep(200); // the thermostat had time to show the app's last change
  fakeHa.world.notifications = [];
  fakeHa.world.target = 22;
  await refreshed();
  await sleep(100);
  const n = sent('mobile_app_peter_pixel').find((x) => x.title === 'Changed on the thermostat');
  assert.ok(n, sent().map((x) => x.title).join(' | '));
  assert.match(n.message, /Kept at 22 °C until/);
});

test('a phone that loses its location does not say "<name> is home"', async () => {
  // Hold from the test before ended, so the advice follows presence again.
  await req('DELETE', '/api/hold');
  fakeHa.world.persons = { peter: 'not_home', yvonne: 'not_home', cheyenne: 'not_home' };
  await sleep(100);
  await refreshed();
  await sleep(100);
  fakeHa.world.notifications = [];
  fakeHa.world.persons.peter = 'unknown';
  await sleep(100);
  await refreshed();
  await sleep(100);
  const titles = sent().map((n) => n.title);
  assert.ok(!titles.some((t) => / is home$/.test(t)), titles.join(' | '));
});

test('a phone that does not answer does not stop the heating', async () => {
  fakeHa.world.failNotify = true;
  const r = await req('POST', '/api/notify/test', { recipient_id: 'r1' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Phone not registered/);
  const s = await refreshed();
  assert.equal(s.ready, true);
  fakeHa.world.failNotify = false;
  const { data } = await req('GET', '/api/notify');
  assert.equal(data.last_notification.sent, false);
  assert.equal(data.recipients[0].last.sent, false);
});

test('SAFETY: notifications only go to the chosen phones; nothing else but the thermostat is written', () => {
  const writes = fakeHa.calls.filter((c) => c.type === 'call_service');
  for (const c of writes) {
    if (c.domain === 'notify') assert.ok(PHONES.includes(c.service), c.service);
    else assert.equal(`${c.domain}.${c.service}`, 'climate.set_temperature');
  }
  assert.ok(writes.some((c) => c.domain === 'notify'));
});
