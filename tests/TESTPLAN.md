# Test plan

This file is written by `tests/testplan.js` from the results of the last test run. GitHub runs every test after each push and updates this file, so it always matches the code. Run it yourself with `node tests/testplan.js all` (a few seconds).

A separate check (`.github/workflows/ha-core-compat.yml`) runs the app against a real Home Assistant Core.

## Summary

| Test | Passed |
|---|---|
| Settings and situations | 22 of 22 ✓ |
| Control (Allow control on) | 10 of 10 ✓ |
| HeatMeister room temperature (MQTT on) | 8 of 8 ✓ |
| Week schedule | 10 of 10 ✓ |
| Presence | 13 of 13 ✓ |
| Decision | 10 of 10 ✓ |
| When to send | 8 of 8 ✓ |
| HeatMeisters | 9 of 9 ✓ |
| Finding entities | 3 of 3 ✓ |
| Saving | 5 of 5 ✓ |

Version: 0.4.0.

## Settings and situations

The real app ("Allow control" off) against a fake Home Assistant (tado over HomeKit and Tado CE, Peter, Yvonne and Cheyenne with GPS, router and Bluetooth trackers, three HeatMeisters over MQTT). Everything goes through the same API as the page.

`node tests/settings.test.js`

- ✓ fresh install: connected, nothing chosen, setup hint data
- ✓ entities: HomeKit thermostat first, three persons with trackers, three HeatMeisters
- ✓ settings are saved
- ✓ wrong settings are refused with a clear message
- ✓ someone home: the schedule; the thermostat would change
- ✓ everybody leaves: away temperature
- ✓ away delay: first wait, then lower
- ✓ coming home (GPS, within 10 km and getting closer): the schedule
- ✓ coming home off for a person: their approach is ignored
- ✓ Bluetooth does not count: a watch at home does not make Peter home
- ✓ a person who does not count: home, but the house still counts as empty
- ✓ option "schedule only when someone is home" off: always the schedule
- ✓ preheat switch point: heat even when nobody is home
- ✓ location unknown counts as home
- ✓ manual hold: wins, then ends
- ✓ HeatMeisters: their own state is shown, nothing is sent to them
- ✓ thermostat unavailable: no change advised, the page still works
- ✓ activity: one line per change, never "sent"
- ✓ diagnostics: download without names of persons
- ✓ large or broken requests are refused
- ✓ room temperature for the HeatMeisters is shown, but not sent while its option is off
- ✓ SAFETY: with "Allow control" off the app only sent read-only commands

## Control (Allow control on)

The real app with "Allow control" on: sets the HomeKit thermostat only when the advice changes, keeps a change made by hand, waits between writes, respects the daily limit and survives a failing thermostat.

`node tests/control-app.test.js`

- ✓ control on, but nothing chosen yet: nothing is sent
- ✓ someone home: the thermostat is set to the schedule
- ✓ when it already matches, nothing more is sent
- ✓ everybody leaves: away temperature is sent
- ✓ back home within the short wait: not sent yet, then sent
- ✓ a change by hand on the thermostat is kept as a hold, not overwritten
- ✓ ending the hold goes back to the schedule
- ✓ a failing thermostat: logged, not hammered
- ✓ the daily limit stops further writes
- ✓ SAFETY: only climate.set_temperature, only on the chosen thermostat

## HeatMeister room temperature (MQTT on)

The real app with "Send room temperature to HeatMeisters" on: like the Node-RED flow, the room temperature goes to "<Name>/temp-ambient-ext" for each chosen HeatMeister, on a change and every few minutes; only mqtt.publish to those topics.

`node tests/heatmeister-app.test.js`

- ✓ nothing is sent before HeatMeisters are chosen
- ✓ the thermostat room temperature goes to every chosen HeatMeister
- ✓ no new message while the temperature stays the same
- ✓ a new setpoint on the thermostat sends right away (like the Node-RED flow)
- ✓ a change of 0.1 °C or more is sent right away
- ✓ another room temperature sensor can be the source
- ✓ MQTT down: shown as an error, tried again later
- ✓ SAFETY: only mqtt.publish, only to the chosen topics, never the thermostat

