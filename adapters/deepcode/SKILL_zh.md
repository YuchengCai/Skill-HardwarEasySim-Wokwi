---
name: wokwi-arduino
description: 创建、编译和仿真 Arduino 项目（Wokwi）。当用户提到 Arduino、Wokwi、单片机、嵌入式，或项目中检测到 .ino / wokwi.toml / diagram.json 时激活。也可通过 @wokwi 或 #arduino 显式触发。
---

# Arduino Wokwi 仿真 Skill

在 Wokwi（VS Code 扩展或 wokwi.com）中创建、编译和仿真 Arduino 项目。

## 激活条件

- **关键词**: arduino, wokwi, uno, 单片机, 嵌入式, blink, LED, 传感器
- **文件检测**: `.ino`、`wokwi.toml`、`diagram.json`
- **显式触发**: 用户消息含 `@wokwi`、`#wokwi`、`@arduino`、`#arduino`

## 项目结构

```
project/
├── project.ino        # Arduino 代码
├── diagram.json       # 电路图（parts + connections）
└── wokwi.toml         # [wokwi] version=1 firmware='...'
```

## ⚠️ 电源引脚连接写法（核心知识）

这是 Wokwi 仿真中**最容易出错**的地方。以下是经过实测验证的写法：

| 引脚 | 正确写法 | 说明 |
|------|---------|------|
| GND | `"uno:GND.1"` | **必须带 `.1`**，否则线不显示 |
| 5V | `"uno:5V"` | **不带后缀** |
| 3.3V | `"uno:3.3V"` | **小数点格式**，`3V3` 不行 |
| VIN | `"uno:VIN"` | 不带后缀 |

### 常见错误

```json
// ❌ 错误写法
["led1:C", "uno:GND", "black", []]     // GND 缺 .1 → 线不可见
["r1:1", "uno:5V.1", "red", []]        // 5V 多 .1 → 线不可见
["r1:1", "uno:3V3", "orange", []]      // 3V3 写法 → 线不可见

// ✅ 正确写法
["led1:C", "uno:GND.1", "black", []]
["r1:1", "uno:5V", "red", []]
["r1:1", "uno:3.3V", "orange", []]
["r1:1", "uno:VIN", "purple", []]
```

## 模板列表

位于 `references/uno/`：

| 模板 | 说明 |
|------|------|
| `blink` | LED 闪烁（标准 GND.1 写法） |
| `led-switch` | 按钮控制 LED 开关 |

## 操作指引

### 1. 创建项目

```bash
./scripts/create-project.sh <项目名> [模板名]
```

或手动创建三个文件。

### 2. 编写 diagram.json

**Parts** 定义元件：
```json
{ "type": "wokwi-arduino-uno", "id": "uno", "top": 0, "left": 0, "attrs": {} }
{ "type": "wokwi-led", "id": "led1", "top": -50, "left": 350, "attrs": { "color": "red" } }
{ "type": "wokwi-resistor", "id": "r1", "top": -30, "left": 250, "attrs": { "resistance": "220" } }
{ "type": "wokwi-pushbutton", "id": "btn1", "top": 100, "left": 280, "attrs": {} }
```

**Connections** 定义连线：
```json
["uno:13", "r1:1", "green", []]
// 格式: [from, to, WireColor, Options]
```

### 3. 配置 wokwi.toml

```toml
[wokwi]
version = 1
# 直接编译模式
firmware = 'project.ino'
# 或预编译 .hex 模式
# firmware = 'build/project.ino.hex'
```

### 4. 运行仿真

**VS Code 扩展**: F1 → "Wokwi: Start Simulation"
**wokwi.com**: 上传项目文件夹，点击运行

### 编译（预编译 .hex 模式）

```bash
arduino-cli compile --fqbn arduino:avr:uno --output-dir build/ sketch.ino
# 或
./scripts/compile.sh <项目目录>
```

## 常用元件参考

更多 Wokwi 元件: https://docs.wokwi.com/parts/

## 扩展板型

当前仅支持 Arduino Uno。后续可添加:
- `references/mega/` — Arduino Mega 2560
- `references/esp32/` — ESP32
- `references/pico/` — Raspberry Pi Pico

每个板型需在对应目录的 README.md 中记录其引脚连接写法。
