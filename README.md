# 🧰 Skill-HardwarEasySim-Wokwi

<p align="center">
  <a href="#english">English</a> · <a href="#chinese">中文</a>
</p>

---

## 📋 What's New / 本次大版本更新

**v0.6.0 — Readability Engine & Wiring Ledger / 可读性引擎与接线台账**

> Opt-in readability layout (declare `routing.zones` / `routing.relays`), every net explained, and judgement tiers that stop soft metrics from becoming goals.
> 可选可读性布局（声明 `routing.zones` / `routing.relays` 即启用）、逐网接线台账，以及不让软指标变成优化目标的指标分级。

- 🧠 **Readability Engine (v2)** / 可读性引擎 — same-band descent, board clears the hub corridor, nested feed lanes, seam width = wire count × 9.6 + 12 (U2 crossings 47→36 / 54→47) / 同带下行、板让开枢纽走廊、馈电四道嵌套、缝宽按过线数计算（U2 交叉 47→36 / 54→47）
- 🧾 **Wiring Ledger** / 接线台账 — electrical network rebuilt by union-find (even bare bb jumpers), every net explained (trunk / bus relay / isolated column / direct) + cross-voltage short check / 并查集重建电气网络（裸跳线也能归网），逐网说明形态（电源干道 / 母线中继 / 列隔离 / 直连）+ 跨电位类短路检查
- 📏 **Judgement Tiers** / 指标三级 — GATE (veto) / BUDGET (upper bound only) / DIAGNOSTIC (attribution only); soft metrics (crossings / turns / length) must never be optimization targets / GATE 一票否决 / BUDGET 只设上限 / DIAGNOSTIC 只归因；交叉、转弯、线长等软指标不得作为优化目标
- 🧩 **Existing-Code Entry & Behavior Spec** / 存量代码入口与行为说明 — point it at an existing `.ino` / sketch / `libraries.txt` → code fingerprints + pin scan → confirm gate → intent (v0.5.8); delivery explains normal behavior in the chat and archives `BEHAVIOR.md` / 从存量代码反推意图并入主线（v0.5.8）；交付时对话内给出「正常工作状态说明」并静默归档 `BEHAVIOR.md`

**小版本更新历程**

- **v0.6.0** — Readability Engine & Wiring Ledger / 可读性引擎与接线台账：
  - 形态规则：**同带下行**（元件已在目标带内 → 直接向下，U2 交叉 47→36）、**板让开枢纽走廊**（54→47）、
    **馈电四道嵌套**（间距真违规 10→7）、**缝宽 = 过线数 × 9.6 + 12**（缝宽不再拍数值）
  - **枢纽同排合并**：`V2_T3=1` 自动识别枢纽（连接数最多 + 接板最多），与 hub 放置同一实现（此前两套入口）
  - **接线台账** `wiring-notes.md`：电气网络重建（并查集，bb 裸跳线也能正确归网）+ 跨电位类短路检查 +
    每网形态说明（电源干道 / 母线中继 / 列隔离 / 直连）；两引擎生成后自动产出
  - **指标三级政策**（`metrics-policy.md`）：GATE 一票否决 / BUDGET 只设上限 / DIAGNOSTIC 只归因；
    **软指标（交叉/转弯/线长）不得作为优化目标**
  - **输出档位** `routing.profile`：`prototype`（默认）/ `matrix`（母线中继，交叉最少但线多）/ `device`（不支持，显式声明）
  - 两引擎 intent 形状归一（`groups[].ids → parts`），v1 缺 groups 时快速失败并指向 v2；输出目录自动创建
  - 间距报告区分「真违规 <9.5」与「网格取整 9.5」（U3b 真违规 7→0）
  - 新增 `V2_TRACE` 决策轨迹：每根线记录规则来源，替代"改了没效果就盲猜钩子"

