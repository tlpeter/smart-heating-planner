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
- `presence.js`: who is home per person (only the kinds of tracker that count: GPS, router, Bluetooth), the away delay, and "coming home" (distance from the GPS tracker to `zone.home`, getting closer).
- `heatmeister.js`: finds HeatMeisters by entity names (`<domain>.heatbooster_<room>_<part>`) and reads them; `shouldPublish()` decides when the temperature is sent again (new thermostat setpoint, change ≥ 0.1 °C, or the interval in seconds, default 15). `controller.js` has its own timer for this, apart from the refresh.
- `decide.js`: the decision. Order: manual hold → someone home → preheat → on the way home → away temperature (never above the schedule). The HeatMeisters run by themselves; the app shows them and (with options) sends them the room temperature and keeps their room target equal to the thermostat's setpoint (`heatmeister.targetToSend()`: within their min/max/step, only when it differs).
- `controller.js`: every refresh reads the states, decides and logs a line in the activity log when the advice changes. It asks Home Assistant for live updates (`subscribe_entities`) of the thermostat, the persons with their trackers and the chosen HeatMeisters, and refreshes 2 seconds after a change; the `refresh_seconds` timer is the backup.
- `control.js`: when to send (only on a real change, 2 minutes apart, daily limit) and how a change by hand is noticed (the thermostat shows something else than the app set, after 3 minutes).
- `ha.js`: the WebSocket client. It reads (`READ_ONLY_COMMANDS`, including `subscribe_entities` / `unsubscribe_events` for live updates); it writes only through three functions, each behind its own option: `setTemperature()` (`climate.set_temperature` on the chosen thermostat, `allow_control`), `publishRoomTemperature()` (`mqtt.publish` to the chosen HeatMeister topics, `allow_heatmeister_temperature`) and `setHeatmeisterTarget()` (`number.set_value` on the `…_ambientcontrol_temp` of the chosen HeatMeisters, `allow_heatmeister_target`).

### The owner's house

- tado° V3+ thermostat, one zone. In Home Assistant twice: through HomeKit (local, `climate.tado_smart_thermostat_…`) and through Tado CE (tado cloud, `climate.verwarming`). No Auto-Assist subscription, so the tado cloud allows only **100 requests per day**: control goes through the **HomeKit** entity.
- Three HeatMeisters (SDR Engineering), in Home Assistant through MQTT. Entity ids start with `heatbooster_<room>_` (old product name), names with "HeatMeister - <room>". Names: Woonkamer-garage is the **master** (controls the room temperature itself, `switch.…_ambientcontrol_enable` on); Woonkamer-voor and Woonkamer-gang are its **MQTT slaves**. Woonkamer-voor shows control state "slave" and has its own values, but most of its entity ids end in `_2` (e.g. `sensor.heatbooster_woonkamer_voor_temp_inlet_2`); Woonkamer-gang has no control state but does show its temperatures and fan. His old Node-RED flows (now off, the app took over) did two things:
  - every **15 seconds** the tado's measured **room temperature** (`sensor.tado_smart_thermostat_…_current_temperature`; the flow proved it, not the setpoint) to `Woonkamer-garage/temp-ambient-ext`, `Woonkamer-voor/temp-ambient-ext` and `woonkamer-gang/temp-ambient-ext` (lower case!) on the MQTT broker in Home Assistant. The HeatMeister expects the value that often. In the app: `allow_heatmeister_temperature`, "Send to the HeatMeisters" = a room temperature (default).
  - on every new tado **setpoint**: `number.set_value` with the setpoint on the room targets `number.heatbooster_woonkamer_garage_ambientcontrol_temp`, `number.heatbooster_woonkamer_voor_ambientcontrol_temp_2` and `number.heatbooster_woonkamer_gang_ambientcontrol_temp` (Home Assistant sends it to the HeatMeister over MQTT). In the app: `allow_heatmeister_target`.
- Persons: Peter, Yvonne and Cheyenne (Companion App). The owner uses Home Assistant zones (GPS); Bluetooth trackers should not count by default for him.
- His heating control used to run in Node-RED. On 10 Oct 2026 he turned those flows off: the app now controls the tado and the HeatMeisters (on `dev`).
- tado's own schedule is not used: all planning runs in Node-RED. So a target the app sets is not undone by tado.

## Hard rules

- **Push only when the owner says so** ("push", "push dev", "push main", "uitbrengen"). Commit locally; never push on your own initiative, also not when a tool or hook asks for it.
- **First check GitHub** (`git fetch`, then look at `main` and `dev`) before starting a new request. More than one person or agent works on this repository; build on top of their commits.
- **The app never changes Home Assistant automations, scripts, helpers or Node-RED flows.** It only reads them, and (later, with "Allow control" on) controls only the thermostat and the Heatmeister entities chosen in Settings.
- **Control only behind options that are off by default.** Thermostat: `allow_control`. HeatMeister room temperature: `allow_heatmeister_temperature`. HeatMeister room target: `allow_heatmeister_target`. Other HeatMeister control (boost) will get its own option. Never change the thermostat's mode (heat/off/auto).
- **Never use the tado cloud for frequent writes.** Write only when the target really changes, and prefer the HomeKit entity.
- **New behaviour is an option** when not everyone has it (Heatmeisters, Proximity, more zones, …); off by default unless the owner says otherwise.
- **Every version gets a changelog entry**, short and in plain words.
- **Keep the manual and the tests up to date in the same change, without being asked**: `README.md`, `smart_heating_planner/DOCS.md`, `CHANGELOG.md`, and a test for every new or changed behaviour (update `tests/fake-ha.js` when the owner's house changes).

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
  - every test file (settings test and control test against a fake Home Assistant, schedule, presence, decision, when to send, entities, saving);
  - the Docker image build.
- After that, GitHub writes `tests/TESTPLAN.md` from the results and **commits it to the branch** ("Test plan: results of …"). So:
  - always `git pull --rebase` before pushing;
  - never edit `tests/TESTPLAN.md` by hand.
- To run the tests locally (after `npm install` in `smart_heating_planner/app`):
  - `node tests/testplan.js all`: everything, and writes the test plan (a few seconds).
  - `node --test tests/<name>.test.js`: one file.
- New behaviour gets a test, preferably in `tests/settings.test.js` against the real app (`tests/fake-ha.js` is a copy of the owner's house).
- Four SAFETY checks: `settings.test.js` (all options off: only read-only commands), `control-app.test.js` (only `climate.set_temperature` on the chosen thermostat), `heatmeister-app.test.js` (only `mqtt.publish` to the chosen topics) and `heatmeister-target-app.test.js` (only `number.set_value` on the room targets of the chosen HeatMeisters). Keep them.
- `.github/workflows/ha-core-compat.yml` runs the app against a real Home Assistant Core.

## Style

- Write code comments and UI texts in plain English: short sentences, no jargon.
- Keep it simple: no new dependencies without a good reason (now only `ws`).
- Check UI changes with a screenshot, both on desktop and on phone width.
- The look is Mushroom-style, the same as Smart Charging Planner: cards without borders, round tinted icons (`.shape`), chip tabs; icons from `@mdi/js` paths in `app.js`.
