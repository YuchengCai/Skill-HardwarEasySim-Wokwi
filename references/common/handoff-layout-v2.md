# T12 交接文档：布局引擎 v2（2026-11-07 冻结）

> 目的：让新的会话/协作者在 5 分钟内接手，不重走已验证的弯路。所有数字均为实测。

## 0. 一句话现状

布局引擎 v2（`wokwi-skill/scripts/layout-v2.js`）已达到：**三张示例图硬冲突全 0**（穿板/穿件/共线重叠/方向错），交叉数 U1 66 / U2 66 / N1 3（U2 优于用户手改版 75）。剩余问题集中在**走线整洁度**（转弯未对齐成直角走廊）。

## 1. 工程结构

| 文件 | 作用 |
|---|---|
| `wokwi-skill/scripts/layout-v2.js` | **当前主线**布局引擎（骨架→放置→走线），约 980 行 |
| `wokwi-skill/scripts/layout-generator.js` | 旧引擎 v1（保留作 fallback，不再演进） |
| `wokwi-skill/scripts/analyze-demand.js` | 需求画像：元件/网络统计、是否需要面包板、列总线/接力判定 |
| `wokwi-skill/scripts/compose-skeleton.js` | 构图骨架（band 模型 + 模板 T1/T2 择优） |
| `wokwi-skill/scripts/extract-diagram.js` | **从浏览器读回** diagram.json（逆向 wokwi-cdp） |
| `wokwi-skill/scripts/wokwi-cdp.js` | 注入 diagram.json 到浏览器 + 截图 |
| `wokwi-skill/scripts/verify-wires.js` | 渲染契约检查（引脚位置 == Wokwi 渲染） |
| `wokwi-bench/score-diagram.js` | 独立裁判：硬冲突(穿板/穿件/共线/方向) + 交叉 |
| `wokwi-bench/classify-crossings.js` | 交叉三分法 ①拓扑不可免 ②布局可减 ③走线错误 |

测试数据：`zcode-analysis/{U1,U2,N1,X1}-intent.json`、`U2-golden-power.json`（用户手改黄金样本）、`U2-user/`（读回的用户版）。

## 2. 架构（v2 流水线）

```
intent.json → [1] 分类/分层(BFS: 信号距离，电源不计) → 行放置
            → [2] 骨架 band(T1纵向/T2 L形) + 模板择优(宽高比)
            → [3] 电源基础设施(单列即网/列总线+跳线/端部馈电/同极双轨桥)
            → [4] 逐线走线(几何类别 → 方法)
            → [5] 通道分配(left-edge) → waypoints
            → diagram.json
```

## 3. 已验证的设计规则（照做）

1. **离体方向 = 引脚开放侧**：底边向下、顶边向上、左边向左、右边向右。左/右边缘引脚**必须先水平离开本体**（否则穿自身 110px）。
2. **离体槽 12px（SLOT_STEP）+ 本体避让**：槽位落入同排邻件 x 带时退到邻件边缘外 8px。
3. **同源束线序不拧**：同(元件,边)的线按引脚 y 降序分配槽/车道（下面引脚→近侧）。
4. **电源基础设施按网选**（来自用户黄金样本）：
   - 参与者 ≤2（1 馈 + 1 消）→ **单列即网**：馈电占列首孔 a、消费者占列尾孔 e，免轨免跳线；
   - 多消费者 → **列总线 + 每族一根跳线到轨 + 板端部馈电**（n=25，靠板侧）；
   - 上缘轨(bp)供电：tp 空闲时 **tp 端部馈电 + 末端桥 tp↔bp**（同极双轨合法）；否则绕边馈电。
   - **严禁** tp↔bp 桥接不同电源网（5V 与 3.3V 会短路——曾犯）。
5. **列半区跟目标轨**：下缘轨(tn/tp)→t 半区(a-e 孔)、上缘轨(bp)→b 半区(f-j 孔)。
6. **跳线孔预留**：t 列保留 a、b 列保留 j；消费者不占。
7. **直落式入孔**：落孔竖向无遮挡时走 3 段（escape→v→h→微斜），不遮挡才用 5 段。
8. **模块带锚定面包板列中心**（T2：板在左、面包板在右；板那一列上方无可连对象）。
9. **列位/转弯位避让更低行模块的 x 带**（否则落孔竖段穿模块本体）。
10. **走线方向即语义**：起点=真空中可离体端，终点从目标引脚开放侧进入；bb→bb 桥线豁免方向检查。

## 4. 坑清单（**不要重走**）