- **v0.5.9** — Electrical Semantics & Catalog Coverage / 电气语义检查与元件目录补齐：
  - 电气连通性检查（`optimize-wiring.js` 新增并查集网络分析）：`rail-unpowered`（轨上有消费者、网络内却无任何电源脚）与 `netlist-broken`（同一网络被面包板沟槽切断）列为**硬冲突**，`column-halfzone-split` 降为提示；堵住「GND 根本没接却报告无冲突」的漏报（真实项目实测反馈）
  - 元件目录补到 60 条：新增 `board-mfrc522`（RFID 读卡器）、`board-cd74hc4067`（16 路模拟复用器）、`board-ssd1306`、`wokwi-74hc165 / 74hc595 / a4988 / ds18b20 / tm1637-7segment`，附 detail 引脚表与几何（尺寸为估计值，已标注待实测校准）
  - `code-mapping.json` 扩到 9 条（`MFRC522.h` → `board-mfrc522` 等）
  - 网页写入方式升级：`wokwi-automate.js` 由 `setValue` 改为 Monaco `executeEdits`（`pushUndoStop` 包裹），避免 IDE 状态与 buffer 不一致；新增按 F 适配视口步骤；`monaco-steps.md` 同步可复制片段
  - 新增零依赖 CDP 直连驱动 `scripts/wokwi-cdp.js`（attach-first：附着已开调试端口的浏览器 → 注入 diagram.json → F 键 → 截图），供无法自行拉起浏览器的受限环境使用
  - 回归测试沙箱兼容：`run-tests.js` 改用文件重定向捕获子进程输出（受限环境管道 stdio 会 EPERM，会让 10 个用例集体假失败）；本机全套 18/18 通过
- **v0.5.8** — Existing-Code Entry & Behavior Spec / 存量代码入口与行为说明：
  - 存量代码入口（Entry B）：材料驱动触发（有 `.ino` / sketch / libraries.txt 物证即走 Entry B，纯描述走 Entry A，歧义一句双向确认——零关键词）；代码分析（`#include` 库指纹 + 引脚扫描）→ **确认门**（反推清单必须用户确认，多候选必问）→ 写 intent 并入主线——主线流程零改动，0.5.7 的判据/告警/降级树自动覆盖存量项目
  - 新增 `references/arduino/code-mapping.json`（代码→元件映射，初版 8 条指纹：NeoPixel/DHT/I2C×3/Servo/按钮上拉/模拟输入多候选；引脚名与 detail 逐条核对；数据驱动随用随长）
  - 行为说明（呈现即对话）：交付时在**对话中**给出「正常工作状态说明」——深度随验证可达性分级（模拟可观测→要点 / 部分可达→适用节 / Mode C·烧录→全节：上电/稳态/交互响应表/故障速查）；同一内容静默归档 `BEHAVIOR.md`（web-import 同步一份），任务收尾时提示已保存，对话内可删，语言随会话——用户无需打开任何文件就知道"对了长什么样"
  - 四适配器同步入口选择行；全部自愈清单补 code-mapping.json（GitHub 拉取安装即用不缺文件）
  - 端到端验证：仅凭一份 .ino（无 intent、无模拟工具环境）→ 反推 8 元件 BOM 全部命中 → 生成硬冲突 0（bench 复核）→ 本地编译通过 → Mode C 三件套 + 行为说明五节齐交付，状态如实 UNVERIFIED
- **v0.5.7** — Criteria-Driven Layout & Honest Verification / 判据驱动布局与诚实验证：
  - 面包板判据改造：元件数量条款退役，主判据改为**电源拓扑 fanout**（任一电源家族板脚需求 > 可用脚数 → 走轨分发，脚数读 `boards.json powerPinCounts`）；生成器常驻输出 advisor 三段式提示（事实/原因/建议，不再无声）
  - 新告警族：电源菊花链单线 >400px（分发线豁免）、面包板空置（轨连接 <2）、离散元件直连未写 `reason`（`intent.parts[].reason` 新增条件必填）、未知元件类型不静默
  - 规则文本与代码逐字对齐：Rule 1 重写为 fanout 判据、placement 改「通常省略（默认 bb）」、region 面包板取值补 `bb`；文本↔代码一致性对照 10/10 grep 实证
  - 流程层：仿真节改**工具面检测降级树**（VS Code 插件 / Playwright MCP / node 脚本 / 内置浏览器 / 手动导入五分支，无死路）；**Mode C 一等化**（`web-import/` 三件套为标准交付物 + 五步手动导入）；**验证门硬边界**（视觉验证只能由 Wokwi 本体满足，自绘图禁入验证结论，门不可达 → 如实交付 UNVERIFIED）
  - 走线几何治理：走廊逃逸避板盒、贴轨直连避元件、同元件双轨线错列、顶区元件回轨上路；大件净空规则（≥150 units，回轨长线禁穿大件本体——实测硬冲突 −60%）
  - 检测器修复：led 系检测尺寸精确匹配（led-ring/bar-graph 走真实尺寸，堵线穿元件漏检）；冲突**报告分级**——硬冲突全量优先打印，不再被重复计数的软交叉挤出报告窗口（截断 bug 实测曾把 10 条线穿元件全部隐藏）
  - compile.sh 沙箱兼容：`--build-path` 收编中间产物到项目内（受限沙箱 exit 1→0，hex 不变）
