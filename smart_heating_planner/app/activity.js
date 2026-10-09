'use strict';

// The activity log: every time the advice changes, one line. Kept in
// /data/activity.json (the last 500 lines).

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const { DATA_DIR } = require('./options');

const FILE = path.join(DATA_DIR, 'activity.json');
const MAX = 500;
let lines = null;

function all() {
  if (!lines) {
    const saved = readJson(FILE, []);
    lines = Array.isArray(saved) ? saved : [];
  }
  return lines;
}

function add(entry, now = Date.now()) {
  const list = all();
  list.push({ at: now, ...entry });
  while (list.length > MAX) list.shift();
  writeJsonAtomic(FILE, list);
}

function recent(n = 100) {
  return all().slice(-n).reverse();
}

module.exports = { add, recent };
