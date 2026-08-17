---
name: wokwi-arduino
description: Create, compile, simulate, and upload Arduino projects with Wokwi (VS Code extension, wokwi.com browser automation, or web editor). Use when the user mentions Arduino, Wokwi, 单片机, 嵌入式, or when .ino / wokwi.toml / diagram.json files are detected. Explicitly activate with @wokwi, #arduino, or @simulate.
---

# Arduino Wokwi Simulation Skill (v0.4.6)

Create, compile, simulate, and upload Arduino projects using Wokwi.

## How This Skill Works

Component pin names, attributes, and connection patterns are in **`references/arduino/components.md`** — read that file when you encounter an unfamiliar component.

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
2. Open **`references/arduino/components.md`** — look up every component you intend to use
3. Generate `diagram.json` with correct pin names and wiring
4. Generate `wokwi.toml` pointing to `build/project.ino.hex`
5. **Run the wiring checker** to detect conflicts before simulating:
   ```bash
   node scripts/optimize-wiring.js <project-dir> --dry-run
   ```
   Fix any reported conflicts — 线穿板/线交叉/线重叠/元件重叠（共享同一 GND/5V 的多条线要分路，避免共线）。

### 2. Compile

```bash
./scripts/compile.sh <project-dir>
```

Auto-installs `arduino-cli` + Uno core if missing. Handles MINGW/Windows path conversion automatically.