- **v0.5.6** — Unknown Parts & Wiring Governance / 未知元件占位符与走线治理：
  - 未知元件占位符：custom chip（chip.json + 通用空 wasm），`chip-<name>` 自动几何重建（横向 PCB 模型 + 实测校准常量），无仿真仅接线展示；`generate-part-placeholder.js` 一条龙生成
  - 布线方向推导层：`pin-semantics.json` 数据驱动（电阻 swapPair 自动换向、按钮 terminalPairs 对侧默认 + `hint.sameSide` 显式省线）
  - 走廊体系：统一信号网格（含无芯片场景）、板底走廊带一统、长线电源智能直连、逃离三分（顶缘上逃/底缘直穿/侧列水平）
  - 电源线电压家族调色板（5V 红系/3.3V 橙系/VIN 棕系/GND 黑灰系，主线传统红黑）；修复 3.3V/VIN 错接 5V 轨
  - 重叠检测器（共线/过近/端点近触三类自动告警）+ 回归测试不变式化（golden 硬对照退役，快照留作人工参考）
- **v0.5.4** — Bus Scene Hotfix / 总线场景热修复：
  - 脚本兜底：检测到多元件共用电源脚（VCC/GND）自动配面包板走轨分发，修复 5 舵机直连串接问题
  - SKILL.md 设计判据：可推导的 B 值脚本化、不进 SKILL.md，防止退化成规则清单
- **v0.5.3** — Geometry Data Full Coverage / 几何数据全量覆盖：
  - 引脚提取覆盖 27 → 48 元件：顺序无关全局扫描 + 常量/三元表达式求值 + Node vm 程序化求值（helper/spread/查表）
  - footprint 补齐 55 个：SVG 插值解析、多配置元件按默认值、chip 类 DIP 近似值
  - 提取器一条龙：`--download` / `--dir`，Python（字面量/常量）+ Node（程序化）双引擎
  - 端到端验证：布局生成 → 冲突检测 → 编译全流程走通
- **v0.5.1** — Wiring Experience Upgrade / 布线体验升级：
  - 布局迭代骨架：生成→检测→硬伤/软伤/豁免分级→扩容重排→建议改组，自动尝试修到达标
  - I2C 反序豁免：OLED 的 SDA/SCL 必然交叉不再误报，单独列出不计入软伤
  - 板型配置抽象：Uno 假设（引脚分侧/电源脚）抽到 `boards.json`，多板型复用零改算法
  - 几何提取器：`extract-geometry.py` 自动提取引脚坐标（wokwi-* px / board-* mm 换算）与 footprint 尺寸
  - 几何数据实测修正：OLED/DHT22 引脚坐标、OLED 与板子真实尺寸，网页版插接对齐
- **v0.5.0** — Layout System Launch / 布局系统诞生：
  - 布局生成器：`layout-intent.json`（语义意图）→ 自动算坐标 + 面包板插接 + 走线
  - 布线优化：冲突检测（交叉/重叠/穿线）+ 修正 + 建议（`optimize-wiring.js`）
  - 元件偏好卡（LED/电阻/按钮/DHT22/OLED/蜂鸣器）+ 未收录元件通用接线兜底
  - 几何单一事实源（`geometry.json`）+ 回归测试（8 用例）

---

<a id="english"></a>
## 📘 English

**Wokwi Arduino Simulation Skill** — v0.6.0 — A portable skill package for AI coding agents (DeepCode, WorkBuddy, Claude Code, Cursor) that enables automated Arduino hardware prototyping, **auto browser simulation**, circuit compilation, and firmware upload.

### Readability layout (optional, v0.6.0)

