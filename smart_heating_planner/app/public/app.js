'use strict';

// The page. Talks to the app through relative URLs (works behind ingress).

const $ = (id) => document.getElementById(id);
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const EVENT = { advice: 'Advice', sent: 'Sent', manual: 'Changed by hand', error: 'Error' };
const SOURCE = { schedule: 'Schedule', away: 'Away', preheat: 'Preheat', approaching: 'On the way', hold: 'Manual hold' };

let settings = null;
let entities = null;
let status = null;
let tz = undefined;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function t1(v) { return v == null || Number.isNaN(Number(v)) ? '–' : `${Number(v).toFixed(1)} °C`; }
function clock(ms) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}
function dateTime(ms) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showError(msg) {
  $('error').textContent = msg || '';
  $('error').classList.toggle('hidden', !msg);
}

// ---------------------------------------------------------------- tabs
function showPage(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('hidden', p.id !== `page-${name}`));
  if (name === 'activity') loadActivity();
  if (name === 'settings') loadSettingsPage();
  if (name === 'schedule') renderSchedule();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.page)));
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-goto]');
  if (a) { e.preventDefault(); showPage(a.dataset.goto); }
});

// ---------------------------------------------------------------- home
function renderStatus(s) {
  status = s;
  $('version').textContent = s.version ? `v${s.version}` : '';
  if (!s.ready) {
    $('adv-reason').textContent = s.message || 'Waiting for Home Assistant…';
    return;
  }
  tz = s.timeZone;
  showError(s.error ? `Last refresh failed: ${s.error}` : '');
  $('banner').classList.toggle('hidden', s.mode === 'control');
  $('banner-control').classList.toggle('hidden', s.mode !== 'control');
  const last = s.control && s.control.last;
  const ctl = $('ctl-last');
  ctl.classList.toggle('hidden', !(s.mode === 'control' && last));
  if (s.mode === 'control' && last) {
    ctl.textContent = last.error
      ? `Sending failed at ${clock(last.at)}: ${last.error}`
      : last.sent ? `Sent at ${clock(last.at)}: ${last.why}` : `Not sent: ${last.why}`;
    ctl.textContent += ` · ${s.control.writesToday} of ${s.control.maxWritesPerDay} changes in 24 h`;
  }
  $('setup-hint').classList.toggle('hidden', s.setup.thermostat && s.setup.persons > 0);

  const a = s.advice;
  $('adv-target').textContent = a.target.toFixed(1);
  $('adv-reason').textContent = `${SOURCE[a.source] || a.source} · ${a.reason}`;
  const th = s.thermostat;
  $('th-current').textContent = th.available ? t1(th.current) : (th.entity_id ? 'unavailable' : 'not chosen');
  $('th-target').textContent = th.available ? t1(th.target) : '–';
  $('th-action').textContent = th.available ? (th.hvac_action || th.state) : '–';
  const ch = $('adv-change');
  if (th.available) {
    ch.classList.remove('hidden');
    ch.className = `pill ${a.change ? 'change' : 'same'}`;
    const verb = s.mode === 'control' ? 'Will change' : 'Would change';
    const sentNow = s.mode === 'control' && s.control.lastSent && s.control.lastSent.temp === a.target && s.at - s.control.lastSent.at < 5 * 60000;
    ch.textContent = !a.change ? 'Thermostat already matches'
      : sentNow ? `Sent ${t1(a.target)}, waiting for the thermostat to show it`
        : `${verb} ${t1(th.target)} → ${t1(a.target)}`;
  } else ch.classList.add('hidden');

  const p = s.presence;
  const way = new Map((p.onTheWay || []).map((w) => [w.entity_id, w]));
  const zone = (z) => (z === 'not_home' ? 'away' : String(z || '').replace(/_/g, ' '));
  const chips = (p.people || []).map((x) => {
    if (!x.counts) return `<li>${esc(x.name)} · does not count</li>`;
    if (x.status === 'home') return `<li class="home">${esc(x.name)} · home</li>`;
    if (x.status === 'unknown') return `<li class="unknown">${esc(x.name)} · location unknown</li>`;
    const w = way.get(x.entity_id);
    const extra = w ? ` · ${w.km.toFixed(1)} km${w.towards ? ', coming home' : ''}` : '';
    return `<li class="away">${esc(x.name)} · ${esc(zone(x.state))}${esc(extra)}</li>`;
  });
  $('persons').innerHTML = chips.join('') || '<li>No persons chosen</li>';
  const notes = [];
  if (p.noPersons) notes.push('No persons count: the schedule is followed as if someone is home.');
  if (p.waitingUntil) notes.push(`Everybody left. Waiting until ${clock(p.waitingUntil)} before lowering.`);
  if (p.approaching) notes.push('Someone is on the way home: heating by the schedule.');
  if (p.unknown.length) notes.push('A person with an unknown location counts as home.');
  $('presence-note').textContent = notes.join(' ');

  if (s.schedule) {
    $('sch-since').textContent = s.schedule.current.time;
    $('sch-now').textContent = t1(s.schedule.current.temp) + (s.schedule.current.preheat ? ' · preheat' : '');
    $('sch-next-time').textContent = `${DAY_NAMES[s.schedule.next.day].slice(0, 3)} ${s.schedule.next.time}`;
    $('sch-next').textContent = t1(s.schedule.next.temp);
    const m = s.schedule.next.inMinutes;
    $('sch-in').textContent = `In ${m >= 60 ? `${Math.floor(m / 60)} h ` : ''}${m % 60} min`;
  }

  $('hold-active').classList.toggle('hidden', !s.hold);
  $('hold-form').classList.toggle('hidden', !!s.hold);
  if (s.hold) {
    $('hold-what').textContent = s.hold.source === 'thermostat' ? 'Changed on the thermostat: keeping' : 'Holding';
    $('hold-temp').textContent = t1(s.hold.temp);
    $('hold-until').textContent = dateTime(s.hold.until);
  }

  const hms = s.heatmeisters || [];
  const v = (x, unit = ' °C') => (x == null ? '–' : `${Number(x).toFixed(1)}${unit}`);
  $('hm-list').innerHTML = hms.length
    ? `<p class="muted small">Thermostat asks for heat: <b>${s.demand ? 'yes' : 'no'}</b></p>` + hms.map((h) => `
      <div class="hm">
        <div><b>${esc(h.name)}</b>
          <div class="hmgrid">
            <span>Radiator in <b>${v(h.inlet)}</b></span>
            <span>Out <b>${v(h.outlet)}</b></span>
            <span>Room <b>${v(h.room)}</b>${h.room_control ? ` (target ${v(h.room_target)})` : ''}</span>
            <span>Fan <b>${h.fan_speed == null ? '–' : `${h.fan_speed} %`}</b>${h.boost ? ' · boost' : ''}${h.manual ? ' · manual' : ''}</span>
          </div>
        </div>
        <span class="state">${esc(h.available ? (h.control_state || '–') : 'unavailable')}</span>
        <span class="pill ${h.running ? 'change' : 'same'}">${h.running ? 'running' : 'off'}</span>
      </div>`).join('')
    : '<p class="muted small">No HeatMeisters shown. Choose them in <a href="#" data-goto="settings">Settings</a>.</p>';
}

