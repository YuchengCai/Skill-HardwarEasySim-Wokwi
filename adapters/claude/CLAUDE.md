# Arduino Wokwi Simulation (v0.3.2)

Activate when: user mentions Arduino/Wokwi/microcontroller/单片机, `.ino` / `wokwi.toml` / `diagram.json` files detected, or `@wokwi` / `#arduino` / `@simulate` used.

## Workflow

1. **Generate** — Write `.ino` code, read `core/uno/components.md`, generate `diagram.json` + `wokwi.toml`
2. **Compile** — `./core/scripts/compile.sh <dir>` (auto-installs arduino-cli, MINGW path handled)
3. **Simulate** — 环境检测: VS Code + Wokwi 插件 → Mode B (F1 手动，零依赖)。仅用户要求自动浏览器仿真或无插件 → Mode A: `node core/scripts/wokwi-automate.js <dir>`（此时才检查 playwright，浏览器回退链 Chrome→Edge→Chromium）
4. **Verify** — Ask user, fix if needed
5. **Detect board** — `arduino-cli board list`
6. **Upload + Monitor** — `compile.sh --upload --port --fqbn --monitor`

## Design Rules

- Script failure → fall back to `core/references/monaco-steps.md`, never retry script
- Scripts only "fill and click"; agent generates all content
- Native steps kept in references for fallback

## Version

v0.3.2 | Repo: https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git
