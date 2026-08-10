---
name: wokwi-arduino
description: Create, compile, simulate, and upload Arduino projects with Wokwi. Use when the user mentions Arduino, Wokwi, 单片机, 嵌入式, or when .ino / wokwi.toml / diagram.json files are detected. Explicitly activate with @wokwi, #arduino, or @simulate.
---

# Arduino Wokwi Simulation Skill (v0.4.0) — WorkBuddy Adapter

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

## 完整工作流

1. **生成** — 写 `.ino` 代码，查 `references/uno/index.json`（中文名匹配）→ components.md → experience.json，生成 `diagram.json` + `wokwi.toml`
2. **编译** — `./scripts/compile.sh <dir>`（自动装 arduino-cli，MINGW 路径已处理）
3. **仿真** — 环境检测: 用户有 VS Code + Wokwi 插件 → Mode B（F1 手动，零依赖）。仅用户要求自动浏览器仿真（@simulate）或无插件 → Mode A: `node scripts/wokwi-automate.js <dir>`（浏览器回退链 Chrome→Edge→Chromium）。**HARD RULE: 未经用户明确同意，绝不安装 playwright 或任何 npm 包——缺少时先询问用户**
4. **确认** — 询问用户"仿真效果是否正确？"
5. **检测板子** — `arduino-cli board list`。**HARD RULE: 上传前必须向用户展示端口/板型/FQBN 并确认，禁止静默上传**（单板也要确认）。CH340 克隆板显示 Unknown 属正常，用 `--fqbn arduino:avr:uno`
6. **上传 + 串口** — `compile.sh --upload --port --fqbn --monitor`

## 设计守则（强制）

1. 脚本失败 → 降级 `references/monaco-steps.md` 原生操作，禁止重试脚本
2. 脚本只"填和点"，代码/电路图由 agent 生成
3. 原生操作步骤保留在 references 供降级

## 自愈检查（强制，激活时执行）

⚠️ **WorkBuddy 市场同步可能只拉取 SKILL.md，导致 scripts/ 和 references/ 缺失。激活时必须先检查并恢复：**

```bash
# 检查并恢复缺失文件
BASE="https://raw.githubusercontent.com/YuchengCai/Skill-HardwarEasySim-Wokwi/main"
for F in scripts/compile.sh scripts/wokwi-automate.js references/monaco-steps.md references/uno/components.md references/uno/index.json references/uno/experience.json; do
  if [ ! -f "$F" ]; then
    echo "缺失 $F，正在从 GitHub 恢复..."
    mkdir -p "$(dirname "$F")"
    curl -fsSL "$BASE/$F" -o "$F"
  fi
done
```

⚠️ 若目录仍是旧结构（`core/` 而非 `scripts/` + `references/`），请删除旧目录并重新安装，或手动迁移文件。

## 版本检查

当前版本: **v0.4.0**
仓库: `https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi.git`

激活时检查最新 release，有新版本询问用户是否更新（git clone + install.sh）。⚠️ 更新时使用 `install.sh --global`（WorkBuddy 本身固定全局）。