Declare `routing.zones` / `routing.relays` in the intent to enable the readability engine
(`scripts/layout-v2.js`). It trades a few extra jumpers for a much tidier diagram:

- **Same-band down**: a part already inside the target band drops straight down (no detour above the board)
- **Board clears the hub corridor**: in hub layouts the board shifts left so module wires stop being blocked
- **Nested feed lanes**: power feeds rank by board-pin x, deepest lane outermost
- **Seam width = wire count × 9.6 + 12** (a seam must be wide enough for the verticals crossing it)
- **Wiring ledger** `wiring-notes.md`: every net explained (trunk / bus relay / isolated column / direct)

Layout presets: `V2_ALIGN=1` (edge-aligned), `V2_T3=1` (hub-in-band, auto-detected hub).
Profiles: `routing.profile` = `prototype` (default) / `matrix` (bus-relay, fewest crossings, more wires).
Judgement tiers: GATE / BUDGET / DIAGNOSTIC — see `references/common/metrics-policy.md`.

### Features

- 🤖 **AI-Powered** — Drop-in skill for your coding agent. Just describe your hardware idea.
- 🌐 **Auto Browser Simulation** — `wokwi-automate.js` opens wokwi.com, fills code + circuit, starts simulation automatically (browser fallback: Chrome → Edge → Chromium).
- ⚡ **One-Command Compile** — Auto-installs `arduino-cli` + Uno core, compiles `.ino` to `.hex`, handles MINGW path conversion.
- 🔢 **Multi-Board (Uno/Mega/Nano/ESP32)** — compile.sh auto-infers FQBN from diagram.json (no config needed).
- 🔌 **Cross-Agent** — Works with DeepCode, WorkBuddy (`SKILL.md`), Claude Code (`CLAUDE.md`), and Cursor (`.cursorrules`).
- 🧩 **Component Catalog (60 parts)** — `index.json` full catalog with Chinese names + pins, `detail/` per-part, auto-extracted from wokwi-elements source. Chinese name matching + ambiguity handling (asks user).
- 📚 **Experience Library** — `experience.json` accumulates verified wiring patterns & layout tips (agent-learned).
- 🛠️ **Clean Layouts** — Supports `rotate` and routing waypoints for tidy diagrams.
- 🔍 **Clone Board Detection** — Detects CH340/CP2102/FTDI chips via VID/PID (Windows PowerShell, macOS system_profiler, Linux lsusb) and suggests FQBN for clone boards.
- ✅ **Safe Upload** — Always asks for user confirmation (port + board + FQBN) before uploading. Never silently flashes.
- ⚠️ **Hardware Check** — Before guiding physical wiring, confirms component model/version matches simulation; warns about interface differences (e.g. I2C vs SPI OLED) and simulator limitations.
- 🧾 **Existing-Code Entry (Entry B)** — Hand it an existing `.ino` / sketch / `libraries.txt`: `#include` fingerprints + pin scan → confirm gate → `layout-intent.json`; the main flow stays untouched (v0.5.8).
- 📖 **Behavior Spec on Delivery** — Normal-operation notes in the chat (depth follows verification reachability), archived to `BEHAVIOR.md` (v0.5.8).
- 🔎 **Electrical Semantics Checks** — Union-find net analysis: `rail-unpowered` / `netlist-broken` are hard conflicts, so "GND unconnected yet no conflict" cannot slip through (v0.5.9).

### Quick Start

```bash
# 1. Install the skill (from project root)
bash path/to/install.sh

# 2. Restart your coding agent session

# 3. Tell your agent:
#    "Create an Arduino project that blinks an LED in Morse code"
```

The agent will:
1. Generate `.ino` code + `diagram.json` + `wokwi.toml`
2. Compile with `compile.sh`
3. Tell you how to simulate (VS Code extension or wokwi.com)

### Project Structure

