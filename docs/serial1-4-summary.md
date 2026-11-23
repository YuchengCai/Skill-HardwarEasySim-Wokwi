# 交接包四序列开发索引（2026-11-24）

生产仓库：`F:/git repo/Skill-development/Skill-HardwarEasySim-Wokwi`。以下按交接包文档 25 的顺序列出实现、证据、报告与待验项。

| 序列 | 交付 | 报告/证据 | 状态 |
|---|---|---|---|
| 1 · 文档42 锁定接点与必需网络 | `scripts/check-required.js`、显式孔位解析、预检/对账 exit 3、`tests/cases/req-*`、`tests/checks/*` | `docs/serial1-task42-report.md`；`node scripts/run-tests.js` | 通过（26 项回归时为基线；现 40 项） |
| 1 · 文档24 连线反馈 | `near-hole`、`overlap-collinear/near`、证据绑定；`tests/task1/*` | `docs/serial1-task24-report.md` | 通过（7 处旧误报不触发改线；22t.e 命中；SCL×5V 共线） |
| 1 · 文档41 离体/近贴 | `--egress-report` 诊断；`tests/task41/*` | `docs/serial1-task41-report.md` | 通过（诊断口径；阈值待校准） |
| 1 · 文档46 陌生组合 | 光敏/按键/蜂鸣器/舵机组合、布局搜索、通用插接与落轨避让、1920×1080 渲染证据 | `docs/serial1-task46-report.md`；`tests/holdout/serial1/`、`tests/cases/holdout-serial1`、`docs/evidence/serial1-holdout-render-1920x1080.png` | **通过**（需求 12/12、几何硬冲突 0、渲染证据已补；独立读者测试另期） |
| 2 · 文档43 跨宿主包 | `packaging/{plugin.json,mcp.json,build-plugin.js,check-plugin.js}`；`references/common/host-integration.md` | `docs/serial2-report.md`；build 16 scripts/94 refs，check 8 ok | 结构通过；ChatGPT/DSH 完整宿主路径待验 |
| 3 · 文档44 入口与选型 | `references/common/intake-routing.md`；SKILL 新增「需求入口」节 | `docs/serial3-4-report.md` | 设计+指令入库；三组对话验收待跑 |
| 4 · 文档45/27 交互与静态交付 | `references/common/interaction-delivery.md`；SKILL 新增「静态展示与交付」节 | 同上 | 指令入库；未做真实对话验收 |
| 4 · 文档47 本地烧录 | `scripts/flash-arduino.js`、`references/common/flash-workflow.md` | 同上；Uno/Nano/Mega/ESP32 真实编译成功 | 编译通过；设备枚举/真机上传待用户授权与硬件 |

## 可复跑命令

```bash
node scripts/run-tests.js                 # 40 passed, 0 failed
node packaging/build-plugin.js            # dist/plugin
node packaging/check-plugin.js            # 8 ok, 0 error
node scripts/flash-arduino.js --simulate --board esp32 --dir <sketch> --upload --confirm
```

## 未覆盖（需用户/环境）

- 文档46：板→轨馈线穿插入件、同网桥接重叠口径、光敏脚距插接方案——需继续开发后再验收；
- 真机烧录：设备枚举/单多零板/实际上传——需具体板子、端口与明确写入授权；
- ChatGPT 宿主：目标账号实测 @ 显式/自然语言两入口；
- WorkBuddy 市场：本轮 SKILL 变化后需升版本重建发布包。
