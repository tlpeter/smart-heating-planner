# Security

Smart Heating Planner reads who is home and, in a later version, will set your thermostat and switch your Heatmeister fans. A security problem can therefore have real consequences: a cold house, a high energy bill, or someone learning when nobody is home.

**Please do not report security problems as a public issue.** Use [Report a vulnerability](https://github.com/tlpeter/smart-heating-planner/security/advisories/new) instead (GitHub's private reporting). You will get an answer within a week.

Examples of what to report:

- a way to make the app send any command to Home Assistant (this version only reads)
- later: a way to control anything while "Allow control" is off, or anything other than the chosen thermostat and Heatmeisters
- a way to reach the app's API from outside Home Assistant ingress
- the Supervisor token, names of persons or locations showing up in logs or the diagnostics file

How the app protects you:

- Only the Home Assistant ingress proxy may talk to the app; other devices on the network are refused.
- The app has a fixed list of read-only commands; anything else is refused in code and tested on every push.
- Requests to the app are limited in size and checked before anything is saved.
- The diagnostics file leaves out names of persons, places and the token.
- Dependencies are installed from `package-lock.json` with integrity checks, and Dependabot keeps them up to date.

Only the latest version is supported.
