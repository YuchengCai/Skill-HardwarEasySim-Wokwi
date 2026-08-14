# ESP32 Board Reference

> ESP32 板卡信息与接线规则（基于 21 个真实 wokwi ESP32 项目验证 + 已有测试）。
> 通用规则（布局/面包板/控制点）见 `../common/`；元件接线差异见 `components.md`。

## Supported boards (wokwi)

| Type | Notes |
|------|-------|
| `wokwi-esp32-devkit-v1` | Classic ESP32 DevKit (verified in skill tests) |
| `board-esp32-devkit-c-v4` | DevKit C v4 (common in community projects) |
| `board-esp32-c3-devkitm-1` | ESP32-C3 (RISC-V, different pin set) |
| `board-xiao-esp32-c3/c6/s3` | Seeed XIAO series (compact) |
| `board-esp32-s3-devkitc-1` | ESP32-S3 DevKit |

## Pin naming (critical!)

**Digital pins use D prefix** (verified from real projects + tests):

```json
["esp:D2", "r1:1", "green", []]   // ✅ correct
["esp:2", "r1:1", "green", []]    // ❌ WRONG — wire won't connect
```

Common digital pins: `D2`, `D4`, `D5`, `D13`, `D14`, `D15`, `D18`, `D19`, `D21`, `D22`, `D23`, `D25`, `D26`, `D27`, `D32`, `D33`, `D34`, `D35`

## Power pins (from 21-project analysis)

| Pin | Usage | Notes |
|-----|-------|-------|
| `GND.1` | Ground (most common, 74x) | Also `GND` (49x), `GND.2` (22x), `GND.3/4/8` |
| `3V3` | 3.3V power (20x) | **ESP32 is 3.3V logic** — sensors/external parts should be 3.3V-compatible |
| `5V` | 5V output (19x) | For 5V parts; NOT for logic signals (would damage 3.3V pins) |
| `VIN` | External power input (1x) | 5V from USB/external |

**Level warning**: ESP32 pins are 3.3V. Connecting 5V logic signals directly can damage the board — use level shifters for 5V devices.

## Firmware format

**ESP32 compiles to `.bin`, NOT `.hex`** (AVR boards produce `.hex`):

```toml
[wokwi]
version = 1
firmware = 'build/project.ino.bin'   # ← .bin for ESP32
```

`compile.sh` handles this automatically (inferred from FQBN `esp32:esp32:esp32`).

## Core installation

ESP32 needs the `esp32:esp32` core (large, ~6GB installed). `compile.sh` auto-installs via the official China mirror (no VPN needed):

```
arduino-cli config add board_manager.additional_urls "https://espressif.github.io/arduino-esp32/package_esp32_dev_index_cn.json"
```
