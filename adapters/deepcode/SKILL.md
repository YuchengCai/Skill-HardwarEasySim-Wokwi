---
name: wokwi-arduino
description: Create, compile, simulate, and upload Arduino projects with Wokwi (VS Code extension, wokwi.com browser automation, or web editor). Use when the user mentions Arduino, Wokwi, 单片机, 嵌入式, or when .ino / wokwi.toml / diagram.json files are detected. Explicitly activate with @wokwi, #arduino, or @simulate.
---

# Arduino Wokwi Simulation Skill (v0.4.0)

Create, compile, simulate, and upload Arduino projects using Wokwi.

## How This Skill Works

Component pin names, attributes, and connection patterns are in **`references/uno/components.md`** — read that file when you encounter an unfamiliar component.

## Activation Triggers

- **Keywords**: arduino, wokwi, uno, microcontroller, 单片机, 嵌入式, blink, LED, sensor, servo
- **File detection**: `.ino`, `wokwi.toml`, `diagram.json` in workspace
- **Explicit**: user message contains `@wokwi`, `#wokwi`, `@arduino`, `#arduino`, `@simulate`

## Project Structure

```
project/
├── project.ino        # Arduino sketch (C++) — MUST match directory name
├── diagram.json       # Circuit diagram
├── wokwi.toml         # [wokwi] version=1 firmware='build/project.ino.hex'
└── libraries.txt      # OPTIONAL: third-party libs, one per line
```

### wokwi.toml — CORRECT format (verified)

```toml
[wokwi]
version = 1
firmware = 'build/<project>.ino.hex'
```

⚠️ **Must use `[wokwi]` section** — `[env]` / `[board]` are WRONG and cause "No [wokwi] section found" error.

### libraries.txt — third-party libraries

If the sketch uses third-party libraries (DHT, Adafruit SSD1306, LiquidCrystal, etc.):

1. Create `libraries.txt` in the project root — **one library name per line** (the Arduino Library Manager search name):
```
DHT sensor library
Adafruit SSD1306
```
2. **Before compiling**, install the same libraries locally for arduino-cli:
```bash
arduino-cli lib install "DHT sensor library" "Adafruit SSD1306"
```

## Full Workflow (Generate → Compile → Simulate → Upload)

### 1. Generate Code & Circuit

1. Write the `.ino` sketch code (include a 3x blink in setup() as upload success indicator)
2. Open **`references/uno/components.md`** — look up every component you intend to use
3. Generate `diagram.json` with correct pin names and wiring
4. Generate `wokwi.toml` pointing to `build/project.ino.hex`

### 2. Compile

```bash
./scripts/compile.sh <project-dir>
```

Auto-installs `arduino-cli` + Uno core if missing. Handles MINGW/Windows path conversion automatically.

### 3. Simulate — Auto-select Mode

**First, detect the environment:**
- User is in VS Code with the Wokwi extension installed → **Mode B** (manual, no extra deps)
- User explicitly requests auto browser simulation (`@simulate`) OR no VS Code Wokwi plugin → **Mode A** (browser automation)

**⚠️ HARD RULE: NEVER install playwright (or any npm package) without explicit user approval.**
- Check availability first; if missing, ASK the user before installing
- VS Code + Wokwi plugin users use Mode B — playwright is never needed

#### Mode A: Browser Automation (on-demand)

Only used when the user asks for auto browser simulation, or when no VS Code Wokwi plugin is available.

```bash
# Check playwright availability — do NOT install automatically
node -e "require('playwright')" 2>/dev/null && echo "playwright OK" || echo "playwright 未安装"

# If playwright is missing, you MUST ask the user first:
#   "自动浏览器仿真需要 playwright 依赖，是否安装？"
# Only proceed after user explicitly agrees.

# Run the automation script
node scripts/wokwi-automate.js <project-dir>
```

The script automatically:
1. Opens wokwi.com new Arduino Uno project page (no login needed)
2. Waits for Monaco editor
3. Fills the `.ino` code (via Monaco API, NOT browser_type)
4. Switches to diagram.json tab and fills the circuit
5. Clicks "Start the simulation"

Browser fallback chain: **system Chrome → system Edge → Playwright Chromium**.

⚠️ **If the script fails (non-zero exit code): DO NOT retry. Fall back to native Monaco operations** — see `references/monaco-steps.md`. Use the script's error message to diagnose.

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
| One board | Show port + board name + FQBN, **ASK user to confirm** |
| Multiple | Show full list (port + board name), let user choose |
| Unknown (CH340 clone) | Show port, note board type unrecognized, **ask user to confirm FQBN** (Uno clone → arduino:avr:uno) |

**⚠️ HARD RULE: Before uploading, you MUST show the user the port, board type, and FQBN, and get their confirmation. Never silently auto-upload.** Even with a single board detected, confirm with the user first (they may have connected a different board than expected).

**CH340 clone boards**: `board list` shows `Unknown` — this is normal for clone boards using the CH340 chip. The `compile.sh --detect` command will try to identify the chip via VID/PID and suggest an FQBN. For most CH340 clones, use `--fqbn arduino:avr:uno`.

### 6. Upload & Monitor

