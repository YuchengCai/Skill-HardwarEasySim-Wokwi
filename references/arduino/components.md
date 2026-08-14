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

### Wiring recommendation (avoid crossing)

Connect signal on one side, GND on the OPPOSITE side — prevents wires crossing above the button:

```json
["uno:2", "btn1:1.l", "yellow", ["v-70"]],   // signal from left
["btn1:2.r", "uno:GND.1", "black", ["v-120", "h-20"]]  // GND from right (opposite side)
```

Using `2.l` (same side as signal) makes both wires exit the same side → they cross. Prefer `2.r` for GND.

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

## Wire Routing & Layout (see common reference)

- **Waypoints / 控制点格式**: see `../common/waypoints.md` (official wokwi wire placement mini-language)
- **Layout Rules / 布局规则**: see `../common/layout-rules.md` (style by component count, positioning, waypoint patterns)
- **Breadboard / 面包板**: see `../common/breadboard.md` (pin naming, `$bb` instruction, power rails)

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