```
Skill-HardwarEasySim-Wokwi/
├── install.sh                         # One-click installer
├── publish-skillhub.sh                # 🚀 SkillHub CLI publish script
├── CHANGELOG.md                       # 🗒️ Version history
├── adapters/
│   ├── deepcode/SKILL.md              # DeepCode skill file
│   ├── workbuddy/SKILL.md             # WorkBuddy skill file
│   ├── claude/CLAUDE.md               # Claude Code skill file
│   └── cursor/.cursorrules            # Cursor rules file
├── scripts/
│   ├── compile.sh                     # OS-aware compile/upload script
│   ├── layout-generator.js            # 🧠 intent → diagram.json (coordinates)
│   ├── layout-v2.js                   # 🧠 readability engine (opt-in, v0.6.0)
│   ├── optimize-wiring.js             # ✅ wiring conflicts + electrical net checks
│   ├── wiring-notes.js                # 🧾 wiring ledger (per-net explanation)
│   ├── generate-part-placeholder.js   # 🧩 library-external part placeholder
│   ├── wokwi-automate.js              # 🌐 Auto browser simulation script
│   ├── wokwi-cdp.js                   # 🌐 attach-first CDP driver
│   └── run-tests.js                   # 🧪 regression (dev-only)
└── references/
    ├── common/                        # 🧠 layout system (any board)
    │   ├── geometry.json              # 📐 breadboard geometry (single source)
    │   ├── pins.json / sizes.json     # 📏 pin coords / canvas sizes
    │   ├── intent-format.md           # 📋 layout-intent.json contract
    │   ├── layout-rules.md            # 📐 layout/wiring rules
    │   ├── metrics-policy.md          # 📏 GATE/BUDGET/DIAGNOSTIC tiers
    │   ├── routing-philosophy.md      # 🧭 human vs script routing
    │   ├── generic-wiring.md          # 🔌 fallback for unknown parts
    │   ├── breadboard.md / waypoints.md
    │   └── layout-cards/              # 🧩 per-component preference cards
    ├── arduino/
    │   ├── components.md              # 📖 Component reference manual (high-freq)
    │   ├── index.json                 # 🗂️ Full catalog: type + pins + zh names
    │   ├── code-mapping.json          # 🔎 code fingerprint → part mapping
    │   ├── experience.json            # 📚 Agent-learned wiring patterns & tips
    │   └── detail/*.json              # Per-component details (58 files)
    ├── esp32/board.md                 # ESP32 board reference
    └── monaco-steps.md                # Native Monaco fallback steps
```

### Prerequisites

| Tool | Required For | Auto-Install? |
|------|-------------|---------------|
| `arduino-cli` | Compiling `.ino` → `.hex` | ✅ Yes (all OS) |
| `playwright` npm pkg | Auto browser simulation | `npm i playwright` |
| Playwright MCP | Native Monaco fallback | `npx @playwright/mcp@latest` |
| VS Code + Wokwi extension | Manual simulation mode | Manual |
| wokwi.com account | Browser simulation | Free signup |

### Installation

**One-Click (for AI Agent users)**
Copy this sentence to your coding agent:

> "Clone YuchengCai/Skill-HardwarEasySim-Wokwi from GitHub and run install.sh"

**From GitHub (recommended):**
```bash
git clone https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git
cd Skill-HardwarEasySim-Wokwi
bash install.sh
```

**From a local copy:**
```bash
bash path/to/Skill-HardwarEasySim-Wokwi/install.sh
```

The script auto-detects your agent type (DeepCode / Claude Code / Cursor / WorkBuddy) and asks you to choose the install scope:

| Scope | Install location | Best for |
|-------|-----------------|----------|
| **Global** | `~/.deepcode/skills/`, `~/.claude/`, `~/.cursor/rules/` | Long-term use, all projects |
| **Project** | `./.agents/skills/`, `./CLAUDE.md`, `./.cursorrules` | Trying it out, one project only |

You can also skip the prompt: `bash install.sh --global` or `bash install.sh --project`.

### Usage

Once installed, start a new coding agent session and describe your hardware project:

```
@wokwi Build a temperature monitor with DHT22 and LCD1602
```

The agent reads `components.md` for correct pin names, generates the project, compiles, and guides you through simulation.

---

<a id="chinese"></a>
## 📘 中文

**Wokwi Arduino 仿真 Skill** — v0.6.0 — 一个可移植的技能包，专为 AI 编程助手（DeepCode、WorkBuddy、Claude Code、Cursor）设计，实现自动化硬件原型设计、**自动浏览器仿真**、代码编译和固件上传。

### 可读性布局（可选，v0.6.0）

在意图里声明 `routing.zones` / `routing.relays` 即启用可读性引擎（`scripts/layout-v2.js`），
用少量额外跳线换取明显更清晰的走线：

