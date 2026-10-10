'use strict';

// The page. Talks to the app through relative URLs (works behind ingress).

const $ = (id) => document.getElementById(id);

// Material Design Icons (as used by Home Assistant and Mushroom), from @mdi/js 7.4.47 (Apache-2.0).
const ICONS = {"home": "M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z", "schedule": "M15,13H16.5V15.82L18.94,17.23L18.19,18.53L15,16.69V13M19,8H5V19H9.67C9.24,18.09 9,17.07 9,16A7,7 0 0,1 16,9C17.07,9 18.09,9.24 19,9.67V8M5,21C3.89,21 3,20.1 3,19V5C3,3.89 3.89,3 5,3H6V1H8V3H16V1H18V3H19A2,2 0 0,1 21,5V11.1C22.24,12.36 23,14.09 23,16A7,7 0 0,1 16,23C14.09,23 12.36,22.24 11.1,21H5M16,11.15A4.85,4.85 0 0,0 11.15,16C11.15,18.68 13.32,20.85 16,20.85A4.85,4.85 0 0,0 20.85,16C20.85,13.32 18.68,11.15 16,11.15Z", "activity": "M7,5H21V7H7V5M7,13V11H21V13H7M4,4.5A1.5,1.5 0 0,1 5.5,6A1.5,1.5 0 0,1 4,7.5A1.5,1.5 0 0,1 2.5,6A1.5,1.5 0 0,1 4,4.5M4,10.5A1.5,1.5 0 0,1 5.5,12A1.5,1.5 0 0,1 4,13.5A1.5,1.5 0 0,1 2.5,12A1.5,1.5 0 0,1 4,10.5M7,19V17H21V19H7M4,16.5A1.5,1.5 0 0,1 5.5,18A1.5,1.5 0 0,1 4,19.5A1.5,1.5 0 0,1 2.5,18A1.5,1.5 0 0,1 4,16.5Z", "settings": "M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z", "thermostat": "M16.95,16.95L14.83,14.83C15.55,14.1 16,13.1 16,12C16,11.26 15.79,10.57 15.43,10L17.6,7.81C18.5,9 19,10.43 19,12C19,13.93 18.22,15.68 16.95,16.95M12,5C13.57,5 15,5.5 16.19,6.4L14,8.56C13.43,8.21 12.74,8 12,8A4,4 0 0,0 8,12C8,13.1 8.45,14.1 9.17,14.83L7.05,16.95C5.78,15.68 5,13.93 5,12A7,7 0 0,1 12,5M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12C22,6.47 17.5,2 12,2Z", "radiator": "M7.95,3L6.53,5.19L7.95,7.4H7.94L5.95,10.5L4.22,9.6L5.64,7.39L4.22,5.19L6.22,2.09L7.95,3M13.95,2.89L12.53,5.1L13.95,7.3L13.94,7.31L11.95,10.4L10.22,9.5L11.64,7.3L10.22,5.1L12.22,2L13.95,2.89M20,2.89L18.56,5.1L20,7.3V7.31L18,10.4L16.25,9.5L17.67,7.3L16.25,5.1L18.25,2L20,2.89M2,22V14A2,2 0 0,1 4,12H20A2,2 0 0,1 22,14V22H20V20H4V22H2M6,14A1,1 0 0,0 5,15V17A1,1 0 0,0 6,18A1,1 0 0,0 7,17V15A1,1 0 0,0 6,14M10,14A1,1 0 0,0 9,15V17A1,1 0 0,0 10,18A1,1 0 0,0 11,17V15A1,1 0 0,0 10,14M14,14A1,1 0 0,0 13,15V17A1,1 0 0,0 14,18A1,1 0 0,0 15,17V15A1,1 0 0,0 14,14M18,14A1,1 0 0,0 17,15V17A1,1 0 0,0 18,18A1,1 0 0,0 19,17V15A1,1 0 0,0 18,14Z", "radiatorOff": "M3.28,2L2,3.27L4.77,6.04L5.64,7.39L4.22,9.6L5.95,10.5L7.23,8.5L10.73,12H4A2,2 0 0,0 2,14V22H4V20H18.73L20,21.27V22H22V20.73L22,20.72V20.72L3.28,2M7,17A1,1 0 0,1 6,18A1,1 0 0,1 5,17V15A1,1 0 0,1 6,14A1,1 0 0,1 7,15V17M11,17A1,1 0 0,1 10,18A1,1 0 0,1 9,17V15A1,1 0 0,1 10,14A1,1 0 0,1 11,15V17M15,17A1,1 0 0,1 14,18A1,1 0 0,1 13,17V15C13,14.79 13.08,14.61 13.18,14.45L15,16.27V17M16.25,9.5L17.67,7.3L16.25,5.1L18.25,2L20,2.89L18.56,5.1L20,7.3V7.31L18,10.4L16.25,9.5M22,14V18.18L19,15.18V15A1,1 0 0,0 18,14C17.95,14 17.9,14 17.85,14.03L15.82,12H20C21.11,12 22,12.9 22,14M11.64,7.3L10.22,5.1L12.22,2L13.95,2.89L12.53,5.1L13.95,7.3L13.94,7.31L12.84,9L11.44,7.62L11.64,7.3M7.5,3.69L6.1,2.28L6.22,2.09L7.95,3L7.5,3.69Z", "fan": "M12,11A1,1 0 0,0 11,12A1,1 0 0,0 12,13A1,1 0 0,0 13,12A1,1 0 0,0 12,11M12.5,2C17,2 17.11,5.57 14.75,6.75C13.76,7.24 13.32,8.29 13.13,9.22C13.61,9.42 14.03,9.73 14.35,10.13C18.05,8.13 22.03,8.92 22.03,12.5C22.03,17 18.46,17.1 17.28,14.73C16.78,13.74 15.72,13.3 14.79,13.11C14.59,13.59 14.28,14 13.88,14.34C15.87,18.03 15.08,22 11.5,22C7,22 6.91,18.42 9.27,17.24C10.25,16.75 10.69,15.71 10.89,14.79C10.4,14.59 9.97,14.27 9.65,13.87C5.96,15.85 2,15.07 2,11.5C2,7 5.56,6.89 6.74,9.26C7.24,10.25 8.29,10.68 9.22,10.87C9.41,10.39 9.73,9.97 10.14,9.65C8.15,5.96 8.94,2 12.5,2Z", "fanOff": "M12.5,2C9.64,2 8.57,4.55 9.29,7.47L15,13.16C15.87,13.37 16.81,13.81 17.28,14.73C18.46,17.1 22.03,17 22.03,12.5C22.03,8.92 18.05,8.13 14.35,10.13C14.03,9.73 13.61,9.42 13.13,9.22C13.32,8.29 13.76,7.24 14.75,6.75C17.11,5.57 17,2 12.5,2M3.28,4L2,5.27L4.47,7.73C3.22,7.74 2,8.87 2,11.5C2,15.07 5.96,15.85 9.65,13.87C9.97,14.27 10.4,14.59 10.89,14.79C10.69,15.71 10.25,16.75 9.27,17.24C6.91,18.42 7,22 11.5,22C13.8,22 14.94,20.36 14.94,18.21L18.73,22L20,20.72L3.28,4Z", "person": "M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z", "people": "M12,5.5A3.5,3.5 0 0,1 15.5,9A3.5,3.5 0 0,1 12,12.5A3.5,3.5 0 0,1 8.5,9A3.5,3.5 0 0,1 12,5.5M5,8C5.56,8 6.08,8.15 6.53,8.42C6.38,9.85 6.8,11.27 7.66,12.38C7.16,13.34 6.16,14 5,14A3,3 0 0,1 2,11A3,3 0 0,1 5,8M19,8A3,3 0 0,1 22,11A3,3 0 0,1 19,14C17.84,14 16.84,13.34 16.34,12.38C17.2,11.27 17.62,9.85 17.47,8.42C17.92,8.15 18.44,8 19,8M5.5,18.25C5.5,16.18 8.41,14.5 12,14.5C15.59,14.5 18.5,16.18 18.5,18.25V20H5.5V18.25M0,20V18.5C0,17.11 1.89,15.94 4.45,15.6C3.86,16.28 3.5,17.22 3.5,18.25V20H0M24,20H20.5V18.25C20.5,17.22 20.14,16.28 19.55,15.6C22.11,15.94 24,17.11 24,18.5V20Z", "away": "M24 13L20 17V14H11V12H20V9L24 13M4 20V12H1L11 3L18 9.3V10H15.79L11 5.69L6 10.19V18H16V16H18V20H4Z", "coming": "M15 13L11 17V14H2V12H11V9L15 13M5 20V16H7V18H17V10.19L12 5.69L7.21 10H4.22L12 3L22 12H19V20H5Z", "hand": "M13 24C9.74 24 6.81 22 5.6 19L2.57 11.37C2.26 10.58 3 9.79 3.81 10.05L4.6 10.31C5.16 10.5 5.62 10.92 5.84 11.47L7.25 15H8V3.25C8 2.56 8.56 2 9.25 2S10.5 2.56 10.5 3.25V12H11.5V1.25C11.5 .56 12.06 0 12.75 0S14 .56 14 1.25V12H15V2.75C15 2.06 15.56 1.5 16.25 1.5C16.94 1.5 17.5 2.06 17.5 2.75V12H18.5V5.75C18.5 5.06 19.06 4.5 19.75 4.5S21 5.06 21 5.75V16C21 20.42 17.42 24 13 24Z", "clock": "M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22C6.47,22 2,17.5 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z", "fire": "M17.66 11.2C17.43 10.9 17.15 10.64 16.89 10.38C16.22 9.78 15.46 9.35 14.82 8.72C13.33 7.26 13 4.85 13.95 3C13 3.23 12.17 3.75 11.46 4.32C8.87 6.4 7.85 10.07 9.07 13.22C9.11 13.32 9.15 13.42 9.15 13.55C9.15 13.77 9 13.97 8.8 14.05C8.57 14.15 8.33 14.09 8.14 13.93C8.08 13.88 8.04 13.83 8 13.76C6.87 12.33 6.69 10.28 7.45 8.64C5.78 10 4.87 12.3 5 14.47C5.06 14.97 5.12 15.47 5.29 15.97C5.43 16.57 5.7 17.17 6 17.7C7.08 19.43 8.95 20.67 10.96 20.92C13.1 21.19 15.39 20.8 17.03 19.32C18.86 17.66 19.5 15 18.56 12.72L18.43 12.46C18.22 12 17.66 11.2 17.66 11.2M14.5 17.5C14.22 17.74 13.76 18 13.4 18.1C12.28 18.5 11.16 17.94 10.5 17.28C11.69 17 12.4 16.12 12.61 15.23C12.78 14.43 12.46 13.77 12.33 13C12.21 12.26 12.23 11.63 12.5 10.94C12.69 11.32 12.89 11.7 13.13 12C13.9 13 15.11 13.44 15.37 14.8C15.41 14.94 15.43 15.08 15.43 15.23C15.46 16.05 15.1 16.95 14.5 17.5H14.5Z", "snow": "M20.79,13.95L18.46,14.57L16.46,13.44V10.56L18.46,9.43L20.79,10.05L21.31,8.12L19.54,7.65L20,5.88L18.07,5.36L17.45,7.69L15.45,8.82L13,7.38V5.12L14.71,3.41L13.29,2L12,3.29L10.71,2L9.29,3.41L11,5.12V7.38L8.5,8.82L6.5,7.69L5.92,5.36L4,5.88L4.47,7.65L2.7,8.12L3.22,10.05L5.55,9.43L7.55,10.56V13.45L5.55,14.58L3.22,13.96L2.7,15.89L4.47,16.36L4,18.12L5.93,18.64L6.55,16.31L8.55,15.18L11,16.62V18.88L9.29,20.59L10.71,22L12,20.71L13.29,22L14.7,20.59L13,18.88V16.62L15.5,15.17L17.5,16.3L18.12,18.63L20,18.12L19.53,16.35L21.3,15.88L20.79,13.95M9.5,10.56L12,9.11L14.5,10.56V13.44L12,14.89L9.5,13.44V10.56Z", "eye": "M12,9A3,3 0 0,1 15,12A3,3 0 0,1 12,15A3,3 0 0,1 9,12A3,3 0 0,1 12,9M12,4.5C17,4.5 21.27,7.61 23,12C21.27,16.39 17,19.5 12,19.5C7,19.5 2.73,16.39 1,12C2.73,7.61 7,4.5 12,4.5M3.18,12C4.83,15.36 8.24,17.5 12,17.5C15.76,17.5 19.17,15.36 20.82,12C19.17,8.64 15.76,6.5 12,6.5C8.24,6.5 4.83,8.64 3.18,12Z", "check": "M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z", "alert": "M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z", "mqtt": "M4.93,3.93C3.12,5.74 2,8.24 2,11C2,13.76 3.12,16.26 4.93,18.07L6.34,16.66C4.89,15.22 4,13.22 4,11C4,8.79 4.89,6.78 6.34,5.34L4.93,3.93M19.07,3.93L17.66,5.34C19.11,6.78 20,8.79 20,11C20,13.22 19.11,15.22 17.66,16.66L19.07,18.07C20.88,16.26 22,13.76 22,11C22,8.24 20.88,5.74 19.07,3.93M7.76,6.76C6.67,7.85 6,9.35 6,11C6,12.65 6.67,14.15 7.76,15.24L9.17,13.83C8.45,13.11 8,12.11 8,11C8,9.89 8.45,8.89 9.17,8.17L7.76,6.76M16.24,6.76L14.83,8.17C15.55,8.89 16,9.89 16,11C16,12.11 15.55,13.11 14.83,13.83L16.24,15.24C17.33,14.15 18,12.65 18,11C18,9.35 17.33,7.85 16.24,6.76M12,9A2,2 0 0,0 10,11A2,2 0 0,0 12,13A2,2 0 0,0 14,11A2,2 0 0,0 12,9M11,15V19H10A1,1 0 0,0 9,20H2V22H9A1,1 0 0,0 10,23H14A1,1 0 0,0 15,22H22V20H15A1,1 0 0,0 14,19H13V15H11Z", "map": "M12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5M12,2A7,7 0 0,0 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9A7,7 0 0,0 12,2Z", "download": "M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z", "tracker": "M18.5 13C16.6 13 15 14.61 15 16.5C15 19.11 18.5 23 18.5 23S22 19.11 22 16.5C22 14.61 20.4 13 18.5 13M18.5 17.81C17.8 17.81 17.3 17.21 17.3 16.61C17.3 15.91 17.9 15.41 18.5 15.41S19.7 16 19.7 16.61C19.8 17.21 19.2 17.81 18.5 17.81M15.91 23H7C5.9 23 5 22.11 5 21V3C5 1.89 5.89 1 7 1H17C18.1 1 19 1.89 19 3V11.03C18.84 11 18.67 11 18.5 11C18 11 17.5 11.08 17 11.22V5H7V19H13.54C14.14 20.5 15.12 21.97 15.91 23Z"};
function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;
}
// A running fan spins, like the Mushroom card-mod trick. Every step of 10 %
// fan speed turns it faster: 1-10 % a quarter turn per second, 91-100 %
// two and a half turns per second. Running without a known speed: half a turn.
function turnsPerSecond(step) {
  const n = Number(step);
  return Number.isFinite(n) && n > 0 ? Math.min(10, n) * 0.25 : 0.5;
}
// The fan icons stay the same elements between refreshes, so a fan keeps
// turning smoothly and only changes its speed (no jump back to the start).
const fans = new Map(); // HeatMeister prefix -> { el, anim }
function placeFans(hms) {
  const still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const seen = new Set();
  document.querySelectorAll('#hm-list [data-fan]').forEach((slot) => {
    const key = slot.dataset.fan;
    const h = hms.find((x) => x.prefix === key);
    if (!h) return;
    seen.add(key);
    let f = fans.get(key);
    if (!f) {
      f = { el: slot, anim: null };
      f.el.innerHTML = icon('fanOff');
      fans.set(key, f);
    } else {
      slot.replaceWith(f.el);
    }
    f.el.className = `shape ${h.running ? 'c-purple' : 'c-grey'}`;
    f.el.dataset.step = h.running ? String(h.fan_step || 0) : '';
    f.el.querySelector('path').setAttribute('d', ICONS[h.running ? 'fan' : 'fanOff']);
    const svg = f.el.querySelector('svg');
    if (h.running && !still && svg.animate) {
      if (!f.anim) f.anim = svg.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1000, iterations: Infinity });
      f.anim.updatePlaybackRate(turnsPerSecond(h.fan_step));
    } else if (f.anim) {
      f.anim.cancel();
      f.anim = null;
    }
  });
  for (const key of [...fans.keys()]) if (!seen.has(key)) fans.delete(key);
}
function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
}
// Colour and icon of the advice, per source.
const SOURCE_LOOK = {
  schedule: ['c-orange', 'fire'], preheat: ['c-orange', 'fire'], approaching: ['c-orange', 'coming'],
  hold: ['c-amber', 'hand'], away: ['c-blue', 'away'],
};
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const EVENT = { advice: 'Advice', sent: 'Sent', manual: 'Changed by hand', error: 'Error', 'hm-target': 'HeatMeister target' };
const SOURCE = { schedule: 'Schedule', away: 'Away', preheat: 'Preheat', approaching: 'On the way', hold: 'Manual hold', heatmeister: 'HeatMeister' };

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
  const [col, ico] = SOURCE_LOOK[a.source] || ['c-grey', 'thermostat'];
  $('adv-shape').className = `shape lg ${col}`;
  $('adv-shape').innerHTML = icon(ico);
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
  // Persons that do not count are not shown here (Settings › Presence).
  const chips = (p.people || []).filter((x) => x.counts).map((x) => {
    const chip = (cls, ico, text) => `<li class="${cls}"><span class="dot">${icon(ico)}</span>${esc(text)}</li>`;
    if (x.status === 'home') return chip('home', 'home', `${x.name} · home`);
    if (x.status === 'unknown') return chip('unknown', 'alert', `${x.name} · location unknown`);
    const w = way.get(x.entity_id);
    const extra = w ? ` · ${w.km.toFixed(1)} km${w.towards ? ', coming home' : ''}` : '';
    return chip(w && w.towards ? 'coming' : 'away', w && w.towards ? 'coming' : 'away', `${x.name} · ${zone(x.state)}${extra}`);
  });
  $('persons').innerHTML = chips.join('') || '<li>No persons chosen</li>';
  const notes = [];
  if (p.ignored) notes.push('Presence is not used: the schedule is always followed (Settings › Presence).');
  else if (p.noPersons) notes.push('No persons count: the schedule is followed as if someone is home.');
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
  const rt = s.roomTemperature || {};
  const ago = (ms) => { const m = Math.round((s.at - ms) / 60000); return m < 1 ? 'just now' : `${m} min ago`; };
  const what = rt.send === 'room' ? `room temperature (${rt.source === 'thermostat' ? 'from the thermostat' : esc(rt.source)})` : 'thermostat setpoint';
  const rtLine = !hms.length ? '' : rt.allowed
    ? `<p class="muted small">For the HeatMeisters: <b>${v(rt.value)}</b> · ${what}${rt.last && rt.last.error ? ` · <span style="color:rgb(var(--rgb-red))">sending failed: ${esc(rt.last.error)}</span>` : ''}</p>`
    : `<p class="muted small">For the HeatMeisters: <b>${v(rt.value)}</b> · ${what} · not sent by the app (option "Send temperature to HeatMeisters" is off).</p>`;
  const ht = s.heatmeisterTarget || {};
  const htLine = !hms.length ? '' : ht.allowed
    ? `<p class="muted small">Room target for the HeatMeisters: <b>${v(ht.value)}</b> · the thermostat's setpoint, set by the app</p>`
    : '';
  $('hm-list').innerHTML = hms.length
    ? `<p class="muted small">Thermostat asks for heat: <b>${s.demand ? 'yes' : 'no'}</b></p>` + rtLine + htLine + hms.map((h) => `
      <div class="hm">
        <span class="shape" data-fan="${esc(h.prefix)}"></span>
        <div class="txt"><div class="primary">${esc(h.name)} <span class="muted small">· ${esc(h.follows ? `slave of ${h.follows}` : !h.available ? 'unavailable' : h.control_state === 'slave' ? 'slave' : (h.control_state || 'no control state'))}</span></div>
          ${h.follows && h.inlet == null && h.room == null && h.fan_speed == null ? `<div class="secondary">No own values: this HeatMeister follows ${esc(h.follows)}${h.running ? ', which is running' : ''}.</div>` : ''}
          <div class="hmgrid${h.follows && h.inlet == null && h.room == null && h.fan_speed == null ? ' hidden' : ''}">
            <span>Radiator in <b>${v(h.inlet)}</b></span>
            <span>Out <b>${v(h.outlet)}</b></span>
            <span>Room <b>${v(h.room)}</b>${h.room_control ? ` · target ${v(h.room_target)}` : ''}</span>
            <span>Fan <b>${h.fan_speed == null ? '–' : `${h.fan_speed} %`}</b>${h.boost ? ' · boost' : ''}${h.manual ? ' · manual' : ''}</span>
            ${rt.allowed && h.sent ? `<span>Sent <b>${v(h.sent.value)}</b> · ${ago(h.sent.at)}</span>` : ''}
            ${ht.allowed && h.target_sent ? `<span>Target set <b>${v(h.target_sent.value)}</b> · ${ago(h.target_sent.at)}${h.target_sent.error ? ` · <span style="color:rgb(var(--rgb-red))">failed</span>` : ''}</span>` : ''}
          </div>
        </div>
        <span class="pill ${h.running ? 'change' : 'off'}">${h.running ? 'running' : 'off'}</span>
      </div>`).join('')
    : '<p class="muted small">No HeatMeisters shown. Choose them in <a href="#" data-goto="settings">Settings</a>.</p>';
  placeFans(hms);
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
  const chosen = new Map(s.heatmeisters.map((h) => [h.prefix, h]));
  // A slave not set up yet: suggest the first HeatMeister that is not a slave.
  const firstMaster = entities.heatmeisters.find((h) => h.control_state !== 'slave');
  $('s-hms').innerHTML = entities.heatmeisters.map((h) => {
    const c = chosen.get(h.prefix);
    const follows = c ? (c.follows || '') : (h.control_state === 'slave' && firstMaster ? firstMaster.prefix : '');
    const opts = `<option value="">– none (master or alone) –</option>` + entities.heatmeisters.filter((m) => m.prefix !== h.prefix)
      .map((m) => `<option value="${esc(m.prefix)}" ${m.prefix === follows ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    return `<tr data-prefix="${esc(h.prefix)}" data-name="${esc(h.name)}">
      <td><input type="checkbox" ${c ? 'checked' : ''} aria-label="Show ${esc(h.name)}"></td>
      <td><b>${esc(h.name)}</b><div class="muted small">${esc(h.prefix)}${h.control_state ? ` · ${esc(h.control_state)}` : ''}</div></td>
      <td><select data-f="follows" aria-label="Follows">${opts}</select></td>
      <td><input type="text" value="${esc(c ? c.topic : h.topic)}" maxlength="100" aria-label="MQTT topic"></td></tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">No HeatMeisters found (entities like sensor.heatbooster_…_temp_inlet).</td></tr>';
  $('s-room-source').innerHTML = `<option value="">The thermostat's room temperature</option>` + entities.temperatures.map((t) =>
    `<option value="${esc(t.entity_id)}" ${t.entity_id === s.room_temperature_source ? 'selected' : ''}>${esc(t.name)} (${esc(t.state)} °C)</option>`).join('');
  $('s-room-interval').value = s.room_temperature_interval_seconds;
  $('s-hm-send').value = s.heatmeister_send || 'room';
  $('s-room-source-label').classList.toggle('hidden', $('s-hm-send').value !== 'room');
  $('s-room-note').innerHTML = (status && status.roomTemperature && status.roomTemperature.allowed)
    ? 'The app sends this temperature to each ticked HeatMeister over MQTT (Home Assistant\'s MQTT integration): every few seconds (default 15, like the Node-RED flow), and right away when the thermostat setpoint or the value changes.'
    : 'Sending is <b>off</b>. Turn on "Send temperature to HeatMeisters" in the app\'s Configuration tab. With "setpoint" it does the same as the Node-RED flow; both sending at the same time does no harm.';
  $('s-needs-presence').checked = s.schedule_needs_presence !== false;
  $('s-hold').value = s.hold_default_minutes;
  $('s-manual').value = s.manual_change_until;
}
$('s-thermostat').addEventListener('change', thermostatNote);
$('s-hm-send').addEventListener('change', () => $('s-room-source-label').classList.toggle('hidden', $('s-hm-send').value !== 'room'));

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    thermostat: $('s-thermostat').value,
    persons: readPersons(),
    tracker_types: { gps: $('s-t-gps').checked, router: $('s-t-router').checked, bluetooth: $('s-t-bluetooth').checked },
    away_temp: Number($('s-away').value),
    away_delay_minutes: Number($('s-delay').value),
    coming_home_km: Number($('s-km').value),
    heatmeisters: [...document.querySelectorAll('#s-hms tr[data-prefix]')]
      .filter((tr) => tr.querySelector('input[type=checkbox]').checked)
      .map((tr) => ({ prefix: tr.dataset.prefix, name: tr.dataset.name, topic: tr.querySelector('input[type=text]').value.trim(), follows: tr.querySelector('[data-f=follows]').value })),
    schedule_needs_presence: $('s-needs-presence').checked,
    heatmeister_send: $('s-hm-send').value,
    room_temperature_source: $('s-room-source').value,
    room_temperature_interval_seconds: Number($('s-room-interval').value),
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
fillIcons();
(async () => {
  try { settings = await api('api/settings'); } catch (err) { showError(err.message); }
  await refreshStatus();
  // The app gets changes from Home Assistant right away; the page asks every 5 s.
  setInterval(() => { if (!document.hidden) refreshStatus(); }, 5000);
})();
