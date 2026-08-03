# Arduino Wokwi Simulation (v0.3.0)

Activate when: user mentions Arduino/Wokwi/microcontroller/单片机, `.ino` / `wokwi.toml` / `diagram.json` files detected, or `@wokwi` / `#arduino` / `@simulate` used.

## Workflow

1. **Generate** — Write `.ino` code, read `core/uno/components.md`, generate `diagram.json` + `wokwi.toml`
2. **Compile** — `./core/scripts/compile.sh <dir>` (auto-installs arduino-cli, MINGW path handled)
3. **Simulate** — Mode A: `node core/scripts/wokwi-automate.js <dir>` (browser auto, Chrome→Edge→Chromium). Mode B: user presses F1
4. **Verify** — Ask user, fix if needed
5. **Detect board** — `arduino-cli board list`
6. **Upload + Monitor** — `compile.sh --upload --port --fqbn --monitor`

## Design Rules

- Script failure → fall back to `core/references/monaco-steps.md`, never retry script
- Scripts only "fill and click"; agent generates all content
- Native steps kept in references for fallback

## Version

v0.3.0 | Repo: https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git
