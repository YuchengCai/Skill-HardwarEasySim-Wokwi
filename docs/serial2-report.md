# 序列2 · 跨宿主可移植包报告（文档43）

- 日期：2026-11-24
- 仓库：`F:/git repo/Skill-development/Skill-HardwarEasySim-Wokwi`（基线 `8d00969`）
- 目标：共享一份 SKILL.md、脚本与参考资料，按宿主识别的层级/元数据/资源路径生成交付包；旧入口保留。

## 1. 交付物

| 文件 | 作用 |
|---|---|
| `packaging/plugin.json` | Agent Plugins 1.0.0 manifest（$schema/name/version/description/author/license/homepage/repository/keywords；name 符合小写/点/连字符约束） |
| `packaging/mcp.json` | 可选 browser MCP 声明：stdio `npx -y @playwright/mcp@latest`（宿主无浏览器时不强制） |
| `packaging/build-plugin.js` | 组装 `dist/plugin/`：plugin.json + mcp.json + skills/wokwi-arduino/{SKILL.md, scripts, references} + README；排除开发脚本与开发文档；`--zip` 生成压缩包 |
| `packaging/check-plugin.js` | 结构检查 + 共享入口冒烟：plugin.json/mcp.json 字段、SKILL.md frontmatter、@references/scripts 解析、顶层条目白名单、包内 layout-generator + check-required 实跑 |
| `references/common/host-integration.md` | 宿主能力矩阵、静态预览顺序、24h 更新节流、旧安装迁移、烧录职责边界 |

共享入口 `SKILL.md` 采用已产品化的 `adapters/workbuddy/SKILL.md`（单一源，不复制规则正文）；构建时与 scripts/references 一起复制，包内脚本从自身位置解析资料。

> 2026-11-24 追加：仓库已迁移为**原生布局**——根 `plugin.json`、`mcp.json`、`skills/wokwi-arduino/SKILL.md`（规范共享入口，去掉 WorkBuddy 专属措辞，宿主差异指向 `host-integration.md`）；`packaging/` 以根清单与规范入口为源组装 `dist/plugin`。旧 `adapters/` 保留为兼容入口，不再作为构建源。

## 2. 实跑结果

```text
node packaging/build-plugin.js
[OK] Agent Plugin 组装完成: .../dist/plugin
     skills/wokwi-arduino/scripts: 15 文件
     skills/wokwi-arduino/references: 90 文件

node packaging/check-plugin.js
  ✔ 顶层条目: README.md, mcp.json, plugin.json, skills
  ✔ plugin.json: name=wokwi-arduino version=0.6.0
  ✔ mcp.json: playwright
  ✔ SKILL.md frontmatter: name/description 存在
  ✔ scripts 提及 14 个全部可解析
  ✔ 包内文件: 106 个
  ✔ 共享入口冒烟: layout-generator + check-required 在包内可执行并通过
结果: 8 ok, 0 warn, 0 error
```

冒烟使用 `tests/cases/req-bb-locked/intent.json`（含锁定孔/桥接），从包内脚本生成并做需求对账 → 证明包内相对资源解析与运行入口可用，不依赖开发机路径。

## 3. 旧入口保留

- `install.sh`、`adapters/*`、`publish-skillhub.sh` 均未改动；WorkBuddy 市场标识仍为 `workbuddy-hardwareasysim-wokwi`（结构检查见序列1发布记录）。
- Agent Plugins 包是新增交付，不移除旧入口；迁移期可并行。

## 4. 宿主实测状态

| 宿主 | 状态 |
|---|---|
| DSH | 包内脚本冒烟通过；「新工程加载通用 skill → 自然语言绘图」的完整宿主路径待验（本会话无法模拟全新宿主安装） |
| ChatGPT | **待验**（缺目标账号；需 Plugins → Skills → Create/Upload 实测 @ 显式与自然语言两条入口、资源读取、附件下载） |
| WorkBuddy | 结构检查沿用 `publish-skillhub.sh`/自愈清单；市场版本 0.6.0 已发布待审核切换；插件包不等于市场包 |
| Codex/Cursor | 可作为兼容对照，未实测运行能力（如实标注） |

ZCode 市场与 DSH 专属插件另期（文档43/25 边界）。

## 5. 未覆盖

- ChatGPT 账号侧实测（安装入口、脚本运行、预览通道）——需要用户账号与环境。
- 更新检查的 24h 节流/并发合并/离线重试的产品实现（本轮写在共享参考，未接宿主事件）。
- 旧安装自动迁移脚本（链接/复制/规则块三种形态）未实现，仅记录处理原则。
- WorkBuddy 市场包与本插件包的差异（扁平 references/scripts vs 嵌套）仍需在发布脚本中保持两套构建。
