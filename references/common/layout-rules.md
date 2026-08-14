# Layout Rules — Board Layout Guidelines

> 系统级通用布局规则（适用于所有板型/元件）。生成 `diagram.json` 时参考。
> 验证来源：18+ 真实 wokwi 项目（官方精选 + 社区）。

## Rule 1: Choose wiring style by component count

| Component count | Style | Notes |
|-----------------|-------|-------|
| ≤ 6 parts | Direct (直连) | Parts around board, visible wires |
| > 8 parts | Breadboard (面包板) | Use breadboard to organize (see `breadboard.md`) |
| 6-8 | Either | Judge by complexity |

## Rule 2: Position parts around the board

- Place parts ABOVE or to the SIDES of the board (not on top of it)
- Keep distance from board: 100-500px (enough for wire routing)
- Minimum spacing between parts: ≥ 30 units (prevent overlap)
- Group related parts together (button near its LED)

## Rule 3: Use clean waypoint pattern

- Source pin exits vertically first: `["v-<N>", "*", "h<±N>"]`
  (N = exit distance, small for near parts, larger for far parts)
- Target side approaches horizontally with small adjust (±6-10px)
- Keep waypoints simple — complex multi-segment paths look messy
- Full waypoint format: see `waypoints.md`

## Rule 4: Power connections

- Direct style: part VCC/GND → board 5V/GND directly
- Breadboard style: part VCC/GND → breadboard rails → board 5V/GND
- Red wire for VCC/5V, black for GND (consistent convention)

## Rule 5: Avoid common mistakes

- Don't place parts overlapping the board (blocks pins)
- Don't route wires across the board surface (blocks pin labels)
- Don't scatter related parts far apart (unclear function grouping)

## Wiring colors (convention)

Common wire colors: `green`, `red`, `black`, `yellow`, `blue`, `orange`, `purple`, `white`.
Convention: red = VCC/5V, black = GND, others = signals (distinguish by color).
Empty color `""` = hidden wire (e.g. `$bb` breadboard auto-routing).
