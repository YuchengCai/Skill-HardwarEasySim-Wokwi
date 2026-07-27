# Arduino Wokwi Simulation (v0.2.0)

Activate when: user mentions Arduino/Wokwi/microcontroller/单片机, `.ino` / `wokwi.toml` / `diagram.json` files detected, or `@wokwi` / `#arduino` used.

## Workflow

1. **Generate** — Write `.ino` code, read `core/uno/components.md` for component pin names, generate `diagram.json` and `wokwi.toml`
2. **Compile** — Run `./core/scripts/compile.sh <dir>` (auto-installs arduino-cli + core)
3. **Simulate** — Tell user: Press F1 → "Wokwi: Start Simulation" (or use wokwi.com)
4. **Verify** — Ask user: "Does the simulation work correctly?"
   - Yes → proceed to upload
   - No → fix and recompile
5. **Detect board** — Run `arduino-cli board list`
   - None found → ask user to connect board
   - One found → auto-select
   - Multiple → show list let user choose
6. **Upload** — `arduino-cli upload -p <PORT> --fqbn <FQBN> <dir>`
7. **Done** — Board LED blinks 3 times. Ask: "Open Serial Monitor?"

## Component Reference

All pin names in `core/uno/components.md`.

## Routing

Use waypoints `["h<offset>", "v<offset>"]` for clean wire routing.