- **同带下行**：元件已在目标带内时直接向下走，不再抬到板外绕回（U2 枢纽布局交叉 47→36）
- **板让开枢纽走廊**：枢纽布局下板左移，模块竖线不再被板挡住（交叉 54→47）
- **馈电四道嵌套**：按板脚 x 排名，最深的一条走最外缘（间距真违规 10→7）
- **缝宽 = 过线数 × 9.6 + 12**：缝宽由穿过它的竖线根数决定，而不是拍数值
- **接线台账** `wiring-notes.md`：逐网说明是电源干道 / 母线中继 / 列隔离 / 直连，并做跨电位类短路检查

布局预设：`V2_ALIGN=1`（边对齐）、`V2_T3=1`（枢纽同排，自动识别枢纽）。
输出档位：`routing.profile` = `prototype`（默认）/ `matrix`（母线中继，交叉最少但线多）/ `device`（不支持）。
判据三级：GATE / BUDGET / DIAGNOSTIC，见 `references/common/metrics-policy.md`。

### 功能

- 🤖 **AI 驱动** — 直接跟助手描述你的硬件想法，无需手动查引脚
- 🌐 **自动浏览器仿真** — `wokwi-automate.js` 自动打开 wokwi.com、填入代码和电路图，交给用户点击启动仿真（浏览器回退链：Chrome → Edge → Chromium）
- 🔢 **多板型（Uno/Mega/Nano/ESP32）** — compile.sh 自动从 diagram.json 推断 FQBN，无需配置
- ⚡ **一键编译** — 自动安装 `arduino-cli` + Uno 核心，编译 `.ino` 到 `.hex`，处理 MINGW 路径转换
- 🔌 **跨 Agent** — 支持 DeepCode、WorkBuddy（`SKILL.md`）、Claude Code（`CLAUDE.md`）和 Cursor（`.cursorrules`）
- 🧩 **元件目录（60 种）** — `index.json` 全量目录（含中文名+引脚），`detail/` 分元件详情，从 wokwi-elements 源码自动提取；中文名匹配 + 歧义询问
- 📚 **经验库** — `experience.json` 累积验证过的接线模式和布线技巧（agent 自学习）
- 🛠️ **整洁布线** — 支持电阻旋转和路由控制点，生成清晰的电路图
- 🔍 **克隆板识别** — 通过 VID/PID 检测 CH340/CP2102/FTDI 芯片（Windows PowerShell / macOS system_profiler / Linux lsusb），为克隆板提供 FQBN 建议
- ✅ **安全上传** — 上传前始终请求用户确认（端口 + 板型 + FQBN），绝不静默烧录
- ⚠️ **硬件核对** — 接实物前确认元件型号/版本与模拟一致，提示接口差异（如 OLED 的 I2C/SPI）和模拟器限制
- 🧾 **存量代码入口（Entry B）** — 给一份现成的 `.ino` / sketch / `libraries.txt`：`#include` 指纹 + 引脚扫描 → 确认门 → `layout-intent.json`，主线流程零改动（v0.5.8）
- 📖 **行为说明（呈现即对话）** — 交付时在对话内给出「正常工作状态说明」（深度随验证可达性分级），静默归档 `BEHAVIOR.md`（v0.5.8）
- 🔎 **电气语义检查** — 并查集网络分析：`rail-unpowered` / `netlist-broken` 列为硬冲突，"GND 没接却报无冲突"不会再漏（v0.5.9）

### 快速开始

```bash
# 1. 安装 Skill（在项目根目录执行）
bash path/to/install.sh

# 2. 重启你的编程助手会话

# 3. 告诉你的助手：
#    "帮我做一个莫斯电码闪烁的 Arduino 项目"
```

助手会自动：
1. 生成 `.ino` 代码 + `diagram.json` + `wokwi.toml`
2. 用 `compile.sh` 编译
3. 指导你如何启动仿真（VS Code 插件或 wokwi.com）

### 项目结构

