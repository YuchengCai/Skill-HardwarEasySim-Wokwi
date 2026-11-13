# 环境开关清单（V2_*）

> 自动生成：`node zcode-analysis/_gen-env-doc.js`。这些开关用于**实验与档位**，不是公开 API；
> 交接/维护时按此清单收敛（目标：收敛为一个配置对象，只保留档位与调试两类）。

| 开关 | 出现次数 | 所在文件 | 用途（就近注释） |
|---|---|---|---|
| `V2_ALIGN` | 1 | layout-v2.js | 否则单行可读性 → 全跨度均匀分布；其余 → 固定间距（历史行为）。 |
| `V2_BB_DX` | 1 | layout-v2.js | 位置搜索参数（默认=原值；环境变量仅供布局实验） |
| `V2_BLOCKPOS` | 4 | layout-v2.js | — |
| `V2_BOARD_DX` | 2 | layout-v2.js | — |
| `V2_DBG2` | 1 | layout-v2.js | 最近的源贴列。此前按处理序（引脚 y）排，远源会落在近源内侧 → DS 的拐角把 MPU 包进去。 |
| `V2_DBG4` | 1 | layout-v2.js | — |
| `V2_DBG5` | 1 | layout-v2.js | — |
| `V2_DBG7` | 1 | layout-v2.js | — |
| `V2_DEBUG` | 1 | layout-v2.js | — |
| `V2_GAP_H` | 2 | layout-v2.js | — |
| `V2_GAP_V` | 6 | layout-v2.js | 硬前提是 ≥170，低于则抬回并在日志提示（不让坏布局带着冲突输出）。 |
| `V2_HUB_PART` | 14 | layout-v2.js | hub19 一致（交叉 36 / hard 4）。旧 T3 骨架代码保留但不参与候选，便于回溯。 |
| `V2_HUB_POS` | 4 | layout-v2.js | — |
| `V2_ISOLATED` | 2 | layout-v2.js | 单行布局（U3）所有模块同行 → 每族仍只有一簇，行为不变。 |
| `V2_MOD_OFF` | 1 | layout-v2.js | 位置搜索参数（默认=原值；环境变量仅供布局实验） |
| `V2_MOD_SPACING` | 1 | layout-v2.js | 位置搜索参数（默认=原值；环境变量仅供布局实验） |
| `V2_NETORDER` | 3 | layout-v2.js | 最优模式（GND,5V,SDA,SCL = 41 交叉；最差 53）。实验可用 V2_NETORDER 覆盖。 |
| `V2_NOCOMPACT` | 1 | layout-v2.js | 取紧凑值只为减少空白、缩短线长；非可读性电路保持 250 不变）。 |
| `V2_NO_NOTES` | 2 | layout-generator.js, layout-v2.js | 生成后自动产出台账（与 layout-v2 一致）：说明每个网是电源干道 / 母线中继 / 列隔离。 |
| `V2_POSTDBG` | 2 | layout-v2.js | — |
| `V2_RECT` | 2 | layout-v2.js | — |
| `V2_ROWSPAN` | 1 | layout-v2.js | V2_ROWSPAN=0 关闭，V2_RECT/V2_ROWSPAN=1 强制。 |
| `V2_ROW_DX` | 1 | layout-v2.js | 位置搜索参数（默认=原值；环境变量仅供布局实验） |
| `V2_ROW_DY` | 1 | layout-v2.js | — |
| `V2_SIDE` | 1 | layout-v2.js | 让它先左出、再绕到右侧，就能用上那条空缝（物理特例的人工解法）。 |
| `V2_T3` | 1 | layout-v2.js | hub19 一致（交叉 36 / hard 4）。旧 T3 骨架代码保留但不参与候选，便于回溯。 |
| `V2_TIGHT` | 1 | layout-v2.js | 顶对齐实测会把板推进走廊 → 交叉 30→52） |
| `V2_TIGHT_V` | 1 | layout-v2.js | 压缩：模块带下沿到 bb 顶 = 150（默认 250）；板随 bb 一起下移，保持同一 y 带 |
| `V2_TRACE` | 1 | layout-v2.js | 用途：避免"改了没效果"时盲猜钩子（本项目曾 3 次找错位置）。关掉时只多一个 if 判断。 |
| `V2_WRAP` | 3 | layout-v2.js | — |

共 30 个开关。
