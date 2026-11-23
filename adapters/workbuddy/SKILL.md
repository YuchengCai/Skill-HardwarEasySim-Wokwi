---
name: wokwi-arduino
description: Create, compile, simulate, and upload Arduino projects with Wokwi. Use when the user mentions Arduino, Wokwi, 单片机, 嵌入式, or when .ino / wokwi.toml / diagram.json files are detected. Explicitly activate with @wokwi, #arduino, or @simulate.
---

# Arduino Wokwi Simulation Skill (v0.6.1)

用自然语言描述电路，自动生成可仿真的 Wokwi 工程(Arduino Uno/Mega/Nano/ESP32)：自动布局与走线、编译固件、浏览器仿真、可选烧录与串口监视。

## Playwright MCP 配置（WorkBuddy 前置）

在 `~/.workbuddy/mcp.json` 中添加（首次创建该文件）：

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

启用：WorkBuddy 右上角连接器管理 → 自定义连接器入口 → 对 Playwright 点「信任」→ 重启会话。

## 项目文件格式（重要）

- `wokwi.toml` 必须用 `[wokwi]` section：`[wokwi]\nversion = 1\nfirmware = 'build/<项目名>.ino.hex'`（`[env]`/`[board]` 是错的，会报 "No [wokwi] section found"）
- 第三方库：项目根目录建 `libraries.txt`（每行一个库名，如 `DHT sensor library`），编译前 `arduino-cli lib install "库名"`

## 板型支持

支持 Uno/Mega/Nano/ESP32（compile.sh 自动从 diagram.json 推断 FQBN；ESP32 核心通过乐鑫中国镜像自动安装）。

## 完整工作流

**入口选择**：有代码物证（.ino / sketch 目录 / libraries.txt）→ **Entry B**：按 `references/arduino/code-mapping.json` 反推元件与网表，清单**须经用户确认**后才写 intent（多候选必须问用户）；纯需求描述 → 直接按下述流程设计。歧义时问一句"从这份代码进，还是重新设计？"

1. **生成** — 写 `.ino` 代码，查 `references/arduino/index.json`（中文名匹配）→ components.md → detail/。写 `layout-intent.json`（语义意图，无坐标；契约 `references/common/intent-format.md`，偏好 `references/common/layout-cards/`；`breadboard` 可留空，脚本自动兜底 bus 场景）→ `node scripts/layout-generator.js layout-intent.json <dir>` 生成 `diagram.json` → `node scripts/optimize-wiring.js <dir> --dry-run` 检测冲突 → 生成 `wokwi.toml`
2. **编译** — `./scripts/compile.sh <dir>`（自动装 arduino-cli，MINGW 路径已处理）
3. **仿真** — 工具面降级树（无死路）: VS Code+插件 → Mode B（F1，零依赖）；有 Playwright MCP → Mode A 主路径（monaco-steps.md，无需 node）；无 MCP 但 node+playwright 已装或用户同意装 → `node scripts/wokwi-automate.js`；内置浏览器（Computer Use 类）仅轻量操作、失败 2 次即降级；都不可达 → **Mode C 手动导入**（产出 web-import/ 三件套：sketch.ino 合并版 + diagram.json + libraries.txt；用户开 wokwi.com/projects/new 替换两文件、加库、自己点 Start）。**HARD RULE: 未经同意绝不装 playwright/npm；视觉验证只能由 Wokwi 本体满足，自绘图不得进验证结论，门不可达 → 如实交付"未验证" + Mode C**
4. **确认** — 仿真前先出示**接线文字说明**（从 diagram.json 生成，按元件分组：
   "LED 阳极 → 电阻 → 板子 pin13/D2"，用功能名 + 确切引脚，ESP32 带 D 前缀）。
   然后询问用户"仿真效果是否正确？"
5. **检测板子** — `arduino-cli board list`。**HARD RULE: 上传前必须向用户展示端口/板型/FQBN 并确认，禁止静默上传**（单板也要确认）。CH340 克隆板显示 Unknown 属正常，用 `--fqbn arduino:avr:uno`
6. **上传 + 串口** — `compile.sh --upload --port --fqbn --monitor`

## 元件与布局查询顺序（快到准）

