'use strict';

// Options from the app's Configuration tab in Home Assistant.
// The Supervisor writes them to /data/options.json; changing them restarts the app.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DEFAULTS = {
  log_level: 'info',
  refresh_seconds: 30,
  allow_control: false,
  allow_heatmeister_temperature: false,
  allow_heatmeister_target: false,
  max_writes_per_day: 48,
};

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'options.json'), 'utf8'));
    const merged = { ...DEFAULTS, ...raw };
    const n = Math.round(Number(merged.refresh_seconds));
    merged.refresh_seconds = n >= 10 && n <= 600 ? n : DEFAULTS.refresh_seconds;
    merged.allow_control = merged.allow_control === true;
    merged.allow_heatmeister_temperature = merged.allow_heatmeister_temperature === true;
    merged.allow_heatmeister_target = merged.allow_heatmeister_target === true;
    const w = Math.round(Number(merged.max_writes_per_day));
    merged.max_writes_per_day = w >= 1 && w <= 500 ? w : DEFAULTS.max_writes_per_day;
    if (!['debug', 'info', 'warning', 'error'].includes(merged.log_level)) merged.log_level = DEFAULTS.log_level;
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

module.exports = { options: load(), DATA_DIR };