async function refreshStatus() {
  try {
    renderStatus(await api('api/status'));
  } catch (err) {
    showError(`Could not reach the app: ${err.message}`);
  }
}

$('hold-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('hold-for').value;
  try {
    renderStatus(await api('api/hold', { method: 'POST', body: v === 'next' ? { temp: Number($('hold-temp-in').value), until: 'next' } : { temp: Number($('hold-temp-in').value), minutes: Number(v) } }));
  } catch (err) { showError(err.message); }
});
$('hold-end').addEventListener('click', async () => {
  try { renderStatus(await api('api/hold', { method: 'DELETE' })); } catch (err) { showError(err.message); }
});

// ---------------------------------------------------------------- schedule
let draft = null;
function renderSchedule() {
  if (!settings) return;
  if (!draft) draft = JSON.parse(JSON.stringify(settings.schedule));
  $('schedule').innerHTML = DAYS.map((d) => `
    <div class="day" data-day="${d}">
      <h3>${DAY_NAMES[d]}</h3>
      ${(draft[d] || []).map((p, i) => `
        <div class="point" data-i="${i}">
          <input type="time" value="${esc(p.time)}" data-f="time" aria-label="Time">
          <input type="number" min="5" max="25" step="0.5" value="${esc(p.temp)}" data-f="temp" aria-label="Temperature">
          <label><input type="checkbox" data-f="preheat" ${p.preheat ? 'checked' : ''}> Preheat</label>
          <button type="button" class="btn danger" data-remove aria-label="Remove">✕</button>
        </div>`).join('')}
      <button type="button" class="btn" data-add>+ Switch point</button>
    </div>`).join('');
}
$('schedule').addEventListener('input', (e) => {
  const row = e.target.closest('.point');
  if (!row) return;
  const d = row.closest('.day').dataset.day;
  const p = draft[d][Number(row.dataset.i)];
  const f = e.target.dataset.f;
  if (f === 'time') p.time = e.target.value;
  if (f === 'temp') p.temp = Number(e.target.value);
  if (f === 'preheat') p.preheat = e.target.checked;
});
$('schedule').addEventListener('click', (e) => {
  const day = e.target.closest('.day');
  if (!day) return;
  const d = day.dataset.day;
  if (e.target.matches('[data-add]')) {
    const last = draft[d][draft[d].length - 1];
    draft[d].push({ time: '12:00', temp: last ? last.temp : 19, preheat: false });
    renderSchedule();
  }
  if (e.target.matches('[data-remove]')) {
    draft[d].splice(Number(e.target.closest('.point').dataset.i), 1);
    renderSchedule();
  }
});
$('copy-mon').addEventListener('click', () => {
  for (const d of ['tue', 'wed', 'thu', 'fri']) draft[d] = JSON.parse(JSON.stringify(draft.mon));
  renderSchedule();
});
$('save-schedule').addEventListener('click', async () => {
  try {
    settings = await api('api/settings', { method: 'POST', body: { schedule: draft } });
    draft = null;
    renderSchedule();
    $('schedule-msg').textContent = 'Saved.';
    refreshStatus();
  } catch (err) {
    $('schedule-msg').textContent = err.message;
  }
});

