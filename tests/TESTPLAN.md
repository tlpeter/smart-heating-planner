# Test plan

This file is written by `tests/testplan.js` from the results of the last test run. GitHub runs every test after each push and updates this file, so it always matches the code. Run it yourself with `node tests/testplan.js all` (a few seconds).

A separate check (`.github/workflows/ha-core-compat.yml`) runs the app against a real Home Assistant Core.

## Summary

| Test | Passed |
|---|---|
| Settings and situations | 17 of 17 ✓ |
| Control (Allow control on) | 10 of 10 ✓ |
| Week schedule | 10 of 10 ✓ |
| Presence | 8 of 8 ✓ |
| Decision | 13 of 13 ✓ |
| When to send | 8 of 8 ✓ |
| Finding entities | 5 of 5 ✓ |
| Saving | 4 of 4 ✓ |

Version: 0.2.0.

## Settings and situations

The real app ("Allow control" off) against a fake Home Assistant (tado over HomeKit and Tado CE, Peter, Yvonne and Cheyenne, Proximity, three Heatmeisters over MQTT). Everything goes through the same API as the page.

`node tests/settings.test.js`

- ✓ fresh install: connected, nothing chosen, setup hint data
- ✓ entities: HomeKit thermostat first, three persons, three Heatmeisters
- ✓ settings are saved
- ✓ wrong settings are refused with a clear message
- ✓ someone home: the schedule; the thermostat would change
- ✓ everybody leaves: away temperature
- ✓ away delay: first wait, then lower
- ✓ on the way home within 10 km: the schedule
- ✓ preheat switch point: heat even when nobody is home
- ✓ location unknown counts as home
- ✓ manual hold: wins, then ends
- ✓ Heatmeisters: run on heat demand and while the radiator is warm
- ✓ thermostat unavailable: no change advised, the page still works
- ✓ activity: one line per change, never "sent"
- ✓ diagnostics: download without names of persons
- ✓ large or broken requests are refused
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

Who is home, unknown locations, the away delay and "on the way home".

`node tests/presence.test.js`

- ✓ someone in the Home zone means home
- ✓ nobody home
- ✓ unknown location counts as home (better warm than cold)
- ✓ a person that does not exist counts as unknown
- ✓ away delay: wait before treating the house as empty
- ✓ on the way home: close and travelling towards home
- ✓ on the way home without a direction sensor: being close is enough
- ✓ no distance sensor chosen: never approaching

## Decision

Which temperature and why; the Heatmeister rule with its gap.

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
- ✓ Heatmeister "both": runs on demand, and after it while the radiator is warm
- ✓ Heatmeister gap: between "off" and "on" it keeps what it was
- ✓ Heatmeister "demand": only while the thermostat heats

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

## Finding entities

HomeKit thermostat first, tado cloud marked, Heatmeisters recognised.

`node tests/entities.test.js`

- ✓ thermostats: HomeKit (local) first, tado cloud marked
- ✓ persons and proximity sensors are found
- ✓ Heatmeister entities are recognised and listed first
- ✓ recognised by name alone, without the device registry
- ✓ old "heatbooster" entity ids with a "HeatMeister - …" name are recognised

## Saving

Settings, hold and activity survive a restart; files are written safely.

`node tests/persistence.test.js`

- ✓ settings, hold and activity survive a restart
- ✓ a refused save changes nothing
- ✓ an ended hold is not returned, and clear removes it
- ✓ no temporary files are left behind
