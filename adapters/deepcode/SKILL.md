---
name: wokwi-arduino
description: Create, compile, and simulate Arduino projects with Wokwi (VS Code extension or wokwi.com). Use when the user mentions Arduino, Wokwi, 单片机, 嵌入式, or when .ino / wokwi.toml / diagram.json files are detected. Explicitly activate with @wokwi or #arduino.
---

# Arduino Wokwi Simulation Skill (v0.2.6)

Create, compile, simulate, and upload Arduino projects using Wokwi.

## How This Skill Works

This skill is intentionally lightweight. Component pin names, attributes, and connection patterns are in **`core/uno/components.md`** — read that file when you encounter an unfamiliar component.

## Activation Triggers

- **Keywords**: arduino, wokwi, uno, microcontroller, 单片机, 嵌入式, blink, LED, sensor, servo
- **File detection**: `.ino`, `wokwi.toml`, `diagram.json` in workspace
- **Explicit**: user message contains `@wokwi`, `#wokwi`, `@arduino`, `#arduino`

## Project Structure

```
project/
├── project.ino        # Arduino sketch (C++)
├── diagram.json       # Circuit diagram
└── wokwi.toml         # [wokwi] version=1 firmware='build/project.ino.hex'
```

## Full Workflow (Compile → Simulate → Upload)

### 1. Generate Code & Circuit

1. Write the `.ino` sketch code
2. Open **`core/uno/components.md`** — look up every component you intend to use
3. Generate `diagram.json` with correct pin names and wiring
4. Generate `wokwi.toml` pointing to `build/project.ino.hex`
5. Include a **blink sequence (3 times)** at the end of `setup()` as a "burn success" indicator

### 2. Compile

```bash
./core/scripts/compile.sh <project-dir>
```

Auto-installs `arduino-cli` + Uno core if missing. Direct `.ino` compilation is unreliable — always use pre-compiled `.hex`.

### 3. Run Simulation (User Action Required)

Tell the user to start the simulation:

```
Simulation ready! Press F1 in VS Code → "Wokwi: Start Simulation"
(or open wokwi.com and upload the project folder)
```

Then **ask the user**: "Does the simulation show the expected behavior?"

- If **yes** → proceed to upload
- If **no** → fix the code/diagram and recompile

### 4. Detect Connected Board

After user confirms simulation, run board detection:

```bash
arduino-cli board list
```

**Possible outcomes:**

| Output | Action |
|--------|--------|
| No boards found | Tell user: "Please connect your Arduino board via USB" → loop back |
| One board found | Auto-select it, note the port and FQBN |
| Multiple boards found | Show the list with port + board name, ask user: "Which board do you want to upload to?" |

Example output to show user:
```
[1] COM3 — Arduino Uno (arduino:avr:uno)
[2] COM5 — Arduino Mega (arduino:avr:mega)
```

### 5. Upload Firmware

```bash
arduino-cli upload -p <PORT> --fqbn <FQBN> <project-dir>
```

### 6. Post-Upload — Serial Monitor

After successful upload, run `compile.sh` with `--monitor` to automatically capture serial output:

```bash
./core/scripts/compile.sh <project-dir> --upload --port <PORT> --fqbn <FQBN> --monitor
```

This will:
1. Compile (if needed) and upload
2. Auto-capture 6 seconds of serial output and show in the conversation
3. Also print the command for real-time viewing in VS Code terminal

**Two ways to view serial output:**

| Method | How | Best for |
|--------|-----|----------|
| Auto-capture in conversation | `--monitor` flag | Quick check, no terminal needed |
| Real-time in VS Code terminal | Copy the printed `arduino-cli monitor -p <PORT>` command | Continuous monitoring |

---

## Wire Routing

The connections array supports routing waypoints to keep wires clean:

```json
["uno:13", "r1:1", "green", ["h0.4", "v-86.4"]]
```

Layout guidelines (see `components.md` for details):
- Place components near target pins
- Use waypoints to route around the board
- Keep paths short if crossing is unavoidable

## Component Reference

Read **`core/uno/components.md`** for all verified component pin names, attributes, and connection examples.

For components not yet in the reference, open wokwi.com in a browser, use the visual editor to place the component, and copy the generated `diagram.json` — then add the entry to `components.md` for future use.

---

## Version Check & Auto Update

Current version: **v0.2.6**
Repository: `https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git`

When this skill activates, check the latest release on GitHub:
```bash
curl -s --connect-timeout 3 https://api.github.com/repos/YuchengCai/Skill-HardwarEasySim-Wokwi/releases/latest | grep "tag_name"
```

If a newer version exists, ask the user:
> "有新版本 vX.X.X 可用，是否自动更新？"

If user agrees, execute:
```bash
git clone https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git /tmp/skill-update
cd /tmp/skill-update
bash install.sh
cd .. && rm -rf /tmp/skill-update
```

Then notify: "更新完成！请重启会话让新版本生效。"
