# Layout Rules — Board Layout Guidelines (v2)

> 系统级通用布局规则（适用于所有板型/元件）。生成 `diagram.json` 时参考。
> v2：布局-走线协同框架（模型无视觉 → 数字规则补偿 + 一体设计）。
> 验证来源：18+ 真实项目 + 用户手动布线模板。

## 核心认知：布局与走线必须协同

```
人类（有视觉）：一开始有"画面" → 元件分布 + 走线同时成型
模型（无视觉）：只能从坐标判断 → 缺空间直觉

→ 布局决定走线可行性，走线反馈布局
→ 一体设计：布局时预判走线，走线时受布局约束
→ 规则 = 把视觉直觉翻译成数字条件（间距阈值/通道/平行）
```

## 协同框架（3 层）

```
① 布局规划（含走线预判）
   元件放哪 → 同时预判每条线走向
   检查：线被遮挡？平行线有空间？通道够？
   位置不对 → 提前调整

② 走线规划（受布局约束）
   线路径 → 检查空间：遮挡/交叉/重叠/平行间距
   不够 → 调整节点，或回退调整布局

③ 协同校验（检测脚本）
   布局层 + 走线层双向检查（预防 + 检测）
```

## Rule 1: Choose wiring style

**主判据 = 电源拓扑 fanout**（与 `layout-generator.js` 一致）：

> 任一电源家族（GND / 5V / 3.3V / VIN）的板脚**需求 > 可用脚数**（Uno：GND×2、5V×1、3.3V×1、VIN×1，`boards.json powerPinCounts`）→ 声明面包板，电源走轨分发（生成器自动检测并输出 `[INFO] 电源 fanout:…`）。
> 需求 = 引用该家族板脚的连接数 + 面包板主线 1 条。例：5 个模块 VCC 全接 `uno:5V` → 需求 6 > 脚 1 → 走轨。

**面包板定位**：主用法是**离散元件插接**（电阻/LED/按钮 $bb 插孔、跨槽、同列配对），轨分发是次要收益——只走轨不插件 = 空面包板（生成器 WARN：轨连接 < 2）。离散元件直连须在 intent 写 `reason`（一句话理由），缺失即 WARN。

元件数量**不是判据**（弱参考：≤4 且电源各自独立，通常直连即可）。

## Rule 2: Functional grouping + position (layout planning)

**① Functional grouping (功能组合靠近) — plan from the start:**

- Related parts are placed TOGETHER from the beginning:
  - LED + resistor (series circuit as a group)
  - Button group (input area)
  - Sensor + display (signal chain)
- Or use breadboard to organize (complex / shared-power scenarios → parts around breadboard)
- Don't scatter related parts far apart

**② Around the board's REAL rendered area:**

- Parts must NOT enter the board's actual rendered rectangle
  (Uno 72.58×53.34, Mega/ESP32 per their viewBox)
- Not "around the geometric center" — clear the real image boundary
- Keep distance from board: enough for wire routing (≈100-500 units)

**③ Spacing for wire channels:**

- Minimum part spacing: ≥ 30 units (prevent overlap)
- Leave "wire channels" between parts (parallel lines need space)
- Pre-judge: would a wire from A to B cross another part? Adjust position early
- Large parts (LED ring / LCD / any module ≥ 60×60): keep ≥ 150 units clearance from other parts and from power-return corridors; a long rail/power line must never cross a large part's body — if it happens, move that group's `region` and regenerate

## Rule 3: Clean waypoint pattern + routing discipline

- Source pin exits on its own side first (digital up / power-analog down — see `waypoints.md`)
- Then 1-2 intermediate nodes: vertical to safe height → horizontal → vertical to target
- Same-function wires stay PARALLEL (consistent, tidy)
- Keep waypoints simple — complex multi-segment paths look messy

**Avoid converging wires (共线):** when multiple wires target the SAME pin, give each a different path so they arrive separately — otherwise the auto-router merges them into one shared line (confusing).

```json
["led1:C", "uno:GND.1", "black", ["v-120", "h10"]],     // approach from left
["btn1:2.r", "uno:GND.1", "black", ["v-120", "h-20"]]    // approach from right
```

## Rule 4: Power connections

- Direct style: part VCC/GND → board 5V/GND directly
- Breadboard style: part VCC/GND → breadboard rails → board 5V/GND
- Red wire for VCC/5V, black for GND (consistent convention)

## Rule 5: Avoid overlaps (wires AND parts)

- Don't place parts overlapping the board (blocks pins)
- Don't route wires across the board surface (blocks pin labels)
- **Wires must not overlap**: parallel lines keep ≥ 5 units spacing (not just cross-check)
- Same-target wires separated by different paths
- Don't scatter related parts far apart (unclear function grouping)

## Rule 6: 确定性走线惯例（脚本已实现，模型知悉即可）

这些是从「几何 + 网表」唯一推得的最优做法，`layout-generator.js` 已硬编码；模型不必重复判断，只用在特殊场景改意图（intent）覆盖：

- **板线分车道**：同一边（上/下）的每条板线错开一条水平车道（8px），避免共线重叠
- **错开按最终目标**：多线错开按「重映射后的最终目标孔」统计，**不按逻辑网表目标**（否则轨线会被无谓绕路）
- **LED 重叠检测足迹**：LED 视觉本体只有 ~16px 圆泡，重叠检测用 20×20，而非 40×50 容器
- **元件级偏好**（LED↔电阻同列、按钮对侧接线等）见 `layout-cards.md`，按项目实际用到的元件查阅

