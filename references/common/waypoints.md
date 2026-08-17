# Waypoints — Wire Placement Mini-Language

> 系统级通用连线控制点格式（官方 wokwi 文档确认，适用于所有板型）。

## Connection format

```json
["from:pin", "to:pin", "color", ["waypoint", ...]]
```

4th element (optional) controls wire routing. Wires always go straight lines, horizontal or vertical, never diagonal.

## Instructions (official wokwi format)

| Instruction | Meaning |
|-------------|---------|
| `"v<N>"` | Move vertically N pixels (positive = down, negative = up) |
| `"h<N>"` | Move horizontally N pixels (positive = right, negative = left) |
| `"*"` | Separator — instructions BEFORE `*` apply from source pin (in order); AFTER `*` apply from target pin (in reverse order) |

## Examples

```json
["v10", "h5", "*", "v-15", "h10"]
```

- `v10` = from source pin, move 10px down
- `h5` = then 5px right
- `*` = separator
- `h10` = from target pin, 10px right (reverse order: h10 then v-15)
- `v-15` = then 15px up
- Simulator connects the two ends with orthogonal segments (remaining distance, auto-routed)

## Typical clean pattern

```json
["v-<N>", "*", "h<±N>"]
```

- Source exits vertically (e.g. `v-30` = up 30px, leaving the board)
- Target approaches horizontally (small adjust ±6-10px)
- Board below, parts above → negative v (up); board above, parts below → positive v

## Board pin side rule (critical, verified from real user wiring)

**Board pins are on TWO sides — exit direction depends on WHICH side the pin is on:**

```
Arduino Uno standard layout (no rotation):
  【数字侧 Digital side】pin 0-13 → board TOP → exit UP first (v-)
  【电源/模拟侧 Power/Analog side】5V/GND/3V3/VIN/A0-A5 → board BOTTOM → exit DOWN first (v+)

Verified from real wiring:
  ["uno:13", ...]  → ["v-144", ...]  (digital, up)
  ["uno:7", ...]   → ["v-115", ...]  (digital, up)
  ["uno:5V", ...]  → ["v47.9", ...]  (power, down)
  ["uno:GND.2", ...] → ["v19.1", ...] (power, down)
  ["uno:A4", ...]  → ["v76.7", ...]  (analog, down)
```

**Mistake to avoid**: a 5V/GND wire exiting UP crosses the board surface (covers it). Always exit on the pin's own side.

**Rotation follows the board:**
- rotate 90 → digital side on RIGHT → exit RIGHT first (h+)
- rotate 180 → digital side on BOTTOM → exit DOWN first (v+)
- rotate 270 → digital side on LEFT → exit LEFT first (h-)

## Intermediate nodes (1-2 between board and target)

Do NOT go straight from board pin to component center. Add 1-2 intermediate waypoints:

```json
["v-60", "h120", "v-80"]   // exit up → move right → reach target height
```

Pattern: exit on own side → move horizontally to target column → vertical to target → small adjust. This keeps wires clear of other components.

## Special instruction: `$bb` (breadboard)

```json
["led1:A", "bb1:7t.b", "", ["$bb"]]
```

`["$bb"]` = auto-route to breadboard (wokwi connects the pin to the breadboard hole). Use with empty color `""` (hidden wire). See `breadboard.md`.

## Rules

1. Omit 4th element = auto-routing (simulator decides, may look messy)
2. Keep waypoints simple: 1-3 instructions per side
3. Complex multi-segment paths look messy — prefer clean exit + approach
4. Empty color `""` hides the wire (used with `$bb`)

## Minimal waypoints（避免末端微小折角）

实测教训：末尾多余的 `"v0"` 或 <0.5px 的微小 `"h"` 会让 Wokwi 在端点渲染出「折回/绕圈」小钩子（放大可见）。

- 非错开线只写必要段：`["v<dy>"]`，或 dx 明显时才 `["v<dy>","h<dx>"]`
- **不要尾随 `"v0"`**；`|dx|<0.5` 的水平段省略，让 Wokwi 的自动收尾吸收亚像素偏差
- 只有多线共点需要错开时，才保留 Z 形三段 `["v..","h..","v.."]`
