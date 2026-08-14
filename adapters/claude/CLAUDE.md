# Arduino Wokwi Simulation (v0.4.6)

Activate when: user mentions Arduino/Wokwi/microcontroller/单片机, `.ino` / `wokwi.toml` / `diagram.json` files detected, or `@wokwi` / `#arduino` / `@simulate` used.

## Board Support

Uno/Mega/Nano/ESP32 supported — compile.sh auto-infers FQBN from diagram.json; ESP32 core auto-installs via CN mirror.

## Project Files

- `wokwi.toml` MUST use `[wokwi]` section: `[wokwi] version=1 firmware='build/<proj>.ino.hex'` (`[env]`/`[board]` cause "No [wokwi] section found")
- Third-party libs: create `libraries.txt` (one lib name per line), then `arduino-cli lib install "LibName"` before compiling

## Workflow

1. **Generate** — Write `.ino` code, match `references/arduino/index.json` (Chinese names) → components.md → experience.json, generate `diagram.json` + `wokwi.toml`
2. **Compile** — `./scripts/compile.sh <dir>` (auto-installs arduino-cli, MINGW path handled)
3. **Simulate** — 环境检测: VS Code + Wokwi 插件 → Mode B (F1 手动)。仅用户要求自动化或无插件 → Mode A。**Primary: Playwright MCP** (per monaco-steps.md). **Fallback: node scripts/wokwi-automate.js** (only if commands available & no MCP). **HARD RULE: never install playwright/npm without user approval**
4. **Verify** — Before simulation, present wiring text summary (from diagram.json, grouped by component: "LED anode → resistor → board pin13/D2", use function names + exact pins, D prefix for ESP32). Then ask user, fix if needed
5. **Detect board** — `arduino-cli board list`。**HARD RULE: 上传前必须向用户展示端口/板型/FQBN 并确认，禁止静默上传**（单板也要确认）。CH340 克隆板显示 Unknown 属正常，用 `--fqbn arduino:avr:uno`
6. **Upload + Monitor** — `compile.sh --upload --port --fqbn --monitor`

## Hardware Check (before physical wiring)

After simulation passes, before wiring real hardware: show checklist (simulated vs physical model/version), flag interface differences (e.g. OLED I2C vs SPI).
If hardware differs (e.g. SPI OLED): offer options (A) regenerate for physical part (B) use matching part.
⚠️ Before regenerating, set expectations: new simulation may show anomalies (e.g. OLED blank on SPI — simulator only supports I2C). This is a simulator limitation, NOT a code bug. Physical part works with new wiring; simulation can't fully verify it.

## Design Rules

- Script failure → fall back to `references/monaco-steps.md`, never retry script
- Scripts only "fill and click"; agent generates all content
- Native steps kept in references for fallback

## Self-Healing

On activation, if `scripts/compile.sh` or `references/arduino/components.md` is missing, restore from GitHub:
```bash
BASE="https://raw.githubusercontent.com/YuchengCai/Skill-HardwarEasySim-Wokwi/main"
for F in scripts/compile.sh scripts/wokwi-automate.js references/monaco-steps.md references/arduino/components.md references/arduino/index.json references/arduino/experience.json; do
  [ -f "$F" ] || { mkdir -p "$(dirname "$F")"; curl -fsSL "$BASE/$F" -o "$F"; }
done
```

## Version Check & Auto Update

v0.4.6 | Repo: https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git

On activation, check latest release:
```bash
curl -s --connect-timeout 3 https://api.github.com/repos/YuchengCai/Skill-HardwarEasySim-Wokwi/releases/latest | grep "tag_name"
```

If newer, ask user → auto update via `git clone + install.sh` (agent executes, user only says yes). **Always use `--global` flag when updating** unless user explicitly wants project-only.