1. `references/common/intent-format.md` — layout-intent.json 字段契约（写 intent 前必读）
2. `references/common/layout-cards/index.md` — 元件偏好卡索引，只读用到的卡
3. `references/common/generic-wiring.md` — 未收录元件的通用兜底
4. `references/common/layout-rules.md` / `breadboard.md` / `waypoints.md` — 布局/面包板/控制点规则
5. `references/arduino/index.json`（中文名匹配）→ `components.md` → `detail/<type>.json`（目录或有滞后，编辑器面板为准，缺口回报）
6. `references/arduino/experience.json` — 累积接线经验
7. 库外元件（index.json 查不到）→ 发现缺元件先查 `placeholders/<name>/` 复用；否则【暂停问用户品牌型号】→ 搜 datasheet 拿真实引脚 → `scripts/generate-part-placeholder.js` 生成（存 `placeholders/`，diagram.json 用 `chip-<name>`，wokwi.toml 声明 `[[chip]]`；生成器随附通用空 wasm，无仿真行为）；生成前【暂停让用户选】：最小模式（默认，空 wasm 仅接线展示）或 功能模式（写仿真 wasm，耗时长/token 多/可能不能完整模拟）；未明确要求则一律最小模式

## 硬件核对（接实物前强制）

模拟通过后接实物前：出示核对清单（模拟元件 vs 实物型号），标注接口差异（如 OLED 的 I2C/SPI）。
若实物与模拟不一致（如 SPI 版 OLED）：
- 给选项：A) 重新生成匹配实物的代码/接线 B) 换与模拟一致的元件
- ⚠️ 重新生成前先说明预期：新模拟可能出现异常（如 SPI 接线 OLED 不显示——模拟器只支持 I2C），**这是模拟器限制，不是代码错误**。实物按新接线会正常工作，但模拟无法完整验证。
- 用户看到模拟异常时再次提醒"不是 bug"。

## 设计守则（强制）

1. 脚本失败 → 降级 `references/monaco-steps.md` 原生操作，禁止重试脚本
2. 脚本只"填和点"，代码/电路图由 agent 生成
3. 原生操作步骤保留在 references 供降级
4. **设计选择（C 值）归模型——脚本只做"默认兜底 + 显式覆盖"，不静默替模型决定。** 有多种合理权衡的选择（按钮对侧/同侧、zone/region、引脚分配）由模型思考；脚本只提醒后果（如按钮默认对侧、`hint.sameSide` 显式省线），不替模型做决定。

## 需求入口（序列3）

按用户给的信息分流，只追问能区分剩余接法的一项（完整判据见 `references/common/intake-routing.md`）：

| 用户给了什么 | 下一步 |
|---|---|
| 功能目标、委托选型 | 复述功能关系，沿用已有器件，推荐类别/型号；只采购就停在选型，同时制作先确认会改变接法的选择 |
| 清单 / 引脚表 / 已有接线 | 沿用已确认事实，连接充分直接画；锁定孔写显式端点，其余自动分配 |
| 粘贴代码 / 工程 | 追板卡配置、初始化与调用；信息够就画，冲突时指出具体接点，保留源程序 |
| 只有商品名 / 规格 / 照片 | 只问能区分剩余接法的一项；纯文本可请用户抄丝印，其余已知连接保留 |

交给绘图的最小内容：本次目标 / 已选器件 / 已证信号与去向 / 锁定端点与可变动项 / 替代图例对应 / 待核实项（标 unknown，不填默认值）。

## 静态展示与交付（序列4）

- 生成后**主动尝试静态展示**：宿主已有 Wokwi 插件或已授权浏览器 → 直接用；都不可用时让用户选「本地 SVG / 纯文字」，用户决定后才生成。
- 展示同版图和文件时只问「接线图清楚吗？还有疑问吗？」；按证据区分**已核对成图 / 缺浏览器证据 / 诊断草稿**，后两种写明具体未核实或失败项，错接草稿不得标为可照接。
- 纯绘图任务到此结束；用户明确只要文件时直接交文件。
- 用户已委托烧录：用**合并确认**说明写哪版程序、目标板型、会替换现有程序；用户同意后由本地 Agent 检测设备。详见 `references/common/interaction-delivery.md`。
- 云端浏览器只负责展示连线；USB 枚举、串口选择、上传必须由本机 Agent 执行（`references/common/flash-workflow.md`、`scripts/flash-arduino.js`）。

