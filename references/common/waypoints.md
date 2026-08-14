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
