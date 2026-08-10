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
├── project.ino        # Arduino 代码（必须与文件夹同名）
├── diagram.json       # 电路图（parts + connections）
├── wokwi.toml         # [wokwi] version=1 firmware='build/project.ino.hex'
└── libraries.txt      # 可选：第三方库，每行一个
```

### wokwi.toml 正确格式（已验证）

```toml
[wokwi]
version = 1
firmware = 'build/<项目名>.ino.hex'
```

⚠️ **必须用 `[wokwi]` section** — 用 `[env]` / `[board]` 是错的，会报 "No [wokwi] section found"。

### libraries.txt（第三方库）

如果代码用到第三方库（DHT、Adafruit SSD1306、LiquidCrystal 等）：

1. 项目根目录创建 `libraries.txt`，**每行一个库名**（Arduino 库管理器搜索名）：
```
DHT sensor library
Adafruit SSD1306
```
2. **编译前**，用 arduino-cli 安装同名库：
```bash
arduino-cli lib install "DHT sensor library" "Adafruit SSD1306"
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

**仿真前/确认时，出示接线文字说明**（从 diagram.json 生成）：

```
📋 接线说明（对照检查）：
① LED 阳极(A) ← 电阻 r1 一端
② 电阻 r1 另一端 ← 板子引脚（如 ESP32 D2/GPIO2，或 pin13）
③ LED 阴极(C) → 板子 GND
④ ...（每个元件继续）
```

说明规则：
- 用元件功能名描述（"LED 阳极"而不是"led1:A"）
- 写清板子确切引脚（ESP32 带 D 前缀，如 D2/D15）
- 按元件分组，简短易读
- 用途：用户核对模拟 + 接实物时照着接线（在连线画法优化前弥补不足）

然后询问："模拟效果是否正确？"

### 编译（预编译 .hex 模式）

```bash
arduino-cli compile --fqbn arduino:avr:uno --output-dir build/ sketch.ino
# 或
./scripts/compile.sh <项目目录>
```

## 硬件核对（接实物前强制）

模拟验证通过后，用户要接实物时，**必须**：

1. **出示核对清单**：对比模拟元件 vs 用户实物（确认型号/版本）
2. **标注已知接口差异**：如 wokwi-ssd1306 只模拟 I2C 版，实物 OLED 可能是 SPI 版
3. **若实物与模拟不一致**（如 SPI 版 OLED）：
   - 说明差异，给两个选项：A) 重新生成匹配实物的代码/接线 B) 建议换成与模拟一致的元件
   - **⚠️ 重新生成前必须先说明预期**：新模拟可能出现不同/缺失的现象（如 SPI 接线时 OLED 模拟不显示，因为模拟器只支持 I2C）。这是**模拟器限制，不是代码错误/bug**。实物按新接线会正常工作，但模拟无法完整验证。
   - 重新生成后，若用户看到模拟异常，再次提醒："这是模拟器限制，不是代码错误——您的实物按新接线会正常工作"
4. 若实物与模拟一致 → 正常继续

## 常用元件参考

### 查询顺序（快到准）

1. **`references/uno/index.json`** — 全量目录（50 元件），含中文名（`zh`）和引脚。用中文描述匹配 → `type` → 引脚。
2. **`references/uno/components.md`** — 高频元件验证手册（引脚表、属性、接线示例）。
3. **`references/uno/experience.json`** — 累积的接线模式与布线技巧（agent 自学习）。生成 diagram.json 时参考。
4. **`references/uno/detail/<type>.json`** — 每个元件的详细条目（自动生成骨架）。

### 中文名匹配规则

- 用 `index.json` 的 `zh` 字段匹配用户描述（如"温湿度传感器" → `wokwi-dht22`）。
- **有歧义时（多个候选）**：列出候选询问用户，如"您说的显示屏，是 LCD1602 还是 OLED？"——禁止静默猜测。
- 用户直接说型号（DHT11/LCD1602/WS2812）→ 直接匹配。
- 索引表没有 → 询问用户具体型号，或用下方源码兜底。

### 源码兜底（极少用）

元件缺失或引脚不全时，从权威开源库获取：
```bash
curl -sL https://raw.githubusercontent.com/wokwi/wokwi-elements/main/src/<file>.ts
```
从源码提取 `pinInfo`。验证后记录到 `experience.json` 供以后参考。

### 布线质量

生成 diagram.json 时参考 `experience.json` 的 `layout_tips` 和已有 `patterns`：
- 线缆避开板子和元件（用 waypoints `["h<偏移>","v<偏移>"]`）
- 元件放在目标引脚附近（上方或右侧）
- 颜色规范：红色=电源，黑色=GND，其他=信号

## 板型支持

**已支持（编译 + 自动推断 FQBN）：**
- `wokwi-arduino-uno` → `arduino:avr:uno`（默认，接线经验已验证）
- `wokwi-arduino-mega` → `arduino:avr:mega`（compile.sh 自动推断）
- `wokwi-arduino-nano` → `arduino:avr:nano`（compile.sh 自动推断）
- `wokwi-esp32-devkit-v1` → `esp32:esp32:esp32`（自动推断；核心通过乐鑫官方中国镜像自动安装，无需科学上网）

compile.sh 会根据 diagram.json 的板子元件**自动推断 FQBN**（也可 --fqbn 覆盖）。接线经验（experience.json）目前主要基于 Uno；Mega/Nano/ESP32 引脚数据在 `references/uno/index.json` 中（verified: false，需实测验证）。

**未来可添加：**
- `references/pico/` — Raspberry Pi Pico

每个板型需在对应目录记录其引脚连接写法（实测验证后更新 verified）。

## 数据目录自动选择（Windows）

Windows 下 compile.sh 首次运行会检测磁盘空间：
- 若 C 盘剩余 < 20GB 且其他盘空间更大 → 自动把核心/库配置到空间最大的盘（`<盘>:/tool/arduino-data`）
- 已配置或 C 盘充足 → 跳过
- macOS/Linux：默认 ~/.arduino15/（无需处理）

## 自定义 arduino-cli 数据目录（可选）

核心和库（ESP32 可达数 GB）默认装在 ~/.arduino15/（或 %LOCALAPPDATA%\Arduino15）。要迁移到大盘（如 D 盘）：

```bash
arduino-cli config set directories.data "D:/tool/arduino-data"
arduino-cli config set directories.downloads "D:/tool/arduino-downloads"
arduino-cli config set directories.user "D:/tool/arduino-user"
# 迁移旧数据后验证: arduino-cli core list
```

compile.sh 调用 arduino-cli 会自动读取此配置，无需改 PATH。
