# 🧰 Skill-HardwarEasySim-Wokwi

<p align="center">
  <a href="#english">English</a> · <a href="#chinese">中文</a>
</p>

---

## 📋 What's New / 本次大版本更新

**v0.5.0 — Layout Generator + Wiring Optimization / 布局生成器 + 布线优化**

- 🧠 **Layout Generator** / 布局生成器 — `layout-intent.json`（语义意图，无坐标）→ `layout-generator.js` 自动算坐标 + `$bb` 插接 + 走线（面包板已标定）
- 🎯 **Semantic Intent Contract** / 意图契约 — 模型定意图（zone 分区 / hint 左右），脚本定几何；契约见 `references/common/intent-format.md`
- 🧩 **Layout Cards** / 元件偏好卡 — 7 张元件卡（LED/电阻/按钮/DHT22/OLED/蜂鸣器），按需查询
- 🔌 **Generic Wiring Fallback** / 通用接线兜底 — 未收录元件「识引脚 → 分类 → 通用规则」
- 📐 **Geometry Single Source** / 几何单一事实源 — `geometry.json` 面包板几何，脚本 + 文档统一引用
- ✅ **Regression Tests** / 回归测试 — `run-tests.js` + 3 金标用例，防改坏

**v0.4.x — Component Catalog + Multi-Board / 元件目录 + 多板型适配**

- 🧩 **Component Catalog (50 parts)** / 元件目录系统 — 50 components with Chinese names + pins, auto-extracted from wokwi-elements, offline-ready / 50 种元件（含中文名 + 引脚），从 wokwi-elements 开源库自动提取，离线可用
- 🔢 **Multi-Board (Uno/Mega/Nano/ESP32)** / 多板型适配 — auto-inferred FQBN; ESP32 core installs via official CN mirror / compile.sh 自动推断 FQBN；ESP32 核心通过乐鑫国内镜像自动安装
- ⚠️ **Hardware Check** / 硬件核对 — confirm component model matches simulation before physical wiring (I2C vs SPI) / 接实物前确认元件型号/版本与模拟一致，提示接口差异
- 📋 **Wiring Text Summary** / 接线文字说明 — readable wiring description at verification, aids physical wiring / 模拟确认时生成可读接线摘要，辅助实物接线
- 🗄️ **Auto Data-Dir Selection** / 数据目录智能选择 — Windows: auto-migrate to roomiest drive when C: is low / C 盘空间不足时自动迁移到空间最大的盘
- 🌐 **Mode A Restructure** / Mode A 重构 — Playwright MCP as primary path (non-IDE agents), node script fallback / Playwright MCP 为主路径（适配非 IDE agent），node 脚本降为备用

---

<a id="english"></a>
## 📘 English

**Wokwi Arduino Simulation Skill** — v0.5.0 — A portable skill package for AI coding agents (DeepCode, WorkBuddy, Claude Code, Cursor) that enables automated Arduino hardware prototyping, **auto browser simulation**, circuit compilation, and firmware upload.

### Features