## Wiring colors (convention)

Common wire colors: `green`, `red`, `black`, `yellow`, `blue`, `orange`, `purple`, `white`.
Convention: red = VCC/5V, black = GND, others = signals (distinguish by color).
Empty color `""` = hidden wire (e.g. `$bb` breadboard auto-routing).

## 约束分级（硬约束 / 软约束 / 灰度开口）

> 核心原则：把「穿元件」和「交叉」分开——穿元件是硬伤（现实里接不上，必须绕），交叉是软伤（现实里跳线交叉是常态，可妥协）。脚本兜底给安全默认，模型在 intent 里可覆盖。

### 硬约束（必须满足，违反 = 不合格）

| 冲突 | 说明 | 处置 |
|------|------|------|
| 线穿元件（hits-part） | 线从元件本体中间穿过 | 必须绕开 |
| 元件重叠（parts-overlap） | 两个元件本体重叠 | 必须错开 |
| 元件在板子上（part-on-board） | 元件压在板子本体上 | 必须移开 |
| $bb 对不齐（bb-misaligned） | 引脚偏移 > 0.5px，网页版不渲染插接绿点 | 必须精确 |
| 线穿板（wire-through-board） | 线横穿板子本体 | 必须绕开 |
| 引脚不存在 | pin 不在 pins.json / 板型配置 | 跳过该线并告警 |

### 软约束（尽量优化，可妥协）

| 冲突 | 说明 | 处置 |
|------|------|------|
| 线交叉（cross） | 两条线相交 | 尽量少；I2C 反序这类不可避软伤可妥协 |
| 共线重叠（overlap） | 多线合并成一条 | 尽量错开 |
| 线长 | 绕远 | 尽量短，非硬指标 |

> **I2C 反序豁免**：Uno 的 A4=SDA 在 A5=SCL 左边，而 OLED 模块 SCL 在 SDA 左边，两条线必然交叉一次。妥协「交叉」、坚持「先离开元件再走线」。

### 灰度开口（C 类，模型决策，脚本给默认）

| 字段 | 含义 | 默认值 | 备注 |
|------|------|--------|------|
| 交叉容忍度 | 允许的交叉上限 | 反序豁免 + 其余尽量少 | 模型可设「每线最多 N」或「全局 ≤ N」 |
| 扩容方向 | 区域放不下时往哪扩 | 朝远离板子方向（right 往右、bottom 往下） | 脚本默认，模型可覆盖 |
| 扩容上限 | 扩容边界 | 不越出画布 / 不侵占相邻区 | 超限自动触发回退改组 |
| 回退层级 | 解决不下的升级路径 | ① 局部扩容（脚本兜底，便宜）→ ② 回顶层改组/换区（交模型，贵） | — |
| 迭代轮数上限 | 回退重排最多跑几轮 | 3 | 模型可设 |

### 与 A/B/C 的关系

- **A 类常量**（几何数据、板型配置）→ 提取器固化，不变
- **B 类可推导**（走线算法）→ 从硬规则改成软约束优化
- **C 类灰度**（容忍度、扩容方向、回退层级）→ 模型决策，脚本兜底

## 交叉三分法（2026-11-07 定稿判据，工具 `wokwi-bench/classify-crossings.js`）

「交叉多」不是一个可执行的结论。把每个交叉配对按**可计算判据**分成三类，分别归不同工序处理：

| 类别 | 判据 | 归属 | 处置 |
|---|---|---|---|
| ① 拓扑不可免 | 两端顺序颠倒（`(srcA.x<srcB.x) !== (tgtA.x<tgtB.x)`）**且**源端或目标端是**同一元件**（引脚在同一本体上焊死，换序不可能） | 判据豁免 | 不计入优化目标；它是该电路交叉数的「地板」 |
| ② 布局可减 | 顺序颠倒，但两端分属**不同元件**（换左右顺序 / 镜像元件即可消除） | 布局层 | 按目标引脚 x 排序、大件外置、必要时镜像 |
| ③ 走线错误 | 顺序**没颠倒**却仍相交（绕路、回头、重叠造成），或伴随共线重叠/穿件/同孔复用 | 走线层（bug） | 必须修：走廊分配、离体阶梯、轨外侧入孔 |

**工作流（按杠杆排序）**：

1. 先跑分类器：`node wokwi-bench/classify-crossings.js <项目目录>`
2. **③ 优先修**——它是 bug，量最大且修完不牺牲可读性（U1 实测 45/76 = 59% 属此类）
3. **② 次之**——布局排序/镜像，收益稳定（U1 18、U2 20）
4. **① 豁免**——不要为了让数字好看去拆合法的交叉；手绘图的交叉里同样含这三类，所以「交叉 ≤ 手绘×1.2」这种比法要改成「③=0、②尽量小、①豁免」

**为什么这样分类对模型有用**：它把「该改算法的」和「该改布局的」分开，避免模型在布局层反复试错去修一个本来就是走线 bug 的交叉；同时给了判据一条明确的终止条件（③=0 即布线层完工）。
