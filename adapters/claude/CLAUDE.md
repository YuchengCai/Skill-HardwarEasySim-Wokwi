# Arduino Wokwi Simulation (v0.4.0)

Activate when: user mentions Arduino/Wokwi/microcontroller/单片机, `.ino` / `wokwi.toml` / `diagram.json` files detected, or `@wokwi` / `#arduino` / `@simulate` used.

## Workflow

1. **Generate** — Write `.ino` code, match `references/uno/index.json` (Chinese names) → components.md → experience.json, generate `diagram.json` + `wokwi.toml`
2. **Compile** — `./scripts/compile.sh <dir>` (auto-installs arduino-cli, MINGW path handled)
3. **Simulate** — 环境检测: VS Code + Wokwi 插件 → Mode B (F1 手动，零依赖)。仅用户要求自动浏览器仿真或无插件 → Mode A: `node scripts/wokwi-automate.js <dir>`（浏览器回退链 Chrome→Edge→Chromium）。**HARD RULE: 未经用户明确同意，绝不安装 playwright 或任何 npm 包——缺少时先询问用户**
4. **Verify** — Ask user, fix if needed
5. **Detect board** — `arduino-cli board list`。**HARD RULE: 上传前必须向用户展示端口/板型/FQBN 并确认，禁止静默上传**（单板也要确认）。CH340 克隆板显示 Unknown 属正常，用 `--fqbn arduino:avr:uno`
6. **Upload + Monitor** — `compile.sh --upload --port --fqbn --monitor`

## Design Rules

- Script failure → fall back to `references/monaco-steps.md`, never retry script
- Scripts only "fill and click"; agent generates all content
- Native steps kept in references for fallback

## Self-Healing

On activation, if `scripts/compile.sh` or `references/uno/components.md` is missing, restore from GitHub:
```bash
BASE="https://raw.githubusercontent.com/YuchengCai/Skill-HardwarEasySim-Wokwi/main"
for F in scripts/compile.sh scripts/wokwi-automate.js references/monaco-steps.md references/uno/components.md references/uno/index.json references/uno/experience.json; do
  [ -f "$F" ] || { mkdir -p "$(dirname "$F")"; curl -fsSL "$BASE/$F" -o "$F"; }
done
```

## Version Check & Auto Update

v0.4.0 | Repo: https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git

On activation, check latest release:
```bash
curl -s --connect-timeout 3 https://api.github.com/repos/YuchengCai/Skill-HardwarEasySim-Wokwi/releases/latest | grep "tag_name"
```

If newer, ask user → auto update via `git clone + install.sh` (agent executes, user only says yes). **Always use `--global` flag when updating** unless user explicitly wants project-only.
