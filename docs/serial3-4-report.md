# 序列3/4 报告：入口分诊、交互交付与本地烧录

- 日期：2026-11-24
- 仓库：`F:/git repo/Skill-development/Skill-HardwarEasySim-Wokwi`（上一提交 `93ecac4`）
- 依据：文档 44（序列3）、45/27（交互与静态交付）、47（本地烧录与工具链）

## 1. 交付物

| 文件 | 作用 |
|---|---|
| `references/common/intake-routing.md` | 入口分诊四类（功能目标/清单或引脚表/代码或工程/商品名或照片）、交给绘图的最小内容、确认节奏、三组验收用例 |
| `references/common/interaction-delivery.md` | 主动静态展示、三档交付状态（已核对成图/缺浏览器证据/诊断草稿）、SVG/文字降级、合并确认、验收四情景 |
| `references/common/flash-workflow.md` | 触发条件、CLI 三选择、FQBN/core/库检查、逐端口设备证据、单/多/零板、上传五态、Uno/Nano/Mega/ESP32 映射 |
| `scripts/flash-arduino.js` | 零依赖封装：`--detect/--list/--board/--compile/--upload/--confirm/--simulate`；未确认拒绝上传（exit 3）；模拟模式不碰 CLI/设备 |
| `adapters/workbuddy/SKILL.md` | 共享入口新增「需求入口（序列3）」「静态展示与交付（序列4）」两节；自愈清单补 check-required/flash-arduino 与 4 份新参考 |
| `scripts/run-tests.js` | 新增烧录封装模拟回归 4 项（授权门、esp32 映射、nano 映射、编译计划） |

## 2. 实跑证据

### 2.1 真实编译（本机 arduino-cli 1.5.1；核心 arduino:avr 1.8.8 / esp32:esp32 4.0.0-alpha1-cn）

| 板型 | 命令 | 结果 |
|---|---|---|
| Uno | `node scripts/flash-arduino.js --board uno --dir <sketch>` | 编译成功（`arduino:avr:uno`，产物 .hex） |
| Nano | `--board nano` | 编译成功（`arduino:avr:nano`） |
| Mega | `--board mega` | 编译成功（`arduino:avr:mega`） |
| ESP32 DevKit V1 | `--board esp32` | 编译成功（`esp32:esp32:esp32`，产物 **.bin**，未误报 .hex） |

均为临时 `void setup(){} void loop(){}` 工程；**未执行任何上传**（无用户写入授权/设备）。编译前后未修改用户 PATH、配置或核心目录。

### 2.2 模拟回归（`node scripts/run-tests.js` → **39 passed, 0 failed**）

- `flash-upload-no-confirm`：无 `--confirm` → exit 3，输出「未提供 --confirm」，上传调用 0；
- `flash-esp32-confirm`：模拟上传 → exit 0，含 `esp32:esp32:esp32`、`.bin`、「上传器一次」；
- `flash-map-nano`：映射输出 `arduino:avr:nano`；
- `flash-compile-plan`：模拟编译 → exit 0，产物类型 `.hex`，无上传。

### 2.3 包结构（重建后）

`node packaging/build-plugin.js` → scripts 16 / references 94；`node packaging/check-plugin.js` → **8 ok, 0 error**，含共享入口冒烟（包内生成 + 需求对账通过）。

## 3. 与文档47 验收表的对照

| 现场 | 本轮状态 |
|---|---|
| 纯绘图（安装/枚举/上传 0 次） | 模拟用例与 SKILL 指令覆盖；代码路径不需要 CLI |
| CLI 可用但不在 PATH | 封装会查 PATH/常见路径/`ARDUINO_CLI`；**未构造非 PATH 实机场景**（待验） |
| 缺 CLI 三选择 | 输出「安装并继续 / 指定已有路径 / 稍后」，不自动安装（未在无 CLI 环境实测） |
| 缺核心/缺库/安装失败 | core 精确检查已实现并实测（avr/esp32 均已装，缺核心分支用代码路径覆盖）；缺库未实测 |
| 仅云端/设备访问受限 | 文档与 SKILL 明确「云端只展示，上传交本地 Agent」；本机无板，未实测 |
| 零板/单板/多板/目标变化 | `--list` 保留逐端口 VID/PID/描述；**无板可插，全部待验** |
| 真机上传 | **待验**：需用户提供板子、端口与明确写入授权；本轮只到真实编译 |

## 4. 未覆盖

- 序列3 的三组对话验收（采购 vs 出图、连接已定/只有 A0/冲突程序、商品名+补丝印）未实跑，属模型行为验收，需在真实对话中按文档44 复核。
- 设备枚举/选择/上传的实机分支（零/单/多板、型号不明、目标变化）待有板后执行。
- WorkBuddy 市场包需在 SKILL 改动后重新生成（版本号需递增，另行发布）；本轮只更新了开发仓库与 Agent Plugin 包。
- ChatGPT 宿主入口仍待账号实测（序列2 遗留）。
