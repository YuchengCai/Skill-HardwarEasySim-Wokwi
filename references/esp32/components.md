# ESP32 Components — Wiring Differences from Arduino

> ESP32 与 Arduino 的元件接线差异（基于 21 个真实项目 + 测试验证）。
> 通用元件接线（LED/电阻/按钮）见 `../arduino/components.md`，此处只列差异。

## LED (verified)

Same circuit as Arduino, but use D-prefix pins and 3V3/GND:

```json
["esp:D2", "r1:1", "green", []],
["r1:2", "led1:A", "red", []],
["led1:C", "esp:GND.1", "black", []]
```

- Anode → resistor → digital pin (D-prefix!)
- Cathode → GND (use `GND.1` or `GND.2`)

## Push Button (verified)

```json
["esp:D15", "btn1:1.l", "yellow", []],
["btn1:2.l", "esp:GND.1", "black", []]
```

- Same wiring as Arduino, D-prefix pins only

## I2C devices (OLED, etc.)

- ESP32 I2C pins: `D21` (SDA) / `D22` (SCL) on classic ESP32
- Use 3V3 for power (not 5V) — most I2C breakout boards are 3.3V compatible

## 3.3V vs 5V devices (warning)

| Device type | Power | Notes |
|-------------|-------|-------|
| 3.3V logic (most sensors) | `3V3` | Safe, direct |
| 5V logic (some modules) | `5V` + level shifter | 5V signals damage ESP32 pins |

## Firmware note

ESP32 → `.bin` firmware in wokwi.toml (NOT `.hex`). compile.sh handles this.