```
Skill-HardwarEasySim-Wokwi/
├── install.sh                         # 一键安装脚本
├── CHANGELOG.md                       # 🗒️ 版本历史
├── adapters/
│   ├── deepcode/SKILL.md              # DeepCode 技能文件
│   ├── workbuddy/SKILL.md             # WorkBuddy 技能文件
│   ├── claude/CLAUDE.md               # Claude Code 技能文件
│   └── cursor/.cursorrules            # Cursor 规则文件
├── scripts/
│   ├── compile.sh                     # 跨平台编译/上传脚本
│   ├── layout-generator.js            # 🧠 intent → diagram.json（坐标）
│   ├── layout-v2.js                   # 🧠 可读性引擎（可选，v0.6.0）
│   ├── optimize-wiring.js             # ✅ 布线冲突 + 电气网络检查
│   ├── wiring-notes.js                # 🧾 接线台账（逐网说明）
│   ├── generate-part-placeholder.js   # 🧩 库外元件占位符
│   ├── wokwi-automate.js              # 🌐 自动浏览器仿真脚本
│   ├── wokwi-cdp.js                   # 🌐 attach-first CDP 驱动
│   └── run-tests.js                   # 🧪 回归测试（开发期）
└── references/
    ├── common/                        # 🧠 布局体系（任何板型）
    │   ├── geometry.json              # 📐 面包板几何（单一事实源）
    │   ├── pins.json / sizes.json     # 📏 引脚坐标 / 画布尺寸
    │   ├── intent-format.md           # 📋 layout-intent.json 契约
    │   ├── layout-rules.md            # 📐 布局/布线规则
    │   ├── metrics-policy.md          # 📏 GATE/BUDGET/DIAGNOSTIC 三级政策
    │   ├── routing-philosophy.md      # 🧭 人类与脚本的走线思路差异
    │   ├── generic-wiring.md          # 🔌 未收录元件兜底
    │   ├── breadboard.md / waypoints.md
    │   └── layout-cards/              # 🧩 元件偏好卡
    ├── arduino/
    │   ├── components.md              # 📖 元件参考手册（高频）
    │   ├── index.json                 # 🗂️ 全量目录：type + 引脚 + 中文名
    │   ├── code-mapping.json          # 🔎 代码指纹 → 元件映射
    │   ├── experience.json            # 📚 agent 自学习接线模式与布线技巧
    │   └── detail/*.json              # 分元件详情（58 个）
    ├── esp32/board.md                 # ESP32 板卡参考
    └── monaco-steps.md                # 原生 Monaco 降级操作步骤
```

### 前置依赖

| 工具 | 用途 | 自动安装？|
|------|------|---------|
| `arduino-cli` | 编译 `.ino` → `.hex` | ✅ 是（全平台） |
| `playwright` npm 包 | 自动浏览器仿真脚本 | `npm i playwright` |
| Playwright MCP | 原生 Monaco 操作降级路径 | `npx @playwright/mcp@latest` |
| VS Code + Wokwi 扩展 | 手动仿真模式 | 手动安装 |
| wokwi.com 账号 | 浏览器端仿真 | 免费注册 |

### 安装

**一句话安装（适合 AI Agent 用户）**
把这句话复制给你的编程助手：

> "从 GitHub 上克隆 YuchengCai/Skill-HardwarEasySim-Wokwi 并运行 install.sh"

**从 GitHub 安装（推荐）：**
```bash
git clone https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git
cd Skill-HardwarEasySim-Wokwi
bash install.sh
```

**从本地复制安装：**
```bash
bash path/to/Skill-HardwarEasySim-Wokwi/install.sh
```

脚本会自动检测你的编程助手类型（DeepCode / Claude Code / Cursor / WorkBuddy），并让你选择安装范围：

| 范围 | 安装位置 | 适合场景 |
|------|---------|---------|
| **全局安装** | `~/.deepcode/skills/`、`~/.claude/`、`~/.cursor/rules/` | 长期使用，所有项目可用 |
| **仅当前项目** | `./.agents/skills/`、`./CLAUDE.md`、`./.cursorrules` | 临时试用，单个项目 |

也可以跳过询问直接指定：`bash install.sh --global` 或 `bash install.sh --project`。

### 使用

安装后，重启编程助手会话，描述你的硬件需求即可：

```
@wokwi 帮我做一个 DHT22 温湿度监控 + LCD1602 显示
```

助手会查阅 `components.md` 获取正确的引脚命名，生成项目文件，编译并指导仿真。

---

## 📄 License

MIT
