# Arduino Wokwi 仿真 (v0.5.3)

当用户提到 Arduino、Wokwi、单片机、嵌入式项目，或检测到 `.ino` / `wokwi.toml` / `diagram.json` 时激活。也可通过 `@wokwi` 或 `#arduino` 显式触发。

## ⚠️ 引脚连接写法（实测验证）

在 diagram.json 中连接电源引脚时必须使用正确命名：

| 引脚 | 正确写法 | 规则 |
|------|---------|------|
| GND | `uno:GND.1` | **必须带 .1** |
| 5V | `uno:5V` | 不带后缀 |
| 3.3V | `uno:3.3V` | 小数点格式 |
| VIN | `uno:VIN` | 不带后缀 |

**错误示例：**
```json
// ❌ 不显示线
["led1:C", "uno:GND", "black", []]
["r1:1", "uno:5V.1", "red", []]
["r1:1", "uno:3V3", "orange", []]

// ✅ 正确
["led1:C", "uno:GND.1", "black", []]
["r1:1", "uno:5V", "red", []]
["r1:1", "uno:3.3V", "orange", []]
```

## 项目结构

```
project/
├── project.ino        # Arduino 代码
├── diagram.json       # 电路图
└── wokwi.toml         # 配置
```

## 布局生成（重要，不手写坐标）

1. 写 `layout-intent.json`（语义意图，无坐标）——契约见 `references/common/intent-format.md`，元件偏好见 `references/common/layout-cards/`
2. `node scripts/layout-generator.js layout-intent.json <项目目录>` → 生成 `diagram.json`
3. `node scripts/optimize-wiring.js <项目目录> --dry-run` 检测冲突

## 可用模板

- `blink` — LED 闪烁
- `led-switch` — 按钮控制 LED 开关

## 快速命令

```bash
./scripts/create-project.sh <name> [template]
./scripts/compile.sh <project-dir>
```

## 运行

- VS Code: F1 → "Wokwi: Start Simulation"
- Web: wokwi.com
