# Arduino Wokwi Simulation (v0.2.5)

Activate when: user mentions Arduino/Wokwi/microcontroller/单片机, `.ino` / `wokwi.toml` / `diagram.json` files detected, or `@wokwi` / `#arduino` used.

## Workflow

1. **Generate** — Write `.ino` code, read `core/uno/components.md` for component pin names, generate `diagram.json` and `wokwi.toml`
2. **Compile** — Run `./core/scripts/compile.sh <dir>`
3. **Simulate** — Tell user: Press F1 → "Wokwi: Start Simulation"
4. **Verify** — Ask user: "Does the simulation work correctly?"
5. **Detect board** — `arduino-cli board list`
6. **Upload** — `arduino-cli upload -p <PORT> --fqbn <FQBN> <dir>`
7. **Monitor** — `compile.sh --upload --port --fqbn --monitor`

## Version Check

Current: v0.2.5 | Repo: https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git

Check latest release on activation. If newer, ask user to update → `git clone + install.sh`.

## Component Reference

All pin names in `core/uno/components.md`.
