# Changelog

## 0.5.0

- First stable version. Everything below, from 0.1.0 up to 0.4.11, is in it. Every option that controls something (thermostat, HeatMeister temperature, HeatMeister room target) is **off** by default: turn on what you want in the Configuration tab.

## 0.4.11

- Chart: up to **6** extra temperature sensors (was 3). Click a name above the chart to show or hide that line; your browser remembers it. Of new sensors the first 3 are shown.

## 0.4.10

- Chart: the value of now is always at the right edge, also when Home Assistant has not written it to its history yet.

## 0.4.9

- **Chart on Home**: the last 24 hours of the thermostat's room temperature and setpoint. In Settings › **Chart on Home** you can add up to 3 temperature sensors (for example per room, or a HeatMeister's own room temperature). Hover or touch for the values; **Show as table** for the values per hour. The data comes from Home Assistant's own history.

## 0.4.8

- Test version: new options are **on** by default, so you can try them right away. **Set HeatMeister room target** is now on by default on the test version. The stable version keeps every control option off by default.

## 0.4.7

- New option **Set HeatMeister room target** (Configuration tab, off by default): the room target of the chosen HeatMeisters (`number.…_ambientcontrol_temp`) follows the thermostat's setpoint, like the Node-RED flow did. Within the HeatMeister's limits, only when it differs; Home and Activity show it.
- **Send to the HeatMeisters** now sends **a room temperature** by default (the thermostat's own), like the Node-RED flow really did. Already saved settings keep their choice.

## 0.4.6

- Faster: Home Assistant now tells the app right away when the thermostat, a person or a HeatMeister changes (before, the app looked every 30 seconds). The page updates every 5 seconds (was 15). A fan change shows within a few seconds.
- HeatMeisters: the fan icon turns one step faster for every 10 % fan speed, and keeps turning smoothly when the page updates (before, it jumped back to the start).

## 0.4.5

- HeatMeisters: the fan icon spins while the fan runs, faster at a higher fan speed (like the Mushroom card-mod animation). No animation when your device asks for less motion.

## 0.4.4

- HeatMeisters: entity ids that end in `_2`, `_3`, … (Home Assistant adds that when an id existed before) are now found. Woonkamer-voor showed no values because of this.

## 0.4.3

- HeatMeisters: the temperature is now sent **every 15 seconds** with its own timer, like the Node-RED flow (the HeatMeister expects it that often). The setting **Send it every** is now in seconds (5–600). Still also right away on a new setpoint.

## 0.4.2

- Home › Who is home only shows the persons who count for home; the others (for example admin or tablet users) are hidden.
- HeatMeisters: "running" now comes from the fan status and fan speed. A HeatMeister in "slave" mode with its fan at 0 % was wrongly shown as running.
- HeatMeisters: new setting **Follows (MQTT slave of)** per HeatMeister. Home shows "slave of Woonkamer-garage"; a slave without values of its own shows as running when its master runs.

## 0.4.1

- The HeatMeisters now get the thermostat's **setpoint** by default, like the Node-RED flow (0.4.0-dev sent the measured room temperature). New setting **Send to the HeatMeisters**: the setpoint, or a room temperature (the thermostat's or another sensor).
- The option in the Configuration tab is now called **Send temperature to HeatMeisters**.

## 0.4.0

- **Room temperature for the HeatMeisters**, like the Node-RED flow: new option **Send room temperature to HeatMeisters** (Configuration tab, off by default). The app sends the thermostat's room temperature (or another sensor) to `<Name>/temp-ambient-ext` over MQTT, right away when the thermostat's setpoint changes (like the Node-RED flow), when the room temperature changes by 0.1 °C, and at least every 5 minutes. Per HeatMeister you can change the topic (they are case-sensitive).
- New setting **The schedule only counts when someone is home** (on by default). Off: the schedule is always followed.
- New look in the style of Home Assistant and Mushroom cards, the same as Smart Charging Planner: chip tabs with icons, round tinted icons, softer cards, tiles for the thermostat values. Light and dark mode follow your device.
- Home shows per person an icon (home, away, coming home) and per HeatMeister a fan icon that shows whether it runs, and what room temperature it got.

## 0.3.0

- Radiator icon and logo for the app store, and a radiator in the page header.
- **Presence per person**: per person *Counts for home* and *Coming home*, and their trackers with kind and state.
- **Which trackers count**: GPS (Companion App, zones), router / network and Bluetooth can each be turned on or off.
- **Coming home** now works without the Proximity integration: the app uses the GPS position and the Home zone, and checks that the person is getting closer. The Proximity sensor settings are gone; the distance is kept.
- **HeatMeisters** are found automatically by their entity names (also the old `heatbooster_` names). Home shows per HeatMeister: running or off, control state, radiator in/out, room temperature (and room target) and fan speed. The old "would run" advice and its settings are gone: the HeatMeisters run by themselves.
- Diagnostics leave out tracker ids and zone names.

## 0.2.0

- **Allow control** (Configuration tab, off by default): the app sets the thermostat's target temperature itself when the advice changes. Only `climate.set_temperature`, only on the thermostat chosen in Settings.
- Writes only when the target really changes, at least 2 minutes apart, and never more than **Most changes per 24 hours** (default 48; keep it about 20 for a tado cloud thermostat).
- A change on the thermostat itself or in the tado app is noticed and kept, until the next switch point or for the default hold length (new setting).
- Activity shows what was sent, changes by hand and errors. The Home page shows the last command and how many changes were made in 24 hours.

## 0.1.0

- First version, **watch only**: the app shows what it would do and sends nothing.
- Week schedule with switch points (time, temperature, preheat).
- Presence from person entities (Companion App), with a wait before lowering and optional "on the way home" (Proximity).
- Manual hold for 1, 2 or 4 hours, or until the next switch point.
- Heatmeister advice from heat demand and/or radiator temperature.
- Thermostat choice that prefers local HomeKit and warns about the tado cloud limit.
- Activity log and diagnostics download.
