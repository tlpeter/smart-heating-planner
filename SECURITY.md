# Security

Smart Heating Planner reads who is home and, with "Allow control" on, sets your thermostat (and later your Heatmeister fans). A security problem can therefore have real consequences: a cold house, a high energy bill, or someone learning when nobody is home.

**Please do not report security problems as a public issue.** Use [Report a vulnerability](https://github.com/tlpeter/smart-heating-planner/security/advisories/new) instead (GitHub's private reporting). You will get an answer within a week.

Examples of what to report:

- a way to make the app control anything while "Allow control" is off
- a way to make it control anything other than the target temperature of the chosen thermostat
- a way to reach the app's API from outside Home Assistant ingress
- the Supervisor token, names of persons or locations showing up in logs or the diagnostics file

How the app protects you:

- Only the Home Assistant ingress proxy may talk to the app; other devices on the network are refused.
- The app has a fixed list of read-only commands. The one write (`climate.set_temperature`) has its own path that checks "Allow control" and the chosen thermostat. Anything else is refused in code and tested on every push.
- It writes at most a set number of times per 24 hours, so it cannot flood your thermostat or the tado cloud.
- Requests to the app are limited in size and checked before anything is saved.
- The diagnostics file leaves out names of persons, places and the token.
- Dependencies are installed from `package-lock.json` with integrity checks, and Dependabot keeps them up to date.

Only the latest version is supported.
