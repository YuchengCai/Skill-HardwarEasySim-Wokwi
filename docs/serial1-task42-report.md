# 序列1 · 文档42 开发报告：锁定接点与必需网络完整性

- 日期：2026-11-24
- 生产仓库：`F:/git repo/Skill-development/Skill-HardwarEasySim-Wokwi`
- 基线提交：`ab68cfbf70ddd71125b5ad67ffb37c6f0de0e8f9`
- 依据：交接包《Wokwi-EasySim-开发交接包-20261124》文档 42（输入与验收）、40（基线记录）

## 1. 修改前（基线故障复现）

复跑命令（路径按本机环境）：

```bash
node scripts/layout-generator.js <包>/skill-retest/sol56/layout-intent.json <out>/sol56
node scripts/optimize-wiring.js <out>/sol56 --dry-run
node scripts/layout-generator.js <包>/skill-retest/terra61/layout-intent.json <out>/terra61
```

- **sol56**：意图中 4 条显式孔位连接（`pot1:GND→bb1:3b.j`、`btn1:1.l→bb1:8t.a`、`bb1:8t.b→bb1:3b.i`、`uno:GND.2→bb1:8t.c`）全部报「引脚坐标缺失」被跳过；图里没有 8a/3j 地线；`--dry-run` 报 4 处网表断链（+4 处按钮插接对齐）。
- **terra61**：孔名写作 `bb1:ta.8`/`bj.3`/`tb.8`/`bi.3`/`tc.8`（非法格式），生成器同样静默跳过，剩余 4 线 `--dry-run` 报零冲突 —— 残图被误认为可交付。

根因：`pinPos` 对 `bb1` 只查 `pins[bb.type]`，而 `pins.json` 没有面包板引脚表 → 显式孔位端点恒为 null，连接被跳过；且没有生成前/生成后的需求校验。

## 2. 修改内容

| 文件 | 改动 |
|---|---|
| `scripts/check-required.js`（新增） | 需求对账与网络完整性检查：①端点合法性（板/普通元件/`chip-<name>` 按随图 `*.chip.json` 声明解析，未声明键报 `INVALID_PIN`）②并查集重建网络（可见导线 + `$bb` + 面包板行半区/轨内部导通 + Uno `GND.*` 板内共地）③逐条需求对账（缺线/断网/指定孔位移动）④占孔冲突（同一孔被多条连接占用）。独立 CLI：`node scripts/check-required.js <intent> [--dir <dir>] [--json]`，退出码 0/3/1。 |
| `scripts/layout-generator.js` | ①新增显式面包板端点解析（`bb1:8t.a` 孔、`bb1:tn.25` 轨位），不再报「引脚坐标缺失」②生成前预检：非法孔名（如 `ta.8`）、越界行号/字母、重复占孔 → `exit 3` 且不生成③显式孔位登记占用，自动分孔/落轨避让④显式端点板源线额外让一条走廊（修复锁孔地线与 5V 主线 1 单位近贴）⑤生成后自动调用 `check-required` 对账：缺线/锁孔移动/网络误并 → `exit 3`，`diagram.json` 保留为诊断草稿、不打印 `[OK]`。 |
| `scripts/optimize-wiring.js` | 收窄 LED 家族「意外缩小」绊线：仅 `type.includes('led')` 触发，避免按钮检测矩形被误报（既有行为，与本次需求无关）。 |
| `references/common/intent-format.md` | 新增「显式面包板端点（锁定接点）」：孔/轨写法、重复占用与失败语义（`exit 3`）、独立验收命令。 |
| `scripts/run-tests.js` | 用例支持 `expect.genExit` / `skipOptimize`；新增 `tests/checks/` 端点验收段（intent + diagram + `expect.checkExit`）。 |

## 3. 修改后（证据）

