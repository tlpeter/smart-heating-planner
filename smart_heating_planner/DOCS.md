# Smart Heating Planner

Heats the house on a week schedule and on who is home, with a tado° thermostat and optional Heatmeister radiator fans.

**This version only watches.** It shows what it would do, and logs it on the Activity page, but it sends nothing to the thermostat or the Heatmeisters. Keep your current heating control on until a later version can take over.

## Pages

### Home

- **Advice now**: the temperature the thermostat should have, and why (Schedule, Away, Preheat, On the way, Manual hold).
- **Thermostat**: the room temperature, what it is set to, and whether it is heating. "Would change 19.0 °C → 20.5 °C" means the thermostat does not match the advice.
- **Who is home**: per person home, away (with the zone) or location unknown.
- **Schedule**: the switch point that is valid now, and the next one.
- **Manual hold**: keep a temperature for 1, 2 or 4 hours, or until the next switch point. It wins over everything else and ends by itself. **End hold** stops it early.
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

One line every time the advice changes: the time, the advice, what the thermostat was set to, the reason, the Heatmeister advice, and whether something was sent (always "no" in this version). The last 500 lines are kept.

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

## Configuration tab

| Option | Default | What it does |
| --- | --- | --- |
| `refresh_seconds` | 30 | How often the app reads Home Assistant (10–600). |
| `log_level` | info | How much the app writes to its log. |

## Safety

- The app only reads from Home Assistant. Every command it may send is on a fixed read-only list; the tests check this on every push.
- It never changes automations, scripts, helpers or Node-RED flows.
- Only Home Assistant ingress can reach the app.
