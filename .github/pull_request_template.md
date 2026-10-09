## What does this change?

<!-- In a few sentences: what and why. Link the issue if there is one (Fixes #123). -->

## Tested with

- [ ] `node tests/testplan.js all` (all green)
- [ ] Screenshot of UI changes on desktop and phone width
- [ ] Real Home Assistant (which thermostat / fans?):

## Safety

- [ ] The app still never changes automations, scripts, helpers or Node-RED flows
- [ ] Nothing is controlled while "Allow control" is off, and with it on only the target temperature of the chosen thermostat
- [ ] Version bumped in config.yaml, package.json and package-lock.json, and a changelog entry added
