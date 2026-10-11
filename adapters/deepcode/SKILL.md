---
name: wokwi-arduino
description: Create, compile, simulate, and upload Arduino projects with Wokwi (VS Code extension, wokwi.com browser automation, or web editor). Use when the user mentions Arduino, Wokwi, 单片机, 嵌入式, or when .ino / wokwi.toml / diagram.json files are detected. Explicitly activate with @wokwi, #arduino, or @simulate.
---

# Arduino Wokwi Simulation Skill (v0.5.7)

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
2. Look up every component you intend to use: **`references/arduino/index.json`** (Chinese-name match) → **`references/arduino/components.md`** → `detail/<type>.json`
3. Write **`layout-intent.json`** — semantic layout intent, **NO coordinates**:
   - Read **`references/common/intent-format.md`** for the field contract (board / parts / groups / connections / hint)
   - Read **`references/common/layout-cards/index.md`**, then ONLY the card(s) for the parts actually used
   - `groups[]`: assign `zone` (output/input/sensor/display/misc); `parts[].hint.order` for symmetric parts (buttons/LEDs left-right)
   - `connections[]`: the netlist (who connects to whom, which pin)
   - `breadboard`: 通常留空即可——脚本会自动兜底 bus 场景（>8 parts 或多元件共用 VCC/GND 时自动配面包板）；只有当你明确要面包板/直连时才显式设置（判据见 `references/common/layout-rules.md` Rule 1）
4. Generate `diagram.json` from intent (the script computes coordinates/geometry):
   ```bash
   node scripts/layout-generator.js layout-intent.json <project-dir>
   ```
5. Generate `wokwi.toml` pointing to `build/project.ino.hex`
6. **Run the wiring checker** to detect conflicts before simulating:
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

### 3. Simulate — Tool-face detection + degradation tree

**Detect the tool face, take the first reachable branch — no dead ends:**

```
0. VS Code + Wokwi extension                 → Mode B (F1, zero deps)
1. Playwright MCP tools (browser_navigate…)  → Mode A·Path 1 (primary)
2. no MCP; node + playwright installed,
   or user approves install                  → Mode A·Path 2 (wokwi-automate.js)
3. built-in browser (Computer Use class)     → light ops only; ≥2 failures → branch 4
   (Wokwi is UI-heavy: snapshot/JS timeouts are common — never grind)
4. none reachable                            → Mode C (manual import delivery)
```

**⚠️ HARD RULE: NEVER install playwright (or any npm package) without explicit user approval.** No MCP + no playwright + user declines → go straight to Mode C — no dead ends.

#### Mode A: Browser Automation

**Path 1 (PRIMARY): Playwright MCP** — standard for non-IDE agents (WorkBuddy, Kimi, Cline…). Any MCP-capable agent, no node/npm.
- Follow **`references/monaco-steps.md`**: `browser_navigate` → wait Monaco → `browser_evaluate` (setValue) → switch diagram.json → **user clicks Start (never auto-click — unlogged users get no compute quota)**.
- MCP not configured → see the adapter's MCP setup section (e.g. WorkBuddy: `~/.workbuddy/mcp.json`).

**Path 2 (FALLBACK only): `wokwi-automate.js`** — only for agents that run commands but have no MCP.
- `node scripts/wokwi-automate.js <project-dir>` — requires `playwright` npm (HARD RULE above applies).
- REAL browser only (non-headless; wokwi.com downgrades headless to read-only). Do NOT pass `--headless`.
- Script: open → fill .ino → fill diagram.json → **remind user to click Start** → waits for user to close the browser. After return, ask the user to confirm the result.
- No visible behavior (wokwi online-compile limits) → user retries Start, or verify on the physical board (upload + wire test).
- Script fails (non-zero exit) → DO NOT retry → Path 1 steps (monaco-steps.md), else Mode C.

#### Mode B: Manual (VS Code plugin — DEFAULT for VS Code users)

Tell the user: Press F1 → "Wokwi: Start Simulation" (VS Code). No extra dependencies needed.

#### Mode C: Manual import delivery (terminal fallback — FIRST-CLASS deliverable)

Always reachable; the standard exit when automation fails or tools are missing. The workflow delivers a **`web-import/` three-file set** as a standard output (produce it in this step):

