'use strict';

// Runs the tests and writes tests/TESTPLAN.md from the results.
//
//   node tests/testplan.js all                run everything and write the plan
//   node tests/testplan.js run <file> <dir>   run one test file, save its result in <dir>
//   node tests/testplan.js write <dir>        write the plan from saved results
//
// GitHub runs this after every push and commits TESTPLAN.md to the branch.
// Never edit TESTPLAN.md by hand.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PLAN = path.join(__dirname, 'TESTPLAN.md');
const VERSION = require(path.join(ROOT, 'smart_heating_planner', 'app', 'package.json')).version;

// The test files, in the order of the plan, with what they cover.
const FILES = [
  ['settings.test.js', 'Settings and situations', 'The real app ("Allow control" off) against a fake Home Assistant (tado over HomeKit and Tado CE, Peter, Yvonne and Cheyenne with GPS, router and Bluetooth trackers, three HeatMeisters over MQTT). Everything goes through the same API as the page.'],
  ['control-app.test.js', 'Control (Allow control on)', 'The real app with "Allow control" on: sets the HomeKit thermostat only when the advice changes, keeps a change made by hand, waits between writes, respects the daily limit and survives a failing thermostat.'],
  ['schedule.test.js', 'Week schedule', 'Which switch point is valid when, across midnight, the week and daylight saving time; checks on the schedule.'],
  ['presence.test.js', 'Presence', 'Who is home per person and per kind of tracker (GPS, router, Bluetooth), unknown locations, the away delay, and "coming home" from the GPS position.'],
  ['decide.test.js', 'Decision', 'Which temperature and why.'],
  ['control.test.js', 'When to send', 'The rules for writing to the thermostat and for noticing a change by hand.'],
  ['heatmeister.test.js', 'HeatMeisters', 'Finding the HeatMeisters by their entity names (heatbooster_… and heatmeister_…) and reading what they do.'],
  ['entities.test.js', 'Finding entities', 'HomeKit thermostat first, tado cloud marked, persons with their trackers, HeatMeisters offered.'],
  ['persistence.test.js', 'Saving', 'Settings, hold and activity survive a restart; files are written safely.'],
];

// Run one file with the TAP reporter and collect the results.
function runFile(file) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(__dirname, file)], { cwd: ROOT, encoding: 'utf8', timeout: 10 * 60000 });
  const out = `${r.stdout || ''}`;
  const tests = [];
  for (const line of out.split('\n')) {
    // Top-level results only: "ok 3 - name" / "not ok 3 - name".
    const m = /^(not ok|ok) \d+ - (.*)$/.exec(line);
    if (m) tests.push({ name: m[2].replace(/ # .*$/, ''), passed: m[1] === 'ok' });
  }
  const count = (key) => Number((new RegExp(`^# ${key} (\\d+)`, 'm').exec(out) || [])[1] || 0);
  return { file, pass: count('pass'), fail: count('fail'), tests, exitCode: r.status };
}

function writePlan(results) {
  const lines = [];
  lines.push('# Test plan', '');
  lines.push('This file is written by `tests/testplan.js` from the results of the last test run. GitHub runs every test after each push and updates this file, so it always matches the code. Run it yourself with `node tests/testplan.js all` (a few seconds).', '');
  lines.push('A separate check (`.github/workflows/ha-core-compat.yml`) runs the app against a real Home Assistant Core.', '');
  lines.push('## Summary', '', '| Test | Passed |', '|---|---|');
  for (const [file, title] of FILES) {
    const r = results[file];
    if (!r) { lines.push(`| ${title} | not run |`); continue; }
    const total = r.pass + r.fail;
    lines.push(`| ${title} | ${r.pass} of ${total} ${r.fail ? '✗' : '✓'} |`);
  }
  lines.push('', `Version: ${VERSION}.`, '');
  for (const [file, title, about] of FILES) {
    const r = results[file];
    lines.push(`## ${title}`, '', about, '', `\`node tests/${file}\``, '');
    if (!r) { lines.push('Not run.', ''); continue; }
    for (const t of r.tests) lines.push(`- ${t.passed ? '✓' : '✗'} ${t.name}`);
    lines.push('');
  }
  fs.writeFileSync(PLAN, lines.join('\n'));
}

function loadResults(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (r && r.file) out[r.file] = r;
    } catch { /* skip broken result */ }
  }
  return out;
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'all') {
  const results = {};
  let failed = 0;
  for (const [file] of FILES) {
    const r = runFile(file);
    results[file] = r;
    failed += r.fail + (r.exitCode && !r.fail ? 1 : 0);
    console.log(`${r.fail || r.exitCode ? '✗' : '✓'} ${file}: ${r.pass} passed, ${r.fail} failed`);
  }
  writePlan(results);
  process.exit(failed ? 1 : 0);
} else if (cmd === 'run' && a && b) {
  const r = runFile(a);
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, `${a.replace(/\W+/g, '_')}.json`), JSON.stringify(r));
  console.log(`${r.fail || r.exitCode ? '✗' : '✓'} ${a}: ${r.pass} passed, ${r.fail} failed`);
  process.exit(r.fail || r.exitCode ? 1 : 0);
} else if (cmd === 'write' && a) {
  writePlan(loadResults(a));
} else {
  console.log('Use: node tests/testplan.js all | run <file> <dir> | write <dir>');
  process.exit(2);
}
