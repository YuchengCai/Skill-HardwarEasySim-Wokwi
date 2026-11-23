# 宿主集成与跨宿主分发（序列2/文档43）

本文件是共享入口的参考页，不绑定单一宿主。安装、授权、更新由各宿主自己的插件机制执行；本 skill 只负责共享规则、脚本与资料。

## 可移植包形状（Agent Plugins 1.0.0）

```
wokwi-arduino/
├── plugin.json          # $schema / name / version / description / author / license / homepage / keywords
├── mcp.json             # 可选：声明 browser MCP（stdio 的 Playwright MCP）
├── skills/
│   └── wokwi-arduino/
│       ├── SKILL.md     # 共享入口（本文件所在 skill）
│       ├── scripts/     # 运行时脚本（生成/对账/检查/烧录）
│       └── references/  # 规则、数据、卡片（按需读取）
└── README.md
```

构建与检查：`node packaging/build-plugin.js [--zip]`、`node packaging/check-plugin.js`。包内脚本只从自身位置解析 `references/`，不依赖开发机路径。

## 宿主能力矩阵（按实测填写，未实测标 pending）

| 能力 | DSH（开发/使用宿主） | ChatGPT 聊天端 | WorkBuddy | 其他（Codex/Cursor…） |
|---|---|---|---|---|
| 安装/加载 | 通用 skill 目录/插件包 | Plugins → Skills → Create/Upload（需账号与工作区支持） | 市场包（保留原标识 `workbuddy-hardwareasysim-wokwi`） | 按各宿主发现路径 |
| 自然语言触发 | 支持 | 支持（@ 显式或自然语言） | 支持 | 视宿主 |
| 读取随包 scripts/references | 支持（本地文件） | 需宿主允许脚本/资源访问 | 支持（本地安装目录） | 视宿主 |
| 文件交付（diagram.json/占位件） | 本地写工程目录 | 聊天附件下载 | 本地工程 | 视宿主 |
| 静态 Wokwi 预览 | 本机浏览器/CDP 或 VS Code 插件 | 云端浏览器/无则 SVG/文字 | 本机浏览器 | 视宿主 |
| 本机 USB 烧录 | 本地 Agent 执行 | 不可（云端会话），交本地 Agent | 本地 Agent | 视宿主 |

> 记录宿主版本、实际入口、已测能力与降级反馈；缺账号/缺浏览器时保留待验，不把「包结构通过」写成「运行能力已通过」。

## 浏览器/静态预览

1. 宿主已有 Wokwi VS Code 插件或已授权的浏览器 MCP → 直接复用（不重复注册）。
2. 需要新建会话时：Playwright MCP 在隔离上下文打开与板型匹配的 Wokwi 项目（Uno = `https://wokwi.com/projects/new/arduino-uno`），`browser_resize` 1920×1080。
3. 浏览器不可用、启动失败或用户拒绝：按用户选择生成**本地 SVG**或**纯文字接线表**；不反复尝试启动。
4. 云端浏览器只负责展示与核对连线；USB 枚举、串口选择、固件上传由具备本机设备访问能力的本地 Agent 执行。

## 更新检查（自行管理的安装）

- 宿主明确启用本 skill 时读取本地检查记录；宿主只在启动时扫描全部 skill 或无启用事件时，推迟到本 skill 首次实际调用。
- 默认每 24 小时最多自动联网检查一次；同一安装的多个会话合并请求；离线/超时后按期再试；用户主动「检查更新」立即检查。
- 已是最新版保持安静；发现更新在合适停顿处给「更新到该版本／稍后」；选稍后本次会话不再提醒。
- 正在运行的绘图任务使用启动时版本；需要切换时任务结束后执行。
- 旧安装可能是链接、复制目录或追加到 `CLAUDE.md`/`.cursorrules` 的规则块：只迁移能辨认的自有内容；遇到本地改动或归属不明时保留原文并展示待处理差异；先验证候选包再切换，失败恢复先前入口；重复执行后只加载一份规则。

## 迁移与旧入口

- 保留旧安装方式与已有工作区的调用入口（`install.sh`、旧 adapters、GitHub Release 渠道）。
- 业务规则只保留一份共享来源，宿主适配层只写「安装路径/元数据/工具名映射」，不复制规则正文。
- 旧用户升级：从一份真实旧安装触发升级，确认用户看到的目标版本就是最终加载版本；只发布新市场或只更新仓库文件不算旧用户已收到升级。