```bash
./scripts/compile.sh <project-dir> --upload --port <PORT> --fqbn <FQBN> --monitor
```

This compiles (if needed), uploads, auto-captures serial output, and prints the real-time monitor command.

---

## Design Rules (Mandatory — Do Not Violate)

1. **Keep native operation steps in SKILL.md/references** — scripts are shortcuts, not the only path
2. **Script failure → force fallback to native operations** (monaco-steps.md), never retry the script
3. **Content generation stays with the agent** — scripts only "fill and click", never "think"
4. **HARD RULE: Simulation → Physical wiring requires hardware check.** Before guiding physical wiring, confirm the user's component model/version matches the simulation. Warn about interface differences (e.g. I2C vs SPI OLED).

---

## Hardware Check (Mandatory before physical wiring)

When the user confirms simulation and wants to wire the real hardware, ALWAYS:

1. **Show a checklist** comparing simulated components vs user's physical parts (model/version confirmation)
2. **Flag known interface differences** (e.g. wokwi-ssd1306 only simulates I2C; physical OLED may be SPI)
3. **If user's hardware differs from simulation** (e.g. SPI OLED):
   - Explain the difference and offer options: (A) regenerate code/wiring for their physical part, or (B) suggest using a part matching the simulation
   - **⚠️ Set expectations BEFORE regenerating**: the new simulation may show different/absent behavior (e.g. OLED shows nothing on SPI wiring, because the simulator only supports I2C). This is a **simulator limitation, NOT a bug or error** in their code. The physical part will work with the regenerated wiring, but simulation cannot fully verify it.
   - After regenerating, if the user runs simulation and sees anomalies, remind them again: "这是模拟器限制，不是代码错误——您的实物按新接线会正常工作"
4. If the user's hardware matches the simulation → proceed normally

---

## Self-Healing (Mandatory — Check on Activation)

If any of these files are missing (e.g. skill was installed from a marketplace that only synced SKILL.md), restore them from GitHub before using the skill:

```bash
# Check and restore missing files
BASE="https://raw.githubusercontent.com/YuchengCai/Skill-HardwarEasySim-Wokwi/main"
for F in scripts/compile.sh scripts/wokwi-automate.js references/monaco-steps.md references/uno/components.md references/uno/index.json references/uno/experience.json; do
  if [ ! -f "$F" ]; then
    echo "缺失 $F，正在从 GitHub 恢复..."
    mkdir -p "$(dirname "$F")"
    curl -fsSL "$BASE/$F" -o "$F"
  fi
done
```

**⚠️ If the skill directory has `core/` (old structure) instead of `scripts/` + `references/`, run `install.sh` again to migrate, or manually move files into the standard layout.**

---

## Version Check & Auto Update

Current version: **v0.4.0**
Repository: `https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git`

When activated, check the latest release:
```bash
curl -s --connect-timeout 3 https://api.github.com/repos/YuchengCai/Skill-HardwarEasySim-Wokwi/releases/latest | grep "tag_name"
```

If newer, ask user to update → `git clone + install.sh` (auto).

⚠️ **When executing the update via install.sh, always use `--global`** (unless the user explicitly wants project-only). The script auto-detects non-interactive environments and defaults to global, but passing `--global` explicitly is more reliable.

## Component Reference

### Lookup order (fast → accurate)

1. **`references/uno/index.json`** — full catalog (50 components) with Chinese names (`zh`) and pins. Match user's Chinese description → `type` → pins.
2. **`references/uno/components.md`** — verified detailed manual for high-frequency components (pin tables, attributes, wiring examples).
3. **`references/uno/experience.json`** — accumulated wiring patterns & layout tips (agent-learned). Reference it when generating `diagram.json`.
4. **`references/uno/detail/<type>.json`** — per-component detail (auto-generated skeleton).

### Chinese name matching rules

- Match user's description against the `zh` field in `index.json` (e.g. "温湿度传感器" → `wokwi-dht22`).
- **If ambiguous (multiple candidates)**: list candidates and ask the user, e.g. "您说的显示屏，是 LCD1602 还是 OLED？" Do NOT guess silently.
- If the user names a specific model (DHT11/LCD1602/WS2812), match directly.
- If not found in `index.json`: ask the user for the exact model, or use the source fallback below.

### Source fallback (rare)

If a component is missing or pins are incomplete, fetch from the authoritative open-source library:
```bash
curl -sL https://raw.githubusercontent.com/wokwi/wokwi-elements/main/src/<file>.ts
```
Extract `pinInfo` from the source. After verification, note it for future reference (add to `experience.json`).

### Layout & wiring quality

When generating `diagram.json`, consult `experience.json` `layout_tips` and existing `patterns`:
- Keep wires off the board and components (use waypoints `["h<offset>","v<offset>"]`)
- Place components near their target pins (above or to the right)
- Standard color coding: red = power, black = GND, others = signals

## Environment Dependencies

| Dependency | Required For | Install |
|-----------|-------------|---------|
| `arduino-cli` | Compile + upload | Auto via compile.sh |
| `playwright` npm package | Browser automation script | Only after user approval |
| Playwright MCP | Native Monaco fallback | Only after user approval |
| VS Code + Wokwi ext | Manual simulation | Manual |
