# Smart Heating Planner

Heats the house on a week schedule and on who is home, with a tado° thermostat and optional Heatmeister radiator fans.

By default the app only **watches**: it shows what it would do and logs it on the Activity page, but sends nothing. Turn on **Allow control** in the Configuration tab to let it set the thermostat. The Heatmeisters are not controlled yet.

> [!IMPORTANT]
> Before you turn on **Allow control**, turn off your other heating control (for example a Node-RED flow or automations that set the thermostat). Otherwise both change the thermostat, and the app sees the other one's changes as changes by hand.

## Pages

### Home

- **Advice now**: the temperature the thermostat should have, and why (Schedule, Away, Preheat, On the way, Manual hold).
- **Thermostat**: the room temperature, what it is set to, and whether it is heating. "Would change 19.0 °C → 20.5 °C" means the thermostat does not match the advice (with control on: "Will change"). With control on, the line below shows the last command and how many changes were made in the last 24 hours.
- **Who is home**: per person home, away (with the zone) or location unknown.
- **Schedule**: the switch point that is valid now, and the next one.
- **Manual hold**: keep a temperature for 1, 2 or 4 hours, or until the next switch point. It wins over everything else and ends by itself. **End hold** stops it early. A change on the thermostat itself shows here too ("Changed on the thermostat: keeping 22 °C until 17:00").
- **Heatmeisters**: per Heatmeister what it is doing now and whether it should run.

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

- **Advice**: the advice changed (with the reason and the Heatmeister advice).
- **Sent**: the app set the thermostat (only with Allow control on).
- **Changed by hand**: someone changed the thermostat; the app keeps it for a while.
- **Error**: setting the thermostat failed.

### Settings

| Setting | What it does |
| --- | --- |
| **Thermostat entity** | The `climate` entity of your thermostat. Local HomeKit thermostats are listed first. A tado cloud thermostat (tado, Tado CE) gets a warning: tado allows 100 cloud requests per day without a subscription. |
| **Persons** | The persons that count for "home". The house is occupied when at least one of them is in the Home zone. A person with an unknown location counts as home. No persons chosen: the schedule is always followed. |
| **Away temperature** | The temperature when nobody is home (default 16 °C). A lower schedule temperature is kept. |
| **Wait before lowering** | Minutes to wait after the last person left before lowering (default 10). Prevents a short trip or a phone that briefly loses its location from lowering the heating. |
| **Distance sensor**, **Direction of travel sensor**, **Start within** | From the Proximity integration (Settings → Devices & services → Add integration → Proximity, with the Home zone and your persons). When the nearest person is within the distance and travelling **towards** home, the app heats by the schedule. Without a direction sensor, being within the distance is enough. |
| **Heatmeisters** | Per Heatmeister: a name, the entity that switches it (a `fan`, `switch`, `number`, `select` or `light` from the SDR Engineering MQTT device; ★ marks entities that look like a Heatmeister), and optionally its radiator (inlet) temperature sensor. At most 6. |
| **Run when** | *The thermostat heats, or the radiator is still warm* (default): runs while the thermostat asks for heat, and after that while the radiator is still warm, to use the warmth that is left. *The thermostat heats*: only while it asks for heat. *The radiator is warm*: only on the inlet temperature. |
| **Radiator warm from / cool below** | The inlet temperatures to switch on (default 35 °C) and off (default 30 °C). The gap keeps the fans from switching on and off all the time. |
| **A change on the thermostat itself is kept** | With control on: when someone turns the tado (or the tado app) to another temperature, the app keeps it *until the next switch point* (default) or *for the default hold length*. Then it goes back to the schedule. |
| **Default length** | The default length of a manual hold, in minutes. |
| **Download diagnostics** | A file to attach to a bug report. Names of persons, places and the token are left out. |

"Heating" comes from the thermostat's `hvac_action` attribute (`heating`). The HomeKit tado thermostat reports it.

## How the advice is made

The first rule that applies wins:

1. A **manual hold** that has not ended.
2. **Someone is home**, or the last person left less than "Wait before lowering" ago: the schedule.
3. Nobody home, but the current switch point has **Preheat**: the schedule.
4. Nobody home, but someone is **on the way home**: the schedule.
5. Nobody home: the **away temperature**, or the schedule temperature when that is lower.

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
| `max_writes_per_day` | 48 | The most thermostat changes in 24 hours (1–500). |
| `refresh_seconds` | 30 | How often the app reads Home Assistant (10–600). |
| `log_level` | info | How much the app writes to its log. |

## Safety

- The only command that changes anything is `climate.set_temperature` on the thermostat chosen in Settings, and only with **Allow control** on. Everything else the app sends only reads. The tests check this on every push.
- It never changes automations, scripts, helpers or Node-RED flows, and never the thermostat's mode.
- Only Home Assistant ingress can reach the app.
