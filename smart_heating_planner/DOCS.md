# Smart Heating Planner

Heats the house on a week schedule and on who is home, with a tado° thermostat and optional HeatMeister radiator fans.

By default the app only **watches**: it shows what it would do and logs it on the Activity page, but sends nothing. Turn on **Allow control** in the Configuration tab to let it set the thermostat. The HeatMeisters run by themselves; the app shows what they do and, with **Send temperature to HeatMeisters** on, sends them the thermostat's setpoint (or a room temperature) over MQTT.

> [!IMPORTANT]
> Before you turn on **Allow control**, turn off your other heating control (for example a Node-RED flow or automations that set the thermostat). Otherwise both change the thermostat, and the app sees the other one's changes as changes by hand.

## Pages

### Home

- **Advice now**: the temperature the thermostat should have, and why (Schedule, Away, Preheat, On the way, Manual hold).
- **Thermostat**: the room temperature, what it is set to, and whether it is heating. "Would change 19.0 °C → 20.5 °C" means the thermostat does not match the advice (with control on: "Will change"). With control on, the line below shows the last command and how many changes were made in the last 24 hours.
- **Who is home**: per person home, away (with the zone, and the distance when coming home is on), or location unknown. Persons who do not count are not shown.
- **Schedule**: the switch point that is valid now, and the next one.
- **Manual hold**: keep a temperature for 1, 2 or 4 hours, or until the next switch point. It wins over everything else and ends by itself. **End hold** stops it early. A change on the thermostat itself shows here too ("Changed on the thermostat: keeping 22 °C until 17:00").
- **HeatMeisters**: per HeatMeister its control state (idle, heat, overrun, slave = follows another HeatMeister, …), running or off (from the fan status and fan speed), the radiator in/out temperature, the room temperature (and its own room target when it controls the room), and the fan speed. With sending on, also the room temperature last sent to it and when.

### Schedule

A list of switch points per day. Each one is valid from its time until the next switch point, also across midnight. For example:

| Time | Temperature | Preheat |
| --- | --- | --- |
| 06:30 | 20 °C | |
| 08:30 | 18 °C | |
| 17:00 | 20.5 °C | ✓ |
| 22:30 | 16 °C | |

**Preheat**: heat to this temperature even when nobody is home. Use it for the moment just before you usually come home.

**Copy Monday to Tue–Fri** copies Monday's list to the other weekdays. Don't forget **Save schedule**.

At most 12 switch points per day; temperatures 5–25 °C, in steps of 0.5 °C.

### Activity

One line for every event, the last 500 are kept:

- **Advice**: the advice changed (with the reason).
- **Sent**: the app set the thermostat (only with Allow control on).
- **Changed by hand**: someone changed the thermostat; the app keeps it for a while.
- **Error**: setting the thermostat failed.

### Settings

| Setting | What it does |
| --- | --- |
| **Thermostat entity** | The `climate` entity of your thermostat. Local HomeKit thermostats are listed first. A tado cloud thermostat (tado, Tado CE) gets a warning: tado allows 100 cloud requests per day without a subscription. |
| **The schedule only counts when someone is home** | On (default): when nobody is home, the away temperature is used (unless *Preheat* or *Coming home*). Off: the schedule is always followed, whoever is home; presence is then only shown. |
| **Counts for home** (per person) | The house is occupied when at least one person who counts is home. Turn it off for someone who should not keep the heating on (for example a child who is away for a week). Nobody counts: the schedule is always followed. |
| **Coming home** (per person) | When this person is away, within **"Coming home" within** km of home and getting closer, the app heats by the schedule. It uses the GPS position from the Companion App and the Home zone; no extra integration is needed. Turn it off for someone who often drives past the house. |
| **Trackers** (per person) | The trackers behind the person in Home Assistant, with their kind and state. Crossed out: that kind does not count (see below). |
| **Which trackers count** | GPS (Companion App, uses your zones), router / network, Bluetooth. A person is home when one of their counted trackers is in the Home zone. Turn Bluetooth off when a Bluetooth device (a watch, a car) can be home without the person. A person with no counted tracker that knows where they are counts as home. |
| **Away temperature** | The temperature when nobody is home (default 16 °C). A lower schedule temperature is kept. |
| **Wait before lowering** | Minutes to wait after the last person left before lowering (default 10). Prevents a short trip or a phone that briefly loses its location from lowering the heating. |
| **"Coming home" within** | The distance in km for "coming home" (default 10). "Getting closer" means: the last GPS position is at least 100 m closer than the one before, and not older than 20 minutes. |
| **HeatMeisters** | Found automatically from their entity names (`sensor.heatbooster_<room>_temp_inlet`, `…_fan_control_state`, …; newer installs use `heatmeister_`). Tick the ones to show on the Home page (and to send the temperature to). At most 6. |
| **Follows (MQTT slave of)** (per HeatMeister) | For a HeatMeister that is an MQTT slave of another one (the master). A slave often has no values of its own; Home then says which master it follows and shows it as running when the master runs. A HeatMeister that shows "slave" is suggested to follow the first HeatMeister that is not a slave. The master must be ticked too, and cannot be a slave itself. |
| **MQTT topic** (per HeatMeister) | Where the HeatMeister listens for the temperature from outside. Default `<Name>/temp-ambient-ext`, for example `Woonkamer-garage/temp-ambient-ext`. Topics are case-sensitive: copy the exact topic your HeatMeister uses (for example `woonkamer-gang/temp-ambient-ext`). No `+` or `#`. |
| **Send to the HeatMeisters** | *The thermostat's setpoint* (default, like a Node-RED flow that forwards the target temperature) or *A room temperature*. |
| **Take the room temperature from** | Only with *A room temperature*: the thermostat's own room temperature, or another temperature sensor. |
| **Send it at least every** | Minutes (1–60, default 5). The app sends the temperature when the thermostat's setpoint changes, when the temperature changes by 0.1 °C or more, and otherwise at least this often. |
| **A change on the thermostat itself is kept** | With control on: when someone turns the tado (or the tado app) to another temperature, the app keeps it *until the next switch point* (default) or *for the default hold length*. Then it goes back to the schedule. |
| **Default length** | The default length of a manual hold, in minutes. |
| **Download diagnostics** | A file to attach to a bug report. Names of persons, places and the token are left out. |

