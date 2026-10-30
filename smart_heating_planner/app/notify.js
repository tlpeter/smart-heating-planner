'use strict';

// Notifications to your phones (Settings › Notifications), like Smart
// Charging Planner: more recipients, each with its own notify action and its
// own choice of messages. Per recipient: show it in Android Auto (car_ui) and
// send it with high importance. Nothing is sent without a recipient.

const path = require('path');
const ha = require('./ha');
const { DATA_DIR } = require('./options');
const { readJson, writeJsonAtomic } = require('./jsonstore');

const FILE = path.join(DATA_DIR, 'notify.json');
const ICON = 'mdi:radiator';
const MAX_RECIPIENTS = 10;

// What the app can send, in three groups. Each recipient chooses per message;
// a message that is new in a later version is on.
const CATEGORIES = [
  { id: 'problems', name: 'Problems', text: 'Something did not work: the thermostat, the HeatMeisters or the daily limit.' },
  { id: 'heating', name: 'Heating', text: 'The heating goes to another temperature, or someone changed it by hand.' },
  { id: 'presence', name: 'Who is home', text: 'Everyone left, someone came home or is on the way home.' },
];
const MESSAGES = [
  { id: 'thermostat_failed', category: 'problems', name: 'Setting the thermostat failed' },
  { id: 'thermostat_offline', category: 'problems', name: 'Thermostat not reachable (10 minutes)' },
  { id: 'thermostat_back', category: 'problems', name: 'Thermostat reachable again' },
  { id: 'limit_reached', category: 'problems', name: 'Daily limit of changes reached' },
  { id: 'hm_target_failed', category: 'problems', name: 'HeatMeister room target not set' },
  { id: 'mqtt_failed', category: 'problems', name: 'Temperature to the HeatMeisters not sent' },
  { id: 'heating_changed', category: 'heating', name: 'Heating goes to another temperature' },
  { id: 'manual_change', category: 'heating', name: 'Changed on the thermostat by hand' },
  { id: 'hold_ended', category: 'heating', name: 'Manual hold ended' },
  { id: 'everyone_left', category: 'presence', name: 'Everyone left' },
  { id: 'first_home', category: 'presence', name: 'Someone is home again' },
  { id: 'coming_home', category: 'presence', name: 'Someone is on the way home' },
];
const MESSAGE = Object.fromEntries(MESSAGES.map((m) => [m.id, m]));

// [{ id, name, service, off: [message ids], car_ui, high }]
let list = null;
function recipients() {
  if (!list) {
    const saved = readJson(FILE, {});
    list = Array.isArray(saved.recipients) ? saved.recipients : [];
    ha.setNotifyTargets(list.map((r) => r.service));
  }
  return list;
}
function save(newList) {
  list = newList;
  writeJsonAtomic(FILE, { recipients: list });
  ha.setNotifyTargets(list.map((r) => r.service));
}

function wants(r, messageId) {
  return messageId === 'test' || !(r.off || []).includes(messageId);
}

// What goes with the message: the radiator icon, and per recipient Android
// Auto (car_ui) and high importance (Home Assistant Companion App for Android;
// an iPhone ignores these).
function dataFor(r) {
  const data = { notification_icon: ICON };
  if (r.car_ui !== false) data.car_ui = true;
  if (r.high !== false) data.importance = 'high';
  return data;
}

const lastSentByKey = new Map(); // key -> time, so the same message is not repeated
let lastNotification = null; // { at, title, message, sent, error, to }
const lastByRecipient = new Map(); // recipient id -> { at, title, sent, error }

// messageId: one of MESSAGES (or 'test'). key + minGapMs: not the same
// message again within that time. only: this recipient only (test).
async function notify(messageId, title, message, { key = null, minGapMs = 0, only = null, now = Date.now() } = {}) {
  const all = recipients();
  if (!all.length) return { sent: false, reason: 'off' };
  const to = all.filter((r) => (only ? r.id === only : wants(r, messageId)));
  if (!to.length) return { sent: false, reason: 'no_recipient' };
  if (key) {
    const at = lastSentByKey.get(key);
    if (at && now - at < minGapMs) return { sent: false, reason: 'repeat' };
    lastSentByKey.set(key, now);
  }
  const results = await Promise.all(to.map(async (r) => {
    try {
      await ha.sendNotification(r.service, title, message, dataFor(r));
      lastByRecipient.set(r.id, { at: now, title, sent: true, error: null });
      return { id: r.id, sent: true };
    } catch (err) {
      lastByRecipient.set(r.id, { at: now, title, sent: false, error: err.message });
      ha.warn(`Notification to recipient ${r.id} failed:`, err.message);
      return { id: r.id, sent: false, error: err.message };
    }
  }));
  const sent = results.some((x) => x.sent);
  const error = results.filter((x) => !x.sent).map((x) => x.error).join('; ') || null;
  lastNotification = { at: now, title, message, sent, error, to: to.map((r) => r.name) };
  return sent ? { sent: true, results } : { sent: false, error, results };
}

// Fire and forget: a notification never stops the heating.
function send(messageId, title, message, opts) {
  notify(messageId, title, message, opts).catch((err) => ha.warn('Notification failed:', err.message));
}

// Check and tidy the recipients from the page. services: the notify actions
// that exist in Home Assistant.
function cleanRecipients(input, services) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (!Array.isArray(input)) throw bad('Send a list of recipients');
  if (input.length > MAX_RECIPIENTS) throw bad(`At most ${MAX_RECIPIENTS} recipients`);
  const used = new Set();
  return input.map((r, i) => {
    const name = String((r && r.name) || '').trim().replace(/\s+/g, ' ').slice(0, 40) || `Phone ${i + 1}`;
    const service = ha.normaliseNotify(r && r.service);
    if (!service) throw bad(`${name}: choose a notify action`);
    if (!services.includes(service)) throw bad(`${name}: ${service} is not a notify action in Home Assistant; choose one from the list`);
    let id = String((r && r.id) || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 20);
    if (!id || used.has(id)) { let k = i + 1; while (used.has(`r${k}`)) k++; id = `r${k}`; }
    used.add(id);
    const off = r && Array.isArray(r.off) ? [...new Set(r.off.map(String).filter((x) => MESSAGE[x]))] : [];
    return { id, name, service, off, car_ui: !(r && r.car_ui === false), high: !(r && r.high === false) };
  });
}

function status() {
  return {
    recipients: recipients().map((r) => ({ ...r, last: lastByRecipient.get(r.id) || null })),
    categories: CATEGORIES,
    messages: MESSAGES,
    last_notification: lastNotification,
  };
}

// For tests: forget what was sent.
function reset() {
  lastSentByKey.clear();
}

module.exports = { notify, send, recipients, save, cleanRecipients, status, dataFor, reset, CATEGORIES, MESSAGES, MAX_RECIPIENTS };
