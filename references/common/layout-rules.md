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

**By component count:**

| Component count | Style | Notes |
|-----------------|-------|-------|
| ≤ 6 parts | Direct (直连) | Parts around board, visible wires |
| > 8 parts | Breadboard (面包板) | Use breadboard to organize (see `breadboard.md`) |
| 6-8 | Either | Judge by complexity |

**Also use breadboard when any bus/consolidation need exists** (even with few parts):

- Multiple components share the same GND (only a few GND pins on board)
- Multiple components share VCC/power rail
- Signal bus consolidation (multiple lines to one function)
- GND pins run out (board has limited GND.1/.2/.3)

Rationale: breadboard rails provide a "bus" for shared GND/power — cleaner than many wires converging on one board pin (causes overlap/confusion).

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
