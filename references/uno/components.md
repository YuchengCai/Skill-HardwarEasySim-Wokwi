# Wokwi Component Reference — Arduino Uno

This manual is read by the AI agent when it encounters an unfamiliar component.
It contains only empirically verified pin names, attributes, and connection patterns.

---

## wokwi-arduino-uno — Arduino Uno Board

### Power Pins (Critial — must use correct naming)

| Pin | diagram.json Name | Note |
|-----|------------------|------|
| GND | `uno:GND.1` | Must include `.1`, otherwise wire invisible |
| GND (alt) | `uno:GND.2`, `uno:GND.3` | Other GND pins on the board |
| 5V | `uno:5V` | No suffix — `uno:5V.1` makes wire invisible |
| 3.3V | `uno:3.3V` | Decimal format — `uno:3V3` fails |
| VIN | `uno:VIN` | No suffix, works correctly |

### Digital Pins

| Pin | Name |
|-----|------|
| 0-13 | `uno:0` through `uno:13` |
| Analog | `uno:A0` through `uno:A5` |
| PWM | `uno:3`, `uno:5`, `uno:6`, `uno:9`, `uno:10`, `uno:11` |

---

## wokwi-led — LED

### Pins

| Pin | Description |
|-----|-------------|
| `led1:A` | Anode (positive leg, typically longer) |
| `led1:C` | Cathode (negative leg, typically shorter, flat side) |

### Attributes

```json
{ "type": "wokwi-led", "id": "led1", "top": 0, "left": 0, "attrs": { "color": "red" } }
```

| Attribute | Values | Default |
|-----------|--------|---------|
| `color` | `red`, `green`, `yellow`, `blue`, `white` | `red` |

### Example — Basic LED connection

```json
["uno:13", "r1:1", "green", ["v-86.4"]],
["r1:2", "led1:A", "red", ["h0"]],
["led1:C", "uno:GND.1", "black", ["v0"]]
```

---

## wokwi-resistor — Resistor

### Pins

| Pin | Description |
|-----|-------------|
| `r1:1` | Terminal 1 |
| `r1:2` | Terminal 2 |

### Attributes

```json
{ "type": "wokwi-resistor", "id": "r1", "top": 0, "left": 0, "attrs": { "value": "220" } }
```

⚠️ Use `"value"`, NOT `"resistance"` — Wokwi does not recognize the latter.

| Attribute | Values | Default |
|-----------|--------|---------|
| `value` | Any resistance in Ω: `"220"`, `"1000"`, `"10000"` | `"1000"` |
| `rotate` | `270` for vertical | — |

### Example — Vertical resistor

```json
{
  "type": "wokwi-resistor",
  "id": "r1",
  "top": -63.8,
  "left": 123.95,
  "rotate": 270,
  "attrs": { "value": "1000" }
}
```

---

## wokwi-pushbutton — Push Button

### Pins

⚠️ Do NOT use `btn1:1`, `btn1:2` — these are not the correct names for Wokwi diagram.json.

| Pin | Description |
|-----|-------------|
| `btn1:1.l` | Left terminal, row 1 |
| `btn1:1.r` | Right terminal, row 1 |
| `btn1:2.l` | Left terminal, row 2 |
| `btn1:2.r` | Right terminal, row 2 |

The two `.l` pins are internally connected; the two `.r` pins are internally connected. Pressing the button connects row 1 to row 2.

### Attributes

```json
{ "type": "wokwi-pushbutton", "id": "btn1", "top": 0, "left": 0, "attrs": {} }
```

No special attributes needed.

### Example — Button controlling LED

```json
["uno:2", "btn1:1.l", "yellow", []],
["btn1:2.l", "uno:GND.1", "black", []]
```

---

## Wire Routing — Connection Format

```json
["from:pin", "to:pin", "color", ["h<offset>", "v<offset>"]]
```

### Colors

Common wire colors: `green`, `red`, `black`, `yellow`, `blue`, `orange`, `purple`, `white`.

### Waypoints (4th array element)

The optional 4th element controls how the wire is routed (official wokwi format):

| Waypoint | Meaning |
|----------|---------|
| `"h<num>"` | Horizontal move (pixels, positive = right, negative = left) |
| `"v<num>"` | Vertical move (pixels, positive = down, negative = up) |
| `"*"` | Separator: instructions BEFORE `*` apply from source pin; AFTER `*` apply from target pin (in reverse) |

The simulator connects the remaining distance with orthogonal (horizontal/vertical) segments automatically. Wires never go diagonally.

### Layout Guidelines

1. Place components near their target pins — above or to the right
2. Use waypoints to route wires around the board edge, not across it
3. If crossing the board is unavoidable, keep the path short
4. Avoid routing wires over pin labels
5. Typical pattern (board below, parts above): `["v-<N>", "*", "h<±N>"]` — exit the pin vertically, then approach target horizontally

