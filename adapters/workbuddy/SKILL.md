---
name: wokwi-arduino
description: Create, compile, simulate, and upload Arduino projects with Wokwi. Use when the user mentions Arduino, Wokwi, 单片机, 嵌入式, or when .ino / wokwi.toml / diagram.json files are detected. Explicitly activate with @wokwi, #arduino, or @simulate.
---

# Arduino Wokwi Simulation Skill (v0.5.4) — WorkBuddy Adapter

WorkBuddy 专用的 wokwi-arduino skill 适配器。与 deepcode/claude/cursor 适配器内容一致，仅安装路径不同。

## 与其它适配器的区别

| 项 | WorkBuddy | DeepCode |
|----|-----------|----------|
| 安装位置 | `~/.workbuddy/skills/wokwi-arduino/` | `./.agents/skills/wokwi-arduino/` |
| MCP 配置 | `~/.workbuddy/mcp.json` | `~/.deepcode/settings.json` |
| 激活方式 | 关键词 + @wokwi / @simulate | 关键词 + @wokwi / @simulate |

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

1. **生成** — 写 `.ino` 代码，查 `references/arduino/index.json`（中文名匹配）→ components.md → detail/。写 `layout-intent.json`（语义意图，无坐标；契约 `references/common/intent-format.md`，偏好 `references/common/layout-cards/`；`breadboard` 可留空，脚本自动兜底 bus 场景）→ `node scripts/layout-generator.js layout-intent.json <dir>` 生成 `diagram.json` → `node scripts/optimize-wiring.js <dir> --dry-run` 检测冲突 → 生成 `wokwi.toml`
2. **编译** — `./scripts/compile.sh <dir>`（自动装 arduino-cli，MINGW 路径已处理）
3. **仿真** — 环境检测: 用户有 VS Code + Wokwi 插件 → Mode B（F1 手动，零依赖）。仅用户要求自动浏览器仿真（@simulate）或无插件 → Mode A。**Mode A 主路径：Playwright MCP**（按 monaco-steps.md 操作，无需 node）。**备用路径：node scripts/wokwi-automate.js**（仅当能执行命令且无 MCP 时）。**HARD RULE: 未经用户明确同意，绝不安装 playwright 或任何 npm 包**
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
5. `references/arduino/index.json`（中文名匹配）→ `components.md` → `detail/<type>.json`
6. `references/arduino/experience.json` — 累积接线经验

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

## 自愈检查（强制，激活时执行）

⚠️ **WorkBuddy 市场同步可能只拉取 SKILL.md，导致 scripts/ 和 references/ 缺失。激活时必须先检查并恢复：**

```bash
# 检查并恢复缺失文件
BASE="https://raw.githubusercontent.com/YuchengCai/Skill-HardwarEasySim-Wokwi/main"
for F in scripts/compile.sh scripts/wokwi-automate.js scripts/layout-generator.js scripts/optimize-wiring.js references/monaco-steps.md references/arduino/components.md references/arduino/index.json references/arduino/experience.json references/common/intent-format.md references/common/layout-rules.md references/common/generic-wiring.md references/common/breadboard.md references/common/waypoints.md references/common/geometry.json references/common/boards.json references/common/pins.json references/common/sizes.json references/common/layout-cards/index.md references/common/layout-cards/led.md references/common/layout-cards/resistor.md references/common/layout-cards/pushbutton.md references/common/layout-cards/dht22.md references/common/layout-cards/oled.md references/common/layout-cards/buzzer.md; do
  if [ ! -f "$F" ]; then
    echo "缺失 $F，正在从 GitHub 恢复..."
    mkdir -p "$(dirname "$F")"
    curl -fsSL "$BASE/$F" -o "$F"
  fi
done
```

⚠️ 若目录仍是旧结构（`core/` 而非 `scripts/` + `references/`），请删除旧目录并重新安装，或手动迁移文件。

## 版本检查

当前版本: **v0.5.4**
仓库: `https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git`

激活时检查最新 release，有新版本询问用户是否更新（git clone + install.sh）。⚠️ 更新时使用 `install.sh --global`（WorkBuddy 本身固定全局）。