## 自愈检查（强制，激活时执行）

⚠️ **WorkBuddy 市场同步可能只拉取 SKILL.md，导致 scripts/ 和 references/ 缺失。激活时必须先检查并恢复：**

```bash
# 检查并恢复缺失文件
BASE="https://raw.githubusercontent.com/YuchengCai/Skill-HardwarEasySim-Wokwi/main"
# 运行时脚本（16）
for F in scripts/compile.sh scripts/wokwi-automate.js scripts/layout-generator.js scripts/layout-v2.js \
         scripts/optimize-wiring.js scripts/wiring-notes.js scripts/verify-wires.js scripts/wokwi-cdp.js \
         scripts/extract-diagram.js scripts/generate-part-placeholder.js scripts/chip-geometry.js \
         scripts/check-required.js scripts/flash-arduino.js \
         scripts/placeholder-chip.wasm scripts/placeholder-chip.c scripts/wokwi-api.h; do
  if [ ! -f "$F" ]; then
    echo "缺失 $F，正在从 GitHub 恢复..."
    mkdir -p "$(dirname "$F")"
    curl -fsSL "$BASE/$F" -o "$F"
  fi
done
# 关键参考资料（文档/数据/卡片）
for F in references/monaco-steps.md \
         references/arduino/components.md references/arduino/index.json references/arduino/experience.json references/arduino/code-mapping.json \
         references/common/intent-format.md references/common/layout-rules.md references/common/generic-wiring.md \
         references/common/breadboard.md references/common/waypoints.md references/common/geometry.json \
         references/common/boards.json references/common/pins.json references/common/sizes.json \
         references/common/pin-semantics.json references/common/programmatic-pins.json \
         references/common/pins-auto.json references/common/sizes-auto.json \
         references/common/metrics-policy.md references/common/wiring-profiles.md \
         references/common/env-switches.md references/common/layout-analysis.md \
         references/common/host-integration.md references/common/intake-routing.md \
         references/common/interaction-delivery.md references/common/flash-workflow.md \
         references/common/layout-cards/index.md references/common/layout-cards/led.md \
         references/common/layout-cards/resistor.md references/common/layout-cards/pushbutton.md \
         references/common/layout-cards/dht22.md references/common/layout-cards/oled.md references/common/layout-cards/buzzer.md \
         references/esp32/board.md references/esp32/components.md references/esp32/experience.json; do
  if [ ! -f "$F" ]; then
    echo "缺失 $F，正在从 GitHub 恢复..."
    mkdir -p "$(dirname "$F")"
    curl -fsSL "$BASE/$F" -o "$F"
  fi
done
```

⚠️ 若目录仍是旧结构（`core/` 而非 `scripts/` + `references/`），请删除旧目录并重新安装，或手动迁移文件。

## 版本检查

当前版本: **v0.6.1**
仓库: `https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git`

激活时检查最新 release，有新版本询问用户是否更新（git clone + install.sh）。⚠️ 更新时使用 `install.sh --global`（WorkBuddy 本身固定全局）。

## 可读性布局（v0.6.0 新增，可选）

意图声明 `routing.zones` / `routing.relays` 时启用可读性引擎（`scripts/layout-v2.js`）：

- 预设：`V2_ALIGN=1`（边对齐）、`V2_T3=1`（枢纽同排，自动识别枢纽）
- 规则：同带下行 / 板让开走廊 / 馈电四道嵌套 / 缝宽 = 过线数×9.6+12
- 档位：`routing.profile` = `prototype`（默认）/ `matrix`（母线中继，交叉最少但线多）/ `device`（不支持）
- 产出：`wiring-notes.md` 接线台账（电源干道 / 母线中继 / 列隔离 / 直连 + 短路检查）
- 判据：GATE（硬性）/ BUDGET（只设上限）/ DIAGNOSTIC（只归因）→ 软指标不得作为优化目标

详见 `references/common/layout-rules.md`（Rule 9/10）、`layout-analysis.md`、`wiring-profiles.md`、`metrics-policy.md`。