```
web-import/sketch.ino      merged full sketch (all tabs concatenated)
web-import/diagram.json    generated circuit
web-import/libraries.txt   third-party libraries
```

Tell the user: ① open `wokwi.com/projects/new`; ② replace the sketch with `web-import/sketch.ino`; ③ switch to diagram.json, replace with `web-import/diagram.json`; ④ add libraries from `libraries.txt`; ⑤ click **Start Simulation** yourself. Then ask the verification question (section 4).

**⚠️ HARD RULE (Verification gate): visual verification is satisfied ONLY by Wokwi itself (browser / CLI / VS Code plugin).** Self-drawn artifacts (netlist→SVG, hand-rendered previews) may serve as auxiliary documentation but **must NEVER appear in a verification conclusion**. Gate unreachable → deliver honestly as **UNVERIFIED** + Mode C. Never fabricate verification.

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
5. **Derivable rules belong in scripts, not SKILL.md.** 凡脚本能确定性推导的（B 值：part 数、bus 场景、坐标、孔位、走线），脚本兜底，不前置进 SKILL.md、也不让模型逐条记。SKILL.md 只放「原则 + 指向」和「真选择（C 值）的指引」——防止 SKILL.md 退化成规则清单。
6. **Design choices (C 值) belong to the model — scripts default + warn, never silently override.** 有多种合理权衡的选择（按钮对侧/同侧、zone/region、引脚分配）由模型思考；脚本做"默认兜底 + 显式覆盖"（如按钮默认对侧、hint.sameSide 显式省线），只提醒后果、不替模型决定。

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
for F in scripts/compile.sh scripts/wokwi-automate.js scripts/run-tests.js references/monaco-steps.md references/common/layout-rules.md references/common/generic-wiring.md references/common/layout-cards/index.md references/common/layout-cards/led.md references/common/layout-cards/resistor.md references/common/layout-cards/pushbutton.md references/common/layout-cards/dht22.md references/common/layout-cards/oled.md references/common/layout-cards/buzzer.md references/common/breadboard.md references/common/waypoints.md references/common/intent-format.md references/common/geometry.json references/common/boards.json references/common/sizes.json references/common/pins.json references/arduino/components.md references/arduino/index.json references/arduino/experience.json; do
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

Current version: **v0.5.7**
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
   - `intent-format.md` — the layout-intent.json field contract (read BEFORE writing intent; 分区/zone/region/hint 语义)
   - `layout-rules.md` — read BEFORE generating diagram.json (style by component count, positioning, waypoint patterns)
   - `layout-cards/index.md` — index of per-component preference cards; then read ONLY the card(s) for the parts actually used
   - `generic-wiring.md` — fallback for components NOT in layout-cards (identify pins → classify → generic rules)
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

For components not in the Wokwi library at all (RC522, MP3 modules, domestic sensors), generate a **placeholder** (custom chip: pins only, no simulation behavior):

When a required component is NOT in the Wokwi library at all (index.json 查不到):
1. **First check `placeholders/<name>/`** — if it already exists, reuse it (skip search, consistent shape). Before generating, **pause and let the user choose a mode**: Minimal mode (default; ships the generic empty wasm — wiring display only, part does not work) or Functional mode (write a full simulation wasm — works in simulation, but slow / token-heavy / may not fully reproduce the real part). Always default to Minimal mode unless the user explicitly asks for Functional mode.
2. If missing: **STOP and ask the user** for the exact brand/model (e.g. "RC522 RFID module" or the specific IC number), so you can search for its real pinout.
3. Search the web for the datasheet/pinout, extract the real pin names + count.
4. Generate the placeholder with those pins (see below).
5. The placeholder participates in layout + routing; wiring is verifiable visually, behavior is NOT simulated — always add a physical-verification reminder.

```bash
node scripts/generate-part-placeholder.js <name> <pin1> [pin2 ...]
```

Then add it to `diagram.json` as a `chip-<name>` part (custom chip, e.g. `chip-rc522`), and declare the chip in `wokwi.toml` (`[[chip]]` section). The generator also copies a generic empty `chip.wasm` (no simulation behavior, pins floating) so Wokwi can load the chip — wiring is verifiable visually; behavior is NOT simulated — always pair with a text wiring plan and a physical-verification reminder.

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
