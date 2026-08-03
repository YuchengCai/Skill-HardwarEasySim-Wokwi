---
name: wokwi-arduino
description: Create, compile, simulate, and upload Arduino projects with Wokwi (VS Code extension, wokwi.com browser automation, or web editor). Use when the user mentions Arduino, Wokwi, 单片机, 嵌入式, or when .ino / wokwi.toml / diagram.json files are detected. Explicitly activate with @wokwi, #arduino, or @simulate.
---

# Arduino Wokwi Simulation Skill (v0.3.2)

Create, compile, simulate, and upload Arduino projects using Wokwi.

## How This Skill Works

Component pin names, attributes, and connection patterns are in **`core/uno/components.md`** — read that file when you encounter an unfamiliar component.

## Activation Triggers

- **Keywords**: arduino, wokwi, uno, microcontroller, 单片机, 嵌入式, blink, LED, sensor, servo
- **File detection**: `.ino`, `wokwi.toml`, `diagram.json` in workspace
- **Explicit**: user message contains `@wokwi`, `#wokwi`, `@arduino`, `#arduino`, `@simulate`

## Project Structure

```
project/
├── project.ino        # Arduino sketch (C++) — MUST match directory name
├── diagram.json       # Circuit diagram
└── wokwi.toml         # [wokwi] version=1 firmware='build/project.ino.hex'
```

## Full Workflow (Generate → Compile → Simulate → Upload)

### 1. Generate Code & Circuit

1. Write the `.ino` sketch code (include a 3x blink in setup() as upload success indicator)
2. Open **`core/uno/components.md`** — look up every component you intend to use
3. Generate `diagram.json` with correct pin names and wiring
4. Generate `wokwi.toml` pointing to `build/project.ino.hex`

### 2. Compile

```bash
./core/scripts/compile.sh <project-dir>
```

Auto-installs `arduino-cli` + Uno core if missing. Handles MINGW/Windows path conversion automatically.

### 3. Simulate — Auto-select Mode

**First, detect the environment:**
- User is in VS Code with the Wokwi extension installed → **Mode B** (manual, no extra deps)
- User explicitly requests auto browser simulation (`@simulate`) OR no VS Code Wokwi plugin → **Mode A** (browser automation)

**Do NOT install playwright unless Mode A is actually selected.**

#### Mode A: Browser Automation (on-demand)

Only used when the user asks for auto browser simulation, or when no VS Code Wokwi plugin is available.

```bash
# Check playwright availability (only now, only for Mode A):
node -e "require('playwright')" 2>/dev/null || { echo "需要安装 playwright 才能自动浏览器仿真"; npm i playwright; }

# Run the automation script
node core/scripts/wokwi-automate.js <project-dir>
```

The script automatically:
1. Opens wokwi.com new Arduino Uno project page (no login needed)
2. Waits for Monaco editor
3. Fills the `.ino` code (via Monaco API, NOT browser_type)
4. Switches to diagram.json tab and fills the circuit
5. Clicks "Start the simulation"

Browser fallback chain: **system Chrome → system Edge → Playwright Chromium**.

⚠️ **If the script fails (non-zero exit code): DO NOT retry. Fall back to native Monaco operations** — see `core/references/monaco-steps.md`. Use the script's error message to diagnose.

#### Mode B: Manual (VS Code plugin — DEFAULT for VS Code users)

Tell the user: Press F1 → "Wokwi: Start Simulation" (VS Code). No extra dependencies needed.

### 4. Verify with User

Ask the user: "Does the simulation show the expected behavior?"

- **Yes** → proceed to upload
- **No** → fix code/diagram, recompile, re-simulate

### 5. Detect Connected Board

```bash
arduino-cli board list
```

| Output | Action |
|--------|--------|
| No boards | Ask user to connect the board via USB |
| One board | Auto-select, note port + FQBN |
| Multiple | Show list with port + board name, let user choose |

### 6. Upload & Monitor

```bash
./core/scripts/compile.sh <project-dir> --upload --port <PORT> --fqbn <FQBN> --monitor
```

This compiles (if needed), uploads, auto-captures serial output, and prints the real-time monitor command.

---

## Design Rules (Mandatory — Do Not Violate)

1. **Keep native operation steps in SKILL.md/references** — scripts are shortcuts, not the only path
2. **Script failure → force fallback to native operations** (monaco-steps.md), never retry the script
3. **Content generation stays with the agent** — scripts only "fill and click", never "think"

---

## Version Check & Auto Update

Current version: **v0.3.2**
Repository: `https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git`

When activated, check the latest release:
```bash
curl -s --connect-timeout 3 https://api.github.com/repos/YuchengCai/Skill-HardwarEasySim-Wokwi/releases/latest | grep "tag_name"
```

If newer, ask user to update → `git clone + install.sh` (auto).

## Component Reference

Read **`core/uno/components.md`** for verified pin names, attributes, and connection examples.

For components not in the reference, open wokwi.com in a browser, use the visual editor to place the component, copy the generated `diagram.json`, and add the entry to `components.md`.

## Environment Dependencies

| Dependency | Required For | Install |
|-----------|-------------|---------|
| `arduino-cli` | Compile + upload | Auto via compile.sh |
| `playwright` npm package | Browser automation script | `npm i playwright` |
| Playwright MCP | Native Monaco fallback | `npx @playwright/mcp@latest` |
| VS Code + Wokwi ext | Manual simulation | Manual |
