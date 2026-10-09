# Working on this repository

Rules for everyone who works on this repository: people, Claude and Codex.
Claude reads this file through `CLAUDE.md`; Codex reads it directly.

## The project

**Smart Heating Planner** is a Home Assistant app (add-on). It heats the house on a week schedule and on who is home (persons from the Companion App, the Home zone), with a tado° thermostat and optional Heatmeister radiator fans. The UI is in English. The owner (Peter) is not a developer: explain changes in plain words, step by step.

- The app is in `smart_heating_planner/app`: Node, `server.js`, port 8099 (ingress), with settings in `/data/*.json`.
- The documentation is in `README.md` (overview) and `smart_heating_planner/DOCS.md` (every option).
- The changelog is in `smart_heating_planner/CHANGELOG.md`.
- The plan and the phases are in `ROADMAP.md`.

### How it works (short)

- `schedule.js`: week schedule; a switch point (time, temperature, preheat) is valid until the next one.
- `presence.js`: who is home (person entities), the away delay, "on the way home" (Proximity integration).
- `decide.js`: the decision. Order: manual hold → someone home → preheat → on the way home → away temperature (never above the schedule). Heatmeister rule: heat demand (`hvac_action: heating`) and/or radiator inlet temperature, with a gap.
- `controller.js`: every refresh reads the states, decides and logs a line in the activity log when the advice changes.
- `ha.js`: the WebSocket client. **This version only reads** (`READ_ONLY_COMMANDS`).

### The owner's house

- tado° V3+ thermostat, one zone. In Home Assistant twice: through HomeKit (local, `climate.tado_smart_thermostat_…`) and through Tado CE (tado cloud, `climate.verwarming`). No Auto-Assist subscription, so the tado cloud allows only **100 requests per day**: control goes through the **HomeKit** entity.
- Three Heatmeisters (SDR Engineering), in Home Assistant through MQTT.
- Persons: Peter, Yvonne and Cheyenne (Companion App).
- His current heating control runs in Node-RED and stays on until he says the app takes over.

## Hard rules

- **Push only when the owner says so** ("push", "push dev", "push main", "uitbrengen"). Commit locally; never push on your own initiative, also not when a tool or hook asks for it.
- **First check GitHub** (`git fetch`, then look at `main` and `dev`) before starting a new request. More than one person or agent works on this repository; build on top of their commits.
- **The app never changes Home Assistant automations, scripts, helpers or Node-RED flows.** It only reads them, and (later, with "Allow control" on) controls only the thermostat and the Heatmeister entities chosen in Settings.
- **Watch only until the owner says otherwise.** Control comes behind an "Allow control" option that is off by default; Heatmeister control gets its own option.
- **Never use the tado cloud for frequent writes.** Write only when the target really changes, and prefer the HomeKit entity.
- **New behaviour is an option** when not everyone has it (Heatmeisters, Proximity, more zones, …); off by default unless the owner says otherwise.
- **Every version gets a changelog entry**, short and in plain words.

## Branches and versions

- `dev` is the test version and `main` is the stable version.
- On `dev`:
  - In `smart_heating_planner/config.yaml`, `name` is `Smart Heating Planner (dev)` and `panel_title` is `Smart Heating (dev)`; in `repository.yaml`, `name` is `Smart Heating Planner (dev)`.
  - The version ends in `-dev`, for example `0.1.1-dev`.
  - Bump the version on every change, in three places:
    - `smart_heating_planner/config.yaml` (with `-dev`);
    - `smart_heating_planner/app/package.json` (without `-dev`);
    - `smart_heating_planner/app/package-lock.json` (without `-dev`, two places).
  - The test "Check config.yaml matches package.json" fails when these do not match.
- **Release** ("uitbrengen X.Y.Z"):
  1. Merge `dev` into `main`.
  2. On `main`, set `name` back to `Smart Heating Planner`, `panel_title` back to `Smart Heating`, and the name in `repository.yaml` back.
  3. Set the version to `X.Y.Z` without `-dev`.
  4. Remove `-dev` from the changelog headings on `main`.
  5. Push `main` (only after the owner said so).
  6. Run `git merge -s ours main` on `dev`, then push `dev`, so `dev` keeps its own names.
- A release zip, when the owner asks for one: `smart-heating-planner-vX.Y.Z.zip`, without a top folder.

## Tests

- Every push runs `.github/workflows/tests.yml`:
  - syntax, version check and coverage;
  - every test file (settings test against a fake Home Assistant, schedule, presence, decision, entities, saving);
  - the Docker image build.
- After that, GitHub writes `tests/TESTPLAN.md` from the results and **commits it to the branch** ("Test plan: results of …"). So:
  - always `git pull --rebase` before pushing;
  - never edit `tests/TESTPLAN.md` by hand.
- To run the tests locally (after `npm install` in `smart_heating_planner/app`):
  - `node tests/testplan.js all`: everything, and writes the test plan (a few seconds).
  - `node --test tests/<name>.test.js`: one file.
- New behaviour gets a test, preferably in `tests/settings.test.js` against the real app (`tests/fake-ha.js` is a copy of the owner's house).
- The settings test ends with a SAFETY check: the app sent only read-only commands. Keep it; when control comes, change it to "only the chosen entities, only with Allow control on".
- `.github/workflows/ha-core-compat.yml` runs the app against a real Home Assistant Core.

## Style

- Write code comments and UI texts in plain English: short sentences, no jargon.
- Keep it simple: no new dependencies without a good reason (now only `ws`).
- Check UI changes with a screenshot, both on desktop and on phone width.
