# Breadboard — 面包板使用指南

> 系统级通用面包板知识（适用于所有板型）。
> 验证来源：8 个真实 wokwi 面包板项目（跨项目共识）。

## Component types

| Type | Notes |
|------|-------|
| `wokwi-breadboard` | Full-size breadboard |
| `wokwi-breadboard-half` | Half-size breadboard (common in projects) |

Use breadboard when wiring many components together (>8 parts) or for real-world prototyping patterns.

## Pin naming system (cross-project consistent)

```
Component area (元件区): <id>:<row><half>.<column>
  e.g. "bb1:13t.b" = row 13, top half (t), column b
  half: t = top row, b = bottom row
  column: a-j letters

Power rails (电源轨): <id>:<half><polarity>.<position>
  e.g. "bb1:bp.25" = bottom (b) positive (p) rail, position 25
       "bb1:bn.22" = bottom (b) negative (n) rail
       "bb1:tp.30" = top (t) positive (p) rail
       "bb1:tn.50" = top (t) negative (n) rail
```

## Connection patterns (verified)

**Pattern A — Component to breadboard (use `["$bb"]` + empty color):**

```json
["led1:A", "bb1:7t.b", "", ["$bb"]]
```

- `["$bb"]` = auto-route to breadboard (wokwi connects component pin to the breadboard hole)
- Empty color `""` = hidden wire (breadboard internal connection, no visual clutter)

**Pattern B — Power rails to board power:**

```json
["bb1:bp.25", "uno:5V", "red", ["v-0.9", "h78.4", "v-57.6"]]
["bb1:bn.25", "uno:GND.2", "black", ["v-1.3", "h88", "v-57.6"]]
```

- Breadboard positive rail → board 5V (red)
- Breadboard negative rail → board GND (black)

**Pattern C — Component power from breadboard rails:**

```json
["pir1:VCC", "bb2:bp.21", "red", ["v0"]]
["pir1:GND", "bb2:bn.21", "black", ["v0"]]
```

- Components draw power from breadboard rails (not directly from board)

**Pattern D — Breadboard to board signal (visible wire + waypoints):**

```json
["bb1:13t.b", "uno:13", "red", ["v-124.8", "h470.4", "v153.6"]]
```

## Layout rules (breadboard projects)

1. Components are plugged INTO the breadboard (not scattered around board)
2. Board often rotated (`"rotate": 90`) for compact breadboard wiring
3. Power architecture: component VCC/GND → breadboard rails; breadboard rails → board 5V/GND
4. Use `["$bb"]` + empty color for component-to-breadboard connections (auto-routed, hidden)
5. Only power/signal wires between breadboard and board are visible (with waypoints)
