# Changelog

## 0.2.0-dev

- **Allow control** (Configuration tab, off by default): the app sets the thermostat's target temperature itself when the advice changes. Only `climate.set_temperature`, only on the thermostat chosen in Settings.
- Writes only when the target really changes, at least 2 minutes apart, and never more than **Most changes per 24 hours** (default 48; keep it about 20 for a tado cloud thermostat).
- A change on the thermostat itself or in the tado app is noticed and kept, until the next switch point or for the default hold length (new setting).
- Activity shows what was sent, changes by hand and errors. The Home page shows the last command and how many changes were made in 24 hours.

## 0.1.0-dev

- First version, **watch only**: the app shows what it would do and sends nothing.
- Week schedule with switch points (time, temperature, preheat).
- Presence from person entities (Companion App), with a wait before lowering and optional "on the way home" (Proximity).
- Manual hold for 1, 2 or 4 hours, or until the next switch point.
- Heatmeister advice from heat demand and/or radiator temperature.
- Thermostat choice that prefers local HomeKit and warns about the tado cloud limit.
- Activity log and diagnostics download.
