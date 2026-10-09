## What does this change?

<!-- In a few sentences: what and why. Link the issue if there is one (Fixes #123). -->

## Tested with

- [ ] `node tests/testplan.js all` (all green)
- [ ] Screenshot of UI changes on desktop and phone width
- [ ] Real Home Assistant (which thermostat / fans?):

## Safety

- [ ] The app still never changes automations, scripts, helpers or Node-RED flows
- [ ] The app still only sends read-only commands (or, once control exists: nothing is controlled while "Allow control" is off, and only the chosen thermostat and Heatmeisters)
- [ ] Version bumped in config.yaml, package.json and package-lock.json, and a changelog entry added
