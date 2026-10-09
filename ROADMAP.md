# Roadmap

The app is built in phases. Each phase is tested on `dev` first and released to `main` when the owner says so. The current Node-RED heating flow keeps running until phase 6.

| Phase | What | Status |
| --- | --- | --- |
| 1 | Repository: `main` and `dev`, tests on every push, security, documentation, `AGENTS.md`/`CLAUDE.md` | done (0.1.0) |
| 2 | **Watch only**: status, who is home, schedule, manual hold and the advice; the activity log. Nothing is sent. | done (0.1.0) |
| 3 | **Control the thermostat** behind "Allow control" (off by default): set the target on the HomeKit entity, only when it changes. Detect a change made on the thermostat itself and keep it as a temporary hold. | next |
| 4 | Preheat improvements: start earlier so the room is warm *at* the switch time (learn how fast the house warms up). | later |
| 5 | **Control the Heatmeisters** behind its own option: on/off or fan speed through the MQTT entities. | later |
| 6 | Turn off the Node-RED flow; the app takes over. Optional: publish sensors (`sensor.smart_heating_*`) for dashboards. | when the owner says so |

Ideas, not planned yet: window-open detection (fast temperature drop), more zones, weather forecast.