```text
# sol56
[OK] 需求对账：7/7 条必需连接全部满足
[OK] 面包板布局：1 插面板 + 1 直连 + 4 条 $bb + 8 条可见线
（diagram.json 含 pot1:GND→bb1:3b.j、bb1:15b.f→bb1:8t.a、bb1:8t.b→bb1:3b.i、uno:GND.2→bb1:8t.c）

# terra61
[FAIL] 意图中的面包板端点预检未通过：
  - 连接#0 to=bb1:bj.3：非法面包板引用（应为 <row><t|b>.<a-j> 或 <tn|tp|bn|bp>.<1-25>）
  …（共 5 条）
exit 3
```

回归（`node scripts/run-tests.js`）：**26 passed, 0 failed**，含新增：

- `tests/cases/req-bb-locked`：sol56 同题，生成 exit 0、7/7 对账通过、8a/3j 地线存在
- `tests/cases/req-invalid-bb-ref`：terra61 同题，预检 exit 3（非法孔名）
- `tests/cases/req-bad-pin`：无效引脚键 → 对账 exit 3（`未声明的引脚键`）
- `tests/checks/chip-raw-invalid`：原始图用未声明数字键 `sensor:1/12/7` → exit 3（端点检查阶段定位）
- `tests/checks/chip-corrected`：修正版 `LV/HV/JP4_GND` → exit 0
- `tests/checks/chip-wrong-ground`：地线改为 `JP3_GND`（保留"HV 同列"要求）→ exit 3（需求#2 不在同一网络）
- `tests/checks/bb-bridge-missing`：删掉唯一桥线后的残图 → exit 3（断网，残图不可交付）
- `tests/checks/bb-locked-moved`：锁孔 3b.j 被移到 3b.i 的图 → exit 3（指定孔未被实体线接入）

## 4. 对照文档 42 验收表

| 输入/单项变化 | 结果 |
|---|---|
| 同题正例（生成器从意图生成） | 8a、3j 分别保留，三端共地（`bb1:8t.b→bb1:3b.i` 桥接存在），其余网络独立接通 → **通过** |
| 只移动一个未锁定的桥接端到同组空孔 | 生成器保留自动分孔能力（既有用例 `layout-*` 全过），未锁定端可自由分配 → **通过** |
| 去掉唯一桥线 | `bb-bridge-missing` 残图 → 断网检出，不打印 `[OK]` → **通过** |
| 只把已锁定的 8a 改到同组空孔 | `bb-locked-moved` → 指定孔未被接入检出 → **通过** |
| 两根实体线占用同一孔 / 信号误入地网 | 占孔冲突 `DUPLICATE_HOLE` 检出；网络误并由对账断网检出 → **通过** |
| 孔名无法解析 / 生成时跳过必需线 | 预检 exit 3（terra61）；`req-bad-pin` 对账 exit 3 → **通过** |
| 无锁孔旧意图、同步改实例 ID、未调试列号 | 既有 17 个布局用例不改动全部通过；`check-required` 不依赖实例名/固定列 → **通过** |

## 5. 未覆盖 / 待验

- 视觉像素级比对（1920×1080）与真实浏览器渲染证据留给文档 24/41 的几何验收；本轮只做几何文件与网络级核对。
- 按钮 `$bb` 4 处 `bb-misaligned`（>0.5px 对齐）为基线既有问题（文档 40 已记录），不在本任务范围，留给序列 1 后续任务。
- 移动锁孔/占孔冲突的"候选版本局部修订"闭环（改后重生成并复查邻线）尚未做成交互命令，仅提供逐项报告。
- 面包板内部导通模型按仓库既定口径（t 半区 a-e、b 半区 f-j、整条轨连通）；若后续渲染实测发现分组差异，需重开该模型。

## 6. 复跑

```bash
node scripts/run-tests.js
node scripts/layout-generator.js tests/cases/req-bb-locked/intent.json <tmp>
node scripts/check-required.js tests/cases/req-bb-locked/intent.json --dir <tmp>
```