**⚠️ HARD RULE: The Wokwi plugin reads the compiled firmware (`build/<project>.ino.hex`, referenced by `wokwi.toml`), NOT the `.ino` source.** Every time you modify the `.ino`, you MUST re-run `compile.sh` (or `arduino-cli compile --fqbn <fqbn> --output-dir build`) AND restart the simulation in VS Code — otherwise the simulation still runs the old firmware (LEDs won't reflect your code changes).

**⚠️ Non-blocking code rule:** when a sketch handles buttons + sensors/display together, NEVER use `delay()` to pace the loop — buttons become unresponsive and presses get missed. Use edge-detection for buttons (`lastState` compare) and `millis()` timing for periodic tasks (e.g. DHT sampling every 2s). See the Uno template in `core/uno/`.

### 3. Simulate — Auto-select Mode

**First, detect the environment:**
- User is in VS Code with the Wokwi extension installed → **Mode B** (manual, no extra deps)
- User explicitly requests auto browser simulation (`@simulate`) OR no VS Code Wokwi plugin → **Mode A** (browser automation)

**⚠️ HARD RULE: NEVER install playwright (or any npm package) without explicit user approval.**
- Check availability first; if missing, ASK the user before installing
- VS Code + Wokwi plugin users use Mode B — playwright is never needed

#### Mode A: Browser Automation (on-demand)

Only used when the user asks for auto browser simulation, or when no VS Code Wokwi plugin is available.

**Two paths (primary → fallback):**

**Path 1 (PRIMARY): Playwright MCP** — the standard way for non-IDE agents (WorkBuddy, Kimi, Cline, etc.).
- Works on any agent that supports MCP — no node/npm needed.
- Follow the step-by-step operations in **`references/monaco-steps.md`**:
  `browser_navigate` → wait Monaco → `browser_evaluate` (setValue) → switch diagram.json → click Start.
- If Playwright MCP is not configured, see the adapter's MCP setup section (e.g. WorkBuddy: `~/.workbuddy/mcp.json`).

**Path 2 (FALLBACK only): `wokwi-automate.js`** — a pre-built node script, **NOT the default**.
- Only consider when: agent can run commands, MCP is unavailable/unconfigured, AND the user explicitly wants automation.
- `node scripts/wokwi-automate.js <project-dir>`
- ⚠️ Requires `playwright` npm package — **NEVER install without explicit user approval** (HARD RULE).
- ⚠️ **Use REAL browser (non-headless)** — wokwi.com downgrades to read-only preview in headless mode. Do NOT pass `--headless`.
- The script does 5 steps (open → fill .ino → fill diagram.json → start simulation), then **waits for the user to manually close the browser window** (no auto-exit).
- **After the script returns** (user closed browser), ask the user to confirm the simulation result.
- **If simulation shows no behavior** (likely wokwi online-compile limits for unregistered users): suggest (a) manually clicking Start/Run to retry, (b) re-running, or (c) **skip simulation and verify on the physical board** (upload + wire test).
- **If the script fails (non-zero exit): DO NOT retry — switch to Path 1 (MCP operations in monaco-steps.md).**

> ⚠️ **Fallback nature:** Path 2 exists only for agents that can run commands but lack MCP. Prefer Path 1 whenever MCP is available.

#### Mode B: Manual (VS Code plugin — DEFAULT for VS Code users)

Tell the user: Press F1 → "Wokwi: Start Simulation" (VS Code). No extra dependencies needed.

### 4. Verify with User

Before simulation, present a **wiring text description** (generated from `diagram.json`):

```
📋 Wiring Summary (verify connections):
① LED anode (A) ← resistor r1 one end
② resistor r1 other end ← board <PIN> (e.g. ESP32 D2/GPIO2, or pin 13)
③ LED cathode (C) → board GND
④ ...(continue for each component)
```

Rules for the summary:
- Describe by component function, not just id ("LED anode" not "led1:A")
- State exact board pin (with D prefix for ESP32, e.g. D2/D15)
- Group by component; keep it short and human-readable
- Purpose: user verifies simulation AND uses it to wire physical hardware
  (compensates until wire-routing aesthetics are optimized)

Then ask: "Does the simulation show the expected behavior?"

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
# Remove stale old-structure dirs (uno renamed to arduino in v0.5)
if [ -d "references/uno" ]; then rm -rf references/uno; fi
for F in scripts/compile.sh scripts/wokwi-automate.js references/monaco-steps.md references/common/layout-rules.md references/common/breadboard.md references/common/waypoints.md references/common/sizes.json references/common/pins.json references/arduino/components.md references/arduino/index.json references/arduino/experience.json; do
  if [ ! -f "$F" ]; then
    echo "缺失 $F，正在从 GitHub 恢复..."
    mkdir -p "$(dirname "$F")"
    curl -fsSL "$BASE/$F" -o "$F"
  fi
done
```

**⚠️ If the skill directory has `core/` (old structure) instead of `scripts/` + `references/`, run `install.sh` again to migrate, or manually move files into the standard layout.**

**⚠️ v0.5 renamed `references/uno/` → `references/arduino/`. The self-heal above removes stale `references/uno/` and restores `references/arduino/` + `references/common/` from GitHub.**

---

## Version Check & Auto Update

Current version: **v0.4.6**
Repository: `https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git`

When activated, check the latest release:
```bash
curl -s --connect-timeout 3 https://api.github.com/repos/YuchengCai/Skill-HardwarEasySim-Wokwi/releases/latest | grep "tag_name"
```

If newer, ask user to update → `git clone + install.sh` (auto).

⚠️ **When executing the update via install.sh, always use `--global`** (unless the user explicitly wants project-only). The script auto-detects non-interactive environments and defaults to global, but passing `--global` explicitly is more reliable.

## Component Reference

### Lookup order (fast → accurate)

1. **`references/common/`** — system-level rules (any board/part):
   - `layout-rules.md` — read BEFORE generating diagram.json (style by component count, positioning, waypoint patterns)
   - `layout-cards.md` — per-component-type layout/wiring preference cards (LED↔resistor pairing, button opposite-side, etc.); read ONLY the cards for the parts actually used
   - `breadboard.md` — read when using a breadboard (pin naming, `$bb`, power rails, 孔位坐标系统, 轨坐标, 接线惯例)
   - `waypoints.md` — read when wiring with control points (v/h/* mini-language)
   - `sizes.json` — component canvas sizes (from wokwi-elements source; used by layout/detection scripts)
   - `pins.json` — component pin coordinates (from wokwi-elements source; used by wiring/detection scripts)
2. **`references/arduino/index.json`** — full catalog (52 components) with Chinese names (`zh`) and pins. Match user's Chinese description → `type` → pins. **Arduino series (Uno/Mega/Nano) share this catalog; board-specific pins are listed per board type.**
3. **`references/arduino/components.md`** — verified detailed manual for high-frequency components (pin tables, attributes, wiring examples).
4. **`references/arduino/experience.json`** — accumulated wiring patterns & layout tips (agent-learned). Reference it when generating `diagram.json`.
5. **`references/arduino/detail/<type>.json`** — per-component detail (auto-generated skeleton).
6. **`references/esp32/`** — ESP32 board reference + wiring differences (D-prefix pins, 3V3/5V, .bin firmware). Read when the project uses an ESP32 board.

### Breadboard (面包板) quick rules

- Types: `wokwi-breadboard` (full), `wokwi-breadboard-half` (half). Use breadboard when wiring many components together (>8 parts).
- Pins: `<row><t/b>.<col>` (component area, e.g. `bb1:13t.b`) and `<t/b><p/n>.<pos>` (power rails, e.g. `bb1:bp.25`).
- Component → breadboard: `["$bb"]` + empty color `""` (auto-routed, hidden wire).
- Power: component VCC/GND → breadboard rails; breadboard rails → board 5V/GND.
- Full details: see `references/common/breadboard.md`.

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

### Library-external parts (not in Wokwi)

For components not in the Wokwi library at all (RC522, MP3 modules, domestic sensors), generate a **placeholder** (pins + rectangle, no simulation behavior):

```bash
node scripts/generate-part-placeholder.js <name> <pin1> [pin2 ...]
```

Then add it to `diagram.json` as a `wokwi-custom-board`. Wiring is verifiable visually; behavior is NOT simulated — always pair with a text wiring plan and a physical-verification reminder.

### Layout & wiring quality

When generating `diagram.json`, consult `experience.json` `layout_tips` and existing `patterns`:
- Keep wires off the board and components (use waypoints `["h<offset>","v<offset>"]`)
- Place components near their target pins (above or to the right)
- Standard color coding: red = power, black = GND, others = signals

## Board Support

**Supported (compile + auto-inferred FQBN):**
- `wokwi-arduino-uno` → `arduino:avr:uno` (default, wiring verified)
- `wokwi-arduino-mega` → `arduino:avr:mega` (auto-inferred by compile.sh)
- `wokwi-arduino-nano` → `arduino:avr:nano` (auto-inferred by compile.sh)
- `wokwi-esp32-devkit-v1` → `esp32:esp32:esp32` (auto-inferred; core auto-installs via CN mirror)

`compile.sh` reads `diagram.json`, finds the board part, and auto-infers the FQBN (override with `--fqbn`). ESP32 core installs automatically using the official China mirror (no VPN needed). Wiring experience (`experience.json`) is Uno-based; Mega/Nano/ESP32 pin data exists in `references/arduino/index.json` (`verified: false`, needs testing).

**Future:** Pico.

## Environment Dependencies

| Dependency | Required For | Install |
|-----------|-------------|---------|
| `arduino-cli` | Compile + upload | Auto via compile.sh |
| `playwright` npm package | Browser automation script | Only after user approval |
| Playwright MCP | Native Monaco fallback | Only after user approval |
| VS Code + Wokwi ext | Manual simulation | Manual |

### Auto data directory selection (Windows)

On Windows, `compile.sh` checks disk space on first run:
- If C: has < 20GB free AND another drive has more space → auto-configures cores/libraries to the roomiest drive (`<drive>:/tool/arduino-data`)
- Skips if already configured or C: has enough space
- macOS/Linux: uses default `~/.arduino15/` (no action needed)

### Customizing arduino-cli data directory (optional)

Cores & libraries (can reach several GB with ESP32) install to `~/.arduino15/` (or `%LOCALAPPDATA%\Arduino15`) by default. To relocate to a larger drive (e.g. `D:\tool\arduino-data`):

```bash
arduino-cli config set directories.data "D:/tool/arduino-data"
arduino-cli config set directories.downloads "D:/tool/arduino-downloads"
arduino-cli config set directories.user "D:/tool/arduino-user"
# Migrate existing data, then verify: arduino-cli core list
```

`compile.sh` calls `arduino-cli`, which reads this config automatically — no PATH changes needed (arduino-cli itself is already detected/added to PATH by compile.sh).