- 🤖 **AI-Powered** — Drop-in skill for your coding agent. Just describe your hardware idea.
- 🌐 **Auto Browser Simulation** — `wokwi-automate.js` opens wokwi.com, fills code + circuit, starts simulation automatically (browser fallback: Chrome → Edge → Chromium).
- ⚡ **One-Command Compile** — Auto-installs `arduino-cli` + Uno core, compiles `.ino` to `.hex`, handles MINGW path conversion.
- 🔢 **Multi-Board (Uno/Mega/Nano/ESP32)** — compile.sh auto-infers FQBN from diagram.json (no config needed).
- 🔌 **Cross-Agent** — Works with DeepCode, WorkBuddy (`SKILL.md`), Claude Code (`CLAUDE.md`), and Cursor (`.cursorrules`).
- 🧩 **Component Catalog (50 parts)** — `index.json` full catalog with Chinese names + pins, `detail/` per-part, auto-extracted from wokwi-elements source. Chinese name matching + ambiguity handling (asks user).
- 📚 **Experience Library** — `experience.json` accumulates verified wiring patterns & layout tips (agent-learned).
- 🛠️ **Clean Layouts** — Supports `rotate` and routing waypoints for tidy diagrams.
- 🔍 **Clone Board Detection** — Detects CH340/CP2102/FTDI chips via VID/PID (Windows PowerShell, macOS system_profiler, Linux lsusb) and suggests FQBN for clone boards.
- ✅ **Safe Upload** — Always asks for user confirmation (port + board + FQBN) before uploading. Never silently flashes.
- ⚠️ **Hardware Check** — Before guiding physical wiring, confirms component model/version matches simulation; warns about interface differences (e.g. I2C vs SPI OLED) and simulator limitations.

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
├── adapters/
│   ├── deepcode/SKILL.md              # DeepCode skill file
│   ├── workbuddy/SKILL.md             # WorkBuddy skill file
│   ├── claude/CLAUDE.md               # Claude Code skill file
│   └── cursor/.cursorrules            # Cursor rules file
├── scripts/
│   ├── compile.sh                     # OS-aware compile/upload script
│   ├── layout-generator.js            # 🧠 intent → diagram.json (coordinates)
│   ├── optimize-wiring.js             # ✅ wiring conflict detect/fix
│   ├── generate-part-placeholder.js   # 🧩 library-external part placeholder
│   ├── wokwi-automate.js              # 🌐 Auto browser simulation script
│   └── run-tests.js                   # 🧪 regression (dev-only)
└── references/
    ├── common/                        # 🧠 layout system (any board)
    │   ├── geometry.json              # 📐 breadboard geometry (single source)
    │   ├── pins.json / sizes.json     # 📏 pin coords / canvas sizes
    │   ├── intent-format.md           # 📋 layout-intent.json contract
    │   ├── layout-rules.md            # 📐 layout/wiring rules
    │   ├── generic-wiring.md          # 🔌 fallback for unknown parts
    │   ├── breadboard.md / waypoints.md
    │   └── layout-cards/              # 🧩 per-component preference cards
    ├── arduino/
    │   ├── components.md              # 📖 Component reference manual (high-freq)
    │   ├── index.json                 # 🗂️ Full catalog: type + pins + zh names
    │   ├── experience.json            # 📚 Agent-learned wiring patterns & tips
    │   └── detail/*.json              # Per-component details (50 files)
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

**Wokwi Arduino 仿真 Skill** — v0.5.0 — 一个可移植的技能包，专为 AI 编程助手（DeepCode、WorkBuddy、Claude Code、Cursor）设计，实现自动化硬件原型设计、**自动浏览器仿真**、代码编译和固件上传。

### 功能

- 🤖 **AI 驱动** — 直接跟助手描述你的硬件想法，无需手动查引脚
- 🌐 **自动浏览器仿真** — `wokwi-automate.js` 自动打开 wokwi.com、填入代码和电路图，交给用户点击启动仿真（浏览器回退链：Chrome → Edge → Chromium）
- 🔢 **多板型（Uno/Mega/Nano/ESP32）** — compile.sh 自动从 diagram.json 推断 FQBN，无需配置
- ⚡ **一键编译** — 自动安装 `arduino-cli` + Uno 核心，编译 `.ino` 到 `.hex`，处理 MINGW 路径转换
- 🔌 **跨 Agent** — 支持 DeepCode、WorkBuddy（`SKILL.md`）、Claude Code（`CLAUDE.md`）和 Cursor（`.cursorrules`）
- 🧩 **元件目录（50 种）** — `index.json` 全量目录（含中文名+引脚），`detail/` 分元件详情，从 wokwi-elements 源码自动提取；中文名匹配 + 歧义询问
- 📚 **经验库** — `experience.json` 累积验证过的接线模式和布线技巧（agent 自学习）
- 🛠️ **整洁布线** — 支持电阻旋转和路由控制点，生成清晰的电路图
- 🔍 **克隆板识别** — 通过 VID/PID 检测 CH340/CP2102/FTDI 芯片（Windows PowerShell / macOS system_profiler / Linux lsusb），为克隆板提供 FQBN 建议
- ✅ **安全上传** — 上传前始终请求用户确认（端口 + 板型 + FQBN），绝不静默烧录
- ⚠️ **硬件核对** — 接实物前确认元件型号/版本与模拟一致，提示接口差异（如 OLED 的 I2C/SPI）和模拟器限制

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
├── adapters/
│   ├── deepcode/SKILL.md              # DeepCode 技能文件
│   ├── workbuddy/SKILL.md             # WorkBuddy 技能文件
│   ├── claude/CLAUDE.md               # Claude Code 技能文件
│   └── cursor/.cursorrules            # Cursor 规则文件
├── scripts/
│   ├── compile.sh                     # 跨平台编译/上传脚本
│   ├── layout-generator.js            # 🧠 intent → diagram.json（坐标）
│   ├── optimize-wiring.js             # ✅ 布线冲突检测/修正
│   ├── generate-part-placeholder.js   # 🧩 库外元件占位符
│   ├── wokwi-automate.js              # 🌐 自动浏览器仿真脚本
│   └── run-tests.js                   # 🧪 回归测试（开发期）
└── references/
    ├── common/                        # 🧠 布局体系（任何板型）
    │   ├── geometry.json              # 📐 面包板几何（单一事实源）
    │   ├── pins.json / sizes.json     # 📏 引脚坐标 / 画布尺寸
    │   ├── intent-format.md           # 📋 layout-intent.json 契约
    │   ├── layout-rules.md            # 📐 布局/布线规则
    │   ├── generic-wiring.md          # 🔌 未收录元件兜底
    │   ├── breadboard.md / waypoints.md
    │   └── layout-cards/              # 🧩 元件偏好卡
    ├── arduino/
    │   ├── components.md              # 📖 元件参考手册（高频）
    │   ├── index.json                 # 🗂️ 全量目录：type + 引脚 + 中文名
    │   ├── experience.json            # 📚 agent 自学习接线模式与布线技巧
    │   └── detail/*.json              # 分元件详情（50 个）
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
