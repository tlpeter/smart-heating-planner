# Changelog

## 0.4.0-dev

- **Room temperature for the HeatMeisters**, like the Node-RED flow: new option **Send room temperature to HeatMeisters** (Configuration tab, off by default). The app sends the thermostat's room temperature (or another sensor) to `<Name>/temp-ambient-ext` over MQTT, right away when the thermostat's setpoint changes (like the Node-RED flow), when the room temperature changes by 0.1 °C, and at least every 5 minutes. Per HeatMeister you can change the topic (they are case-sensitive).
- New setting **The schedule only counts when someone is home** (on by default). Off: the schedule is always followed.
- New look in the style of Home Assistant and Mushroom cards, the same as Smart Charging Planner: chip tabs with icons, round tinted icons, softer cards, tiles for the thermostat values. Light and dark mode follow your device.
- Home shows per person an icon (home, away, coming home) and per HeatMeister a fan icon that shows whether it runs, and what room temperature it got.

## 0.3.0-dev

- Radiator icon and logo for the app store, and a radiator in the page header.
- **Presence per person**: per person *Counts for home* and *Coming home*, and their trackers with kind and state.
- **Which trackers count**: GPS (Companion App, zones), router / network and Bluetooth can each be turned on or off.
- **Coming home** now works without the Proximity integration: the app uses the GPS position and the Home zone, and checks that the person is getting closer. The Proximity sensor settings are gone; the distance is kept.
- **HeatMeisters** are found automatically by their entity names (also the old `heatbooster_` names). Home shows per HeatMeister: running or off, control state, radiator in/out, room temperature (and room target) and fan speed. The old "would run" advice and its settings are gone: the HeatMeisters run by themselves.
- Diagnostics leave out tracker ids and zone names.

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