| 实验 | 结果 | 原因 |
|---|---|---|
| 车道 4→12 但无本体避让 | 穿件 U1 3 / U2 2 | 加宽后离体横段撞邻件 |
| 落孔分散（每列 1 消费者 + 各自跳线） | 交叉 66→71，共线+1 | 跳线 1 根→N 根；且 4px 密度根本没改善（真凶是离体槽） |
| 每模块独立车道 / 全局 left-edge 优先 | U1 9→32 / 共线清零但交叉+28 | 逐线层修补，破坏嵌套 |
| 目标高度直进（横段在目标引脚 y） | 交叉 81→74 但穿 mux 56px×4 | 左缘引脚必须从左侧进入；源在右侧必然穿本体 |
| 放置重心精化（mux 移向均值 x） | 交叉 81→85 | rfid 行 755 宽钳在 x=0 动不了 |
| CORR_GAP 与 MOD_GAP 分治（90/110） | 车道溢出穿板 | 走廊高度由「必须住在里面的线」决定（P 池 base=A车道×16+40），常量收缩治标 |
| 末端桥 tp→bp 供 3.3V | **电气短路** | tp=5V 轨、bp=3.3V 轨，不同网不可桥 |
| 后处理补段+补偿 | 路径未闭合，568px 斜线穿模块 | 应在生成 waypoints 前算好；或就地改写端点 |
| bench 内联引脚表 | 裁判用假几何（board-* 缺失，落到 20×20 中心） | 已改为运行时加载 references/common/*.json |
| 端点豁免 | 线的端点是板/元件时整条跳过穿板/穿件检查 | 改为只豁免引脚端 15px（用户肉眼抓出两处盲区） |
| PowerShell 内联 node -e 正则 | `\$` 被转义成字面美元符，waypoints 全没解析→误报 | 检查脚本一律落盘成文件再跑 |

## 5. 验收方法与命令（工作区根目录）

```powershell
# 生成
node wokwi-skill/scripts/layout-v2.js zcode-analysis/U2-intent.json zcode-analysis/U2-v2out
# 裁判（硬冲突 + 交叉）
node wokwi-bench/score-diagram.js zcode-analysis/U2-v2out --intent zcode-analysis/U2-intent.json --json --out zcode-analysis/_v-U2.json --quiet
# 注入浏览器（人眼双检）
node wokwi-skill/scripts/wokwi-cdp.js zcode-analysis/U2-v2out --port 9333
# 渲染契约
node wokwi-skill/scripts/verify-wires.js zcode-analysis/U2-v2out
# 回归（18 用例，必须全绿）
cd wokwi-skill; node scripts/run-tests.js
# 读回用户在浏览器里的手改版本
node wokwi-skill/scripts/extract-diagram.js zcode-analysis/U2-user --port 9333
# 密度/转弯统计
node zcode-analysis/_density.js
```

**验收线**：硬冲突 total=0；回归 18/18；契约 0 超差；交叉不高于当前（U1 66 / U2 66 / N1 3）；转弯/线 ≤2.0。

## 6. 下一轮任务（按序，均已诊断）

### 任务 A：转角柱（turn posts）——最高收益
**问题**：同束线的转弯 x 各用各的（`hole.x+16+k*4` 一类公式），视觉上直角不齐。
**做法**：每束（同一目标列/同一目的地）预分配 3-4 个**共享柱子**（间距 12-16px，如 `holeX-24-k*14`）；束内按引脚序把线分配到相邻柱子；柱子用全局登记表避免共线（现有 `regVert`）。
**验收**：转弯/线 ≤2.0；共线=0；交叉不升高；人眼确认直角走廊整齐。

### 任务 B：U2 直落打通
**问题**：rfid2 的落孔竖线在 uno 的 x 带内被挡，仍走 5 段。
**做法**：被板挡住时改「从板右缘外侧下」（x > boardRight+16），再进孔；或让该族列选位更靠右。
**验收**：U2 转弯 80→≤72；硬冲突 0。

### 任务 C：束间分带（通道规划层收尾）
**问题**：电源/信号/板脚全混在 A/P 池里由 left-edge 随机排。
**做法**：按网络组预分配 y 带（电源带、信号带、板脚带各自 base），束内 left-edge，束间不侵占。
**验收**：交叉下降≥10%；共线=0；转弯不升。

## 7. 协作方式（重要）

- 用户会**人眼双检**：生成 → 注入浏览器 → 用户指出问题（历史上用户抓出过：穿板、穿件、孔冲突、断网、间距、转弯乱）；
- 用户的反馈往往指向**结构问题**而非参数问题——优先怀疑布局/通道，不要急着调常量；
- 用户手改的版本可读回（`extract-diagram.js`）做 diff 学习——这是最有效的改进来源；
- 每次改动后必须：`node --check` → 三图重生成 → 裁判 → 回归 → 注入浏览器。

## 8. 关键坐标/常量

- `LANE_STEP=16`（车道间距）、`SLOT_STEP=12`（离体槽）、`MOD_GAP=170`（行间隙兼走廊）
- 面包板 328.8×207.9，列距 9.6，rot180 渲染：t 半区在下、b 半区在上；轨 y：tn=+185.7/tp=+195.7/bp=+21.7/bn=+11.7
- UNO 电源脚：GND.2/GND.3/5V/3.3V/VIN（底边）；A0-A5 底边，0-13 顶边
- 引脚真值：`wokwi-skill/references/common/pins.json`（探针实测）、`sizes.json`（配准实测）