"Thermostat asks for heat" comes from the thermostat's `hvac_action` attribute (`heating`). The HomeKit tado thermostat reports it.

## How the advice is made

The first rule that applies wins:

1. A **manual hold** that has not ended.
2. **Someone is home**, or the last person left less than "Wait before lowering" ago: the schedule.
3. Nobody home, but the current switch point has **Preheat**: the schedule.
4. Nobody home, but someone is **on the way home**: the schedule.
5. Nobody home: the **away temperature**, or the schedule temperature when that is lower.

## Temperature for the HeatMeisters

A HeatMeister listens on MQTT, topic `<Name>/temp-ambient-ext`, for a temperature from outside. With **Send temperature to HeatMeisters** on, the app sends it:

1. It takes the thermostat's setpoint (default), or a room temperature (the thermostat's own, or the sensor you chose).
2. For every ticked HeatMeister it sends the value to its topic right away when the thermostat's setpoint changes (by the app, by another automation or by hand), when the value changed by 0.1 °C or more, and otherwise every few minutes.
3. Home shows the value and, per HeatMeister, what was sent and when. If MQTT is not reachable, Home shows the error and the app tries again at the next refresh.

It goes through Home Assistant's MQTT integration (`mqtt.publish`), so the app needs no MQTT login of its own.

## Controlling the thermostat

With **Allow control** on, every refresh:

1. If the app set the thermostat before and it now shows something else (after giving it 3 minutes to update), someone changed it by hand: the app keeps that temperature (see the setting above) and does not overwrite it.
2. If the advice differs from what the thermostat is set to, the app sets it with `climate.set_temperature`.

Limits:

- Only when the target really differs (0.5 °C steps).
- At least 2 minutes between two changes.
- Never more than **Most changes per 24 hours**. A failed try counts too, so a broken thermostat is not hammered.
- Not when the thermostat is off or unavailable. The app never changes the thermostat's mode (heat/off/auto).

**tado:** use the HomeKit thermostat (local). Through the tado cloud (tado, Tado CE) every change is a request, and tado allows 100 per day without a subscription; also Home Assistant's own polling uses that budget. If you do use the cloud, set **Most changes per 24 hours** to about 20.

**tado's own schedule:** when the app sets a temperature, tado treats it as a manual setting. Depending on your tado settings it ends that at tado's next schedule block and goes back to tado's own schedule. The app then sees tado's value as a change by hand. To avoid that, make tado's own schedule flat (one block all day), or set tado's manual control to "Until you cancel".

## Configuration tab

| Option | Default | What it does |
| --- | --- | --- |
| `allow_control` | off | Off: the app only watches. On: it sets the thermostat chosen in Settings. |
| `allow_heatmeister_temperature` | off | **Send temperature to HeatMeisters.** On: the app sends the thermostat's setpoint (or a room temperature) to the chosen HeatMeisters over MQTT, through Home Assistant's MQTT integration. This replaces a Node-RED flow that does the same; both at the same time does no harm. |
| `max_writes_per_day` | 48 | The most thermostat changes in 24 hours (1–500). |
| `refresh_seconds` | 30 | How often the app reads Home Assistant (10–600). |
| `log_level` | info | How much the app writes to its log. |

## Safety

- The app changes only two things, each behind its own option that is off by default: `climate.set_temperature` on the thermostat chosen in Settings (**Allow control**), and `mqtt.publish` of a temperature to the HeatMeister topics chosen in Settings (**Send temperature to HeatMeisters**). Everything else the app sends only reads. The tests check this on every push.
- It never changes automations, scripts, helpers or Node-RED flows, and never the thermostat's mode.
- Only Home Assistant ingress can reach the app.
