# Danny Full Integration – Degrees of Lewdity Plus

Push-style modular overlay. Does **not** modify the 55 MB base HTML.

## Files
- `danny-mod-registration.js` – Registers Danny in `setup.modLIRegistry`, creates/patches `$NPCName` slot with Love, Lust, Control, Dependency, bladder, diaperState, etc. Hooks molded-LI / world-creation enable path.
- `danny-passages.js` – Injects first meetings, room, schedule door notes, control-training vs dependency-care paths, accident stub, and quest skeleton via `Story.add()`.

## How to load (userscript / console / future loader)
1. Ensure the base game has loaded SugarCube.
2. Inject or eval `danny-mod-registration.js`.
3. Then inject `danny-passages.js`.
4. Danny should appear in the modded love-interest section and have a Social-tab slot once the guarantor runs.

## What is implemented
- Registration + healthy NPC slot (control/dependency/bladder/diaper fields)
- First meeting (orphanage main hall + canteen)
- Room entry with door notes (sleeping / at school)
- Talk, Control Training (+control, -dependency), Dependency Care (+dependency, +love/lust)
- Accident event stub
- Quest start stub (Bailey debt + vulnerability)

## Still needed for complete Robin-level depth
- Full weekday/weekend timetable wired into existing time/location checks
- More first-meeting variants and schedule deviations
- Expanded accident, public, and intimacy scenes
- Complete personal quest (debt takeover, hospital, trauma recovery, dating unlock)
- Social-tab progress bars (Love + Control/Dependency) hooked into existing UI widgets
- Safehouse gender/genitalia controls (already supported by NNPC system once slot exists)
- Cinema / forest / date events
- Integration with existing `<<love>>`, `<<lust>>`, `<<trauma>>` macros and relationship checks

## Next expansion priorities
1. Wire `updateDannySchedule()` into the game’s time-passage system.
2. Add more passages (dates, public accidents, high-dependency scenes, high-control independence events).
3. Hook Social tab and relationship status displays.
4. Flesh out the full quest line.

Load order: registration first, then passages.
All new content stays outside the compiled HTML for easy push updates.
