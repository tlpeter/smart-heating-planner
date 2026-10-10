# Roadmap

The app is built in phases. Each phase is tested on `dev` first and released to `main` when the owner says so. The Node-RED heating flow ran until phase 6.

| Phase | What | Status |
| --- | --- | --- |
| 1 | Repository: `main` and `dev`, tests on every push, security, documentation, `AGENTS.md`/`CLAUDE.md` | done (0.1.0) |
| 2 | **Watch only**: status, who is home, schedule, manual hold and the advice; the activity log. Nothing is sent. | done (0.1.0) |
| 3 | **Control the thermostat** behind "Allow control" (off by default): set the target on the HomeKit entity, only when it changes. Detect a change made on the thermostat itself and keep it as a temporary hold. | done (0.2.0-dev, on `dev`) |
| 3b | Presence per person (counts, coming home from GPS, which trackers count), HeatMeisters found automatically and shown, radiator icon. | done (0.3.0-dev, on `dev`) |
| 3c | Temperature (setpoint, or a room temperature) to the HeatMeisters over MQTT (replaces that part of the Node-RED flow), option "schedule only when someone is home", Mushroom look. | done (0.4.1-dev, on `dev`) |
| 4 | Preheat improvements: start earlier so the room is warm *at* the switch time (learn how fast the house warms up). | later |
| 4b | **Chart on Home**: the last 24 hours of the living room temperature and the tado setpoint, in one chart. The data comes from Home Assistant's own history (`history/history_during_period`, only reading), so the app stores nothing extra. Chosen by the owner: the tado's room temperature by default, plus up to 3 temperature sensors ticked in Settings (for example one per room, or a HeatMeister's own room temperature), each its own line. Maybe later: a strip with who was home / heat demand. | done (0.4.9-dev, on `dev`) |
| 5a | **HeatMeister room target** follows the thermostat setpoint (`number.…_ambientcontrol_temp`, option "Set HeatMeister room target"), like the Node-RED flow. | done (0.4.7-dev, on `dev`) |
| 5 | **More HeatMeister control** behind its own option, for example boost while preheating. | later |
| 6 | Turn off the Node-RED flow; the app takes over. Optional: publish sensors (`sensor.smart_heating_*`) for dashboards. | in test: the owner turned the Node-RED flows off on 10 Oct 2026 (0.4.7-dev) |

Ideas, not planned yet: window-open detection (fast temperature drop), more zones, weather forecast.