## Week schedule

Which switch point is valid when, across midnight, the week and daylight saving time; checks on the schedule.

`node tests/schedule.test.js`

- ✓ the default schedule is valid
- ✓ the switch point that is valid now, and the next one
- ✓ before the first point of the day the last point of the day before is valid
- ✓ across the week: Monday early uses Sunday evening
- ✓ one switch point in the whole week is always valid
- ✓ exactly at a switch time the new point is valid
- ✓ empty schedule gives null
- ✓ daylight saving: the clock time is used, not UTC
- ✓ validation refuses wrong times, temperatures and doubles, and sorts
- ✓ validation needs at least one switch point and at most 12 per day

## Presence

Who is home per person and per kind of tracker (GPS, router, Bluetooth), unknown locations, the away delay, and "coming home" from the GPS position.

`node tests/presence.test.js`

- ✓ someone in the Home zone means home
- ✓ nobody home
- ✓ Bluetooth off: a Bluetooth tracker at home no longer makes Peter home
- ✓ only GPS (zones): the router tracker does not count
- ✓ a person who does not count is shown but ignored
- ✓ unknown location (no counted tracker knows) counts as home
- ✓ a person without trackers uses the person state; a missing person is unknown
- ✓ old settings with plain person ids still work
- ✓ distance between two points
- ✓ coming home: close and getting closer
- ✓ coming home: an old position does not count, nor GPS noise
- ✓ coming home: once home, the history is cleared
- ✓ away delay: wait before treating the house as empty

## Decision

Which temperature and why.

`node tests/decide.test.js`

- ✓ someone home: the schedule
- ✓ nobody home: the away temperature
- ✓ nobody home never raises a lower schedule temperature
- ✓ nobody home but "preheat": the schedule
- ✓ nobody home but someone on the way: the schedule
- ✓ just left: still the schedule, with the waiting time in the reason
- ✓ a manual hold wins over everything, until it ends
- ✓ no schedule: away temperature
- ✓ no change advised when the thermostat already matches, or is unavailable
- ✓ heat demand comes from hvac_action

## When to send

The rules for writing to the thermostat and for noticing a change by hand.

`node tests/control.test.js`

- ✓ send when the advice differs and nothing blocks it
- ✓ do not send when it already matches, is unavailable or is off
- ✓ at least 2 minutes between two writes
- ✓ never more than the daily limit; old writes drop off after 24 hours
- ✓ recordWrite remembers the value and keeps only the last 24 hours
- ✓ a change by hand: the thermostat shows something else than the app set
- ✓ no change by hand right after a write (the thermostat may still be busy)
- ✓ no change by hand without an earlier write, or when unavailable

## HeatMeisters

Finding the HeatMeisters by their entity names (heatbooster_… and heatmeister_…) and reading what they do.

`node tests/heatmeister.test.js`

- ✓ the three HeatMeisters are found, with readable names
- ✓ all known parts are recognised, and similar names are not mixed up
- ✓ reading one: temperatures, fan, room control
- ✓ running while heating or in overrun
- ✓ unknown prefix or unavailable device
- ✓ newer "heatmeister_" names work too
- ✓ the default MQTT topic is "<Name>/temp-ambient-ext", like the Node-RED flow
- ✓ send the room temperature on a change of 0.1 °C, or every few minutes
- ✓ a new thermostat setpoint sends right away, also when the room temperature is the same

## Finding entities

HomeKit thermostat first, tado cloud marked, persons with their trackers, HeatMeisters offered.

`node tests/entities.test.js`

- ✓ thermostats: HomeKit (local) first, tado cloud marked
- ✓ persons with their trackers and tracker kinds
- ✓ HeatMeisters are offered

## Saving

Settings, hold and activity survive a restart; files are written safely.

`node tests/persistence.test.js`

- ✓ settings, hold and activity survive a restart
- ✓ a refused save changes nothing
- ✓ an ended hold is not returned, and clear removes it
- ✓ settings from 0.2 are taken over (persons, Proximity distance, old Heatmeisters)
- ✓ no temporary files are left behind