// ---------------------------------------------------------------- activity
async function loadActivity() {
  try {
    const rows = await api('api/activity');
    $('activity').innerHTML = rows.map((r) => `
      <tr>
        <td class="num">${dateTime(r.at)}</td>
        <td>${esc(EVENT[r.event || 'advice'] || r.event)}</td>
        <td class="num">${t1(r.target)}</td>
        <td class="num">${t1(r.thermostat)}</td>
        <td>${esc(SOURCE[r.source] || r.source)} · ${esc(r.reason)}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing yet.</td></tr>';
  } catch (err) { showError(err.message); }
}

// ---------------------------------------------------------------- settings
function options(list, selected, empty) {
  const ids = new Set(list.map((x) => x.entity_id));
  const extra = selected && !ids.has(selected) ? [{ entity_id: selected, name: `${selected} (not found)` }] : [];
  return `<option value="">${esc(empty)}</option>` + [...list, ...extra].map((x) =>
    `<option value="${esc(x.entity_id)}" ${x.entity_id === selected ? 'selected' : ''}>${esc(x.name)} (${esc(x.entity_id)})${x.heatmeister ? ' ★' : ''}</option>`).join('');
}

function thermostatNote() {
  const id = $('s-thermostat').value;
  const th = (entities && entities.thermostats || []).find((x) => x.entity_id === id);
  let text = '';
  if (th && th.cloud) text = '⚠ This thermostat goes through the tado cloud. tado allows only 100 requests per day without a subscription. Prefer the HomeKit thermostat (local).';
  else if (th && th.local) text = '✓ Local connection (HomeKit): no tado cloud limit.';
  $('s-thermostat-note').textContent = text;
}

// Persons: one row each, with "counts" and "coming home".
const TYPE_NAME = { gps: 'GPS', router: 'router', bluetooth: 'Bluetooth' };
function personRows() {
  const saved = new Map(settings.persons.map((p) => [p.entity_id, p]));
  const types = { gps: $('s-t-gps').checked, router: $('s-t-router').checked, bluetooth: $('s-t-bluetooth').checked };
  return entities.persons.map((p) => {
    const s = saved.get(p.entity_id);
    const counts = s ? s.counts : false;
    const coming = s ? s.coming_home : true;
    const trk = p.trackers.map((t) => `<span class="trk ${types[t.type] ? '' : 'off'} ${t.state === 'home' ? 'home' : ''}" title="${esc(t.entity_id)}">${esc(TYPE_NAME[t.type])}: ${esc(t.state.replace(/_/g, ' '))}</span>`).join('') || '<span class="muted small">no trackers</span>';
    return `<tr data-id="${esc(p.entity_id)}">
      <td><b>${esc(p.name)}</b></td>
      <td><input type="checkbox" data-f="counts" ${counts ? 'checked' : ''} aria-label="Counts for home"></td>
      <td><input type="checkbox" data-f="coming_home" ${coming ? 'checked' : ''} aria-label="Coming home"></td>
      <td>${trk}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">No person entities found.</td></tr>';
}
function readPersons() {
  return [...document.querySelectorAll('#s-persons tr[data-id]')].map((tr) => ({
    entity_id: tr.dataset.id,
    counts: tr.querySelector('[data-f=counts]').checked,
    coming_home: tr.querySelector('[data-f=coming_home]').checked,
  }));
}
// Changing a tracker kind only redraws which trackers are crossed out.
for (const id of ['s-t-gps', 's-t-router', 's-t-bluetooth']) {
  $(id).addEventListener('change', () => {
    const keep = readPersons();
    settings = { ...settings, persons: keep };
    $('s-persons').innerHTML = personRows();
  });
}

async function loadSettingsPage() {
  try {
    entities = await api('api/entities');
  } catch (err) {
    showError(`Could not load entities: ${err.message}`);
    entities = { thermostats: [], persons: [], heatmeisters: [] };
  }
  const s = settings;
  $('s-thermostat').innerHTML = options(entities.thermostats.map((x) => ({ ...x, name: `${x.name}${x.local ? ' – HomeKit, local' : x.cloud ? ' – tado cloud' : ''}` })), s.thermostat, '– choose –');
  thermostatNote();
  $('s-t-gps').checked = s.tracker_types.gps;
  $('s-t-router').checked = s.tracker_types.router;
  $('s-t-bluetooth').checked = s.tracker_types.bluetooth;
  $('s-persons').innerHTML = personRows();
  $('s-away').value = s.away_temp;
  $('s-delay').value = s.away_delay_minutes;
  $('s-km').value = s.coming_home_km;
  const chosen = new Set(s.heatmeisters.map((h) => h.prefix));
  $('s-hms').innerHTML = entities.heatmeisters.map((h) =>
    `<label><input type="checkbox" value="${esc(h.prefix)}" data-name="${esc(h.name)}" ${chosen.has(h.prefix) ? 'checked' : ''}> ${esc(h.name)}</label>`).join('')
    || '<p class="muted small">No HeatMeisters found (entities like sensor.heatbooster_…_temp_inlet).</p>';
  $('s-hold').value = s.hold_default_minutes;
  $('s-manual').value = s.manual_change_until;
}
$('s-thermostat').addEventListener('change', thermostatNote);

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    thermostat: $('s-thermostat').value,
    persons: readPersons(),
    tracker_types: { gps: $('s-t-gps').checked, router: $('s-t-router').checked, bluetooth: $('s-t-bluetooth').checked },
    away_temp: Number($('s-away').value),
    away_delay_minutes: Number($('s-delay').value),
    coming_home_km: Number($('s-km').value),
    heatmeisters: [...document.querySelectorAll('#s-hms input:checked')].map((x) => ({ prefix: x.value, name: x.dataset.name })),
    hold_default_minutes: Number($('s-hold').value),
    manual_change_until: $('s-manual').value,
  };
  try {
    settings = await api('api/settings', { method: 'POST', body });
    $('settings-msg').textContent = 'Saved.';
    refreshStatus();
  } catch (err) {
    $('settings-msg').textContent = err.message;
  }
});

// ---------------------------------------------------------------- start
(async () => {
  try { settings = await api('api/settings'); } catch (err) { showError(err.message); }
  await refreshStatus();
  setInterval(refreshStatus, 15000);
})();
