# Smart Heating Planner

A Home Assistant app that heats your house on a week schedule and on who is home, with a tado° thermostat and optional HeatMeister radiator fans.

> Status: early development. By default the app only **watches**: it shows what it *would* do. With **Allow control** on (Configuration tab) it sets the thermostat itself. The HeatMeisters run by themselves; the app shows what they do and can send them the thermostat's setpoint over MQTT. See [ROADMAP.md](ROADMAP.md).

## Installation

Choose **one** version before adding the repository:

| Version | Recommended for | Repository URL | Name in Home Assistant |
| --- | --- | --- | --- |
| **Stable (`main`)** | Most users | `https://github.com/tlpeter/smart-heating-planner` | **Smart Heating Planner** |
| **Test (`dev`)** | Testing the newest changes and reporting problems | `https://github.com/tlpeter/smart-heating-planner#dev` | **Smart Heating Planner (dev)** |

The test version may contain unfinished or less-tested changes. Its version number ends in `-dev`.

1. In Home Assistant, go to **Settings → Apps → App store**.
2. Open the menu (⋮) in the top right and choose **Repositories**.
3. Paste the repository URL for the version you chose and select **Add**.
4. Find the matching app name in the store and install it.
5. Start the app and open **Smart Heating** in the sidebar.
6. Go to **Settings** in the app: choose the thermostat, which persons count for "home" (and which trackers), and your HeatMeisters.

> [!WARNING]
> Install only one version. With control on in both, they would both set the same thermostat. Also turn off any other heating control (for example Node-RED) before you turn on **Allow control**.

## What it does

| Situation | What the app does |
| --- | --- |
| Someone is home | Follows the week schedule (for example 20 °C at 06:30, 18 °C at 08:30, 20.5 °C at 17:00). |
| Everybody leaves | Waits a few minutes (so a short trip does not count), then lowers to the away temperature. A lower schedule temperature (the night) is never raised. |
| Nobody home, switch point with **Preheat** | Heats anyway, so the house is warm when you come home. |
| Someone is coming home | Heats by the schedule again when that person is within a set distance and getting closer (GPS from the Companion App; per person on or off). |
| You want it warmer for a while | **Manual hold** on the Home page: a temperature for 1, 2 or 4 hours, or until the next switch point. Ends by itself. |
| Someone turns the tado up or down | With control on, the app keeps that temperature until the next switch point, instead of overwriting it. |
| HeatMeisters | Found automatically. The Home page shows per HeatMeister whether it runs (the fan icon turns faster per 10 % fan speed), the radiator and room temperature and the fan speed; changes show within a few seconds. Optionally the app sends them the thermostat's setpoint, or a room temperature (MQTT, `<Name>/temp-ambient-ext`). |

The schedule only counts when someone is home; this is an option (Settings › Presence). Per person you choose whether they count for "home" and whether "coming home" applies, and for everyone which kinds of tracker count (GPS/zones, router, Bluetooth). A person with an unknown location counts as home: better warm than cold.

The app looks like Home Assistant with Mushroom cards and follows light and dark mode. It has four pages: **Home** (advice now, who is home, schedule, manual hold, HeatMeisters), **Schedule** (the week), **Activity** (every change in the advice, with the reason) and **Settings**.

The full explanation of every option is in [DOCS.md](smart_heating_planner/DOCS.md) (also the **Documentation** tab of the app in Home Assistant).

## tado° and the daily limit

tado limits its cloud API: without an Auto-Assist subscription only **100 requests per day**. The app therefore prefers a **local HomeKit** thermostat (the HomeKit Device integration) and marks cloud thermostats (tado, Tado CE) with a warning. With control on, the app writes only when the target really changes, at least 2 minutes apart, and never more than a set number of times per 24 hours.

## What you need

- Home Assistant with the app store (Home Assistant OS or Supervised).
- A thermostat as a `climate` entity, preferably tado° through HomeKit.
- The Home Assistant Companion App on the phones, with location, and a `person` per resident.
- Optional: HeatMeisters through MQTT (SDR Engineering), and Home Assistant's MQTT integration to send them the temperature.

## Problems and ideas

- A bug: open an [issue](https://github.com/tlpeter/smart-heating-planner/issues/new/choose) and attach the diagnostics file (**Settings → Download diagnostics**; names and places are removed).
- A security problem: see [SECURITY.md](SECURITY.md); please do not report it in public.

## For developers

See [AGENTS.md](AGENTS.md) for the rules, branches, versions and tests, and [tests/TESTPLAN.md](tests/TESTPLAN.md) for the result of the last test run.
