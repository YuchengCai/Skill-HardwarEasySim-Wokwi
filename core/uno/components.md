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

The optional 4th element controls how the wire is routed:

| Waypoint | Meaning |
|----------|---------|
| `"h<num>"` | Horizontal offset (positive = right, negative = left) |
| `"v<num>"` | Vertical offset (positive = down, negative = up) |

These tell the auto-router which direction to go first before turning, helping keep wires off the board and other components.

### Layout Guidelines

1. Place components near their target pins — above or to the right
2. Use waypoints to route wires around the board edge, not across it
3. If crossing the board is unavoidable, keep the path short
4. Avoid routing wires over pin labels

---

## For Components Not Listed Here

If the component you need is not in this reference:

1. Open wokwi.com in the browser
2. Create a new Arduino Uno project
3. Add the component via the visual editor
4. Copy the generated `diagram.json` output
5. Add the entry to this file for future use (one entry = one JSON block)