---

## Layout Rules — Board Layout Guidelines (v0.5)

Simple layout rules for generating a clean `diagram.json` (verified from 18+ real wokwi projects).

### Rule 1: Choose wiring style by component count

| Component count | Style | Notes |
|-----------------|-------|-------|
| ≤ 6 parts | Direct (直连) | Parts around board, visible wires |
| > 8 parts | Breadboard (面包板) | Use breadboard to organize (see breadboard section) |
| 6-8 | Either | Judge by complexity |

### Rule 2: Position parts around the board

- Place parts ABOVE or to the SIDES of the board (not on top of it)
- Keep distance from board: 100-500px (enough for wire routing)
- Minimum spacing between parts: ≥ 30 units (prevent overlap)
- Group related parts together (button near its LED)

### Rule 3: Use clean waypoint pattern

- Source pin exits vertically first: `["v-<N>", "*", "h<±N>"]`
  (N = exit distance, small for near parts, larger for far parts)
- Target side approaches horizontally with small adjust (±6-10px)
- Keep waypoints simple — complex multi-segment paths look messy

### Rule 4: Power connections

- Direct style: part VCC/GND → board 5V/GND directly
- Breadboard style: part VCC/GND → breadboard rails → board 5V/GND
- Red wire for VCC/5V, black for GND (consistent convention)

### Rule 5: Avoid common mistakes

- Don't place parts overlapping the board (blocks pins)
- Don't route wires across the board surface (blocks pin labels)
- Don't scatter related parts far apart (unclear function grouping)

---

## wokwi-breadboard / wokwi-breadboard-half — Breadboard

Verified from 8 real wokwi projects. Used when multiple components need convenient wiring (real-world prototyping pattern).

### Component types

| Type | Notes |
|------|-------|
| `wokwi-breadboard` | Full-size breadboard |
| `wokwi-breadboard-half` | Half-size breadboard (common in projects) |

### Pin naming system (cross-project consistent)

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

### Connection patterns (verified)

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

### Layout rules (breadboard projects)

1. Components are plugged INTO the breadboard (not scattered around board)
2. Board often rotated (`"rotate": 90`) for compact breadboard wiring
3. Power architecture: component VCC/GND → breadboard rails; breadboard rails → board 5V/GND
4. Use `["$bb"]` + empty color for component-to-breadboard connections (auto-routed, hidden)
5. Only power/signal wires between breadboard and board are visible (with waypoints)

---


## wokwi-dht22 — Temperature & Humidity Sensor (DHT22/DHT11)

### Pins

| Pin | Description |
|-----|-------------|
| `dht1:VCC` | Power (5V) |
| `dht1:SDA` | Data line (single-wire protocol) |
| `dht1:NC` | Not connected |
| `dht1:GND` | Ground |

### Example — DHT22 to pin 2

```json
["dht1:VCC", "uno:5V", "red", []],
["dht1:GND", "uno:GND.1", "black", []],
["dht1:SDA", "uno:2", "green", []]
```

Use library "DHT sensor library" (`arduino-cli lib install "DHT sensor library"`), read interval ≥ 2s.

---

## wokwi-ssd1306 — OLED Display 128x64 (I2C!)

### ⚠️ Interface: I2C ONLY in simulation

The wokwi-ssd1306 part simulates **I2C mode only**. DC/RST/CS pins are SPI mode but NOT functional in simulation.

### Pins

| Pin | Description | Uno Pin |
|-----|-------------|---------|
| `oled1:DATA` | I2C SDA | **A4** |
| `oled1:CLK` | I2C SCL | **A5** |
| `oled1:VIN` | Supply (5V) | 5V |
| `oled1:GND` | Ground | GND.1 |
| DC/RST/CS | SPI-only, not simulated | — |

### Example — I2C OLED

```json
["oled1:VIN", "uno:5V", "red", []],
["oled1:GND", "uno:GND.1", "black", []],
["oled1:DATA", "uno:A4", "green", []],
["oled1:CLK", "uno:A5", "yellow", []]
```

```cpp
Adafruit_SSD1306 display(128, 64, &Wire, -1);
display.begin(SSD1306_SWITCHCAPVCC, 0x3C);  // address 0x3C
```

⚠️ **Hardware note**: physical OLED comes in I2C (4-pin) and SPI (7-pin) versions. If the user's physical part is SPI, wiring/code differ AND simulation won't show the display (simulator limitation, not a bug). See SKILL.md "Hardware Check".

---

## For Components Not Listed Here

If the component you need is not in this reference:

1. Open wokwi.com in the browser
2. Create a new Arduino Uno project
3. Add the component via the visual editor
4. Copy the generated `diagram.json` output
5. Add the entry to this file for future use (one entry = one JSON block)
