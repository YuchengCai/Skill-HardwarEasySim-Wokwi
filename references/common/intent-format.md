# Intent Format — layout-intent.json 字段契约

> 这是「模型（规划层）↔ 脚本（执行层）」的接口契约。
> 模型写 intent 表达意图；`layout-generator.js` 把它算成精确几何。
> 核心原则：**模型定意图（功能分组 / 分区 / 网表），脚本定几何（坐标 / 孔位 / 走线）**。
> 状态：契约已定稿；🆕 字段（zone / region / hint.order）**已由 `layout-generator.js` 实现（Phase 2）**。

> ⚠️ **intent ≠ diagram**：本文件是 `layout-generator.js` 的**输入**、不含坐标；必须先跑生成器得到 `diagram.json` 再进 Wokwi，否则所有元件会叠在 (0,0)。

## 定位与原则

- intent = 模型对"这个电路长什么样"的**语义描述**，**不含坐标**。
- 脚本把语义描述 + 几何事实（`geometry.json` / `pins.json` / `sizes.json`）算成 `diagram.json`。
- **分区优先由模型显式给；缺省时脚本用「功能组 → 默认落位」的约定兜底；显式永远优先于兜底。**

## 顶层字段

| 字段 | 类型 | 必填 | 说明 | 缺省 |
|------|------|:----:|------|------|
| board | string | ✅ | 板型，如 `wokwi-arduino-uno` | — |
| breadboard | string \| null | ❌ | 面包板型，如 `wokwi-breadboard-half`；给则走面包板风格 | 无（直连） |
| parts | array | ✅ | 元件清单 | — |
| groups | array | ❌ | 功能分组 + 分区（见下） | [] |
| connections | array | ✅ | 逻辑网表（谁连谁） | — |
| constraints | array | ❌ | 空间约束 near/avoid | [] |

## parts[]

| 字段 | 类型 | 必填 | 说明 | 缺省 |
|------|------|:----:|------|------|
| id | string | ✅ | 唯一 id（led1、btn2…） | — |
| type | string | ✅ | `wokwi-led` 等 | — |
| placement | string | ❌ | 通常**省略**（缺省即 bb）；`"board"` 仅限模块类大元件直连板旁；离散元件（电阻/LED/按钮）写 board 须附 `reason` | 有面包板时 `"bb"` |
| attrs | object | ❌ | 元件属性（color/value/i2cAddress…） | {} |
| hint | object | ❌ | 灰度覆盖（见下，🆕） | {} |
| reason | string | 条件 | 直连理由一句话；离散元件 `placement:"board"` 时必填，缺失生成器 WARN | — |

## groups[] + 分区语义（核心）

`groups` = 模型的**功能分组 + 分区分析**结果。

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 功能组名（自由文本，如"指示区"/"输入区"） |
| parts | array | 组内元件 id |
| zone | string | 🆕 语义分区：`output` / `input` / `sensor` / `display` / `misc` |
| region | string | 物理落位（可选覆盖）：直连 `top/right/bottom/left`；面包板 `left/middle/right/bb`（bb=插面板本体） |
| relation | string | 组内关系（"together" 等，历史字段） |

### zone vs region

- **zone**（语义，模型分析的核心输出）：这个组是"输出/输入/传感/显示"哪一类。
- **region**（物理，可选覆盖）：这个组具体放哪个位置。

### 缺省落位（fallback，脚本兜底）

模型给了 `region` → 用 `region`（**显式优先**）；
模型只给了 `zone` → 脚本按约定映射 zone → 物理落位：

| zone | 直连落位 | 面包板落位 |
|------|---------|-----------|
| output | 板子上方 top | 左列带 |
| input | 板子下方 bottom | 中列带 |
| sensor | 板子右侧 right | 右列带 |
| display | 板子上方/右侧 | 靠板子 |
| misc | 板子右侧 right | 右列带 |

模型 `zone` 和 `region` 都没给 → 脚本按元件 type 猜 zone（现行兜底行为）。

> ⚠️ 兜底是「可接受 + 适配多元件组合」的**约定**，不是最优。模型应尽量显式给 zone / region。

## 灰度覆盖 hint（🆕 已实现）

`parts[].hint`，只覆盖「**网表表达不了**、脚本写死、且项目间确实会不同」的选择。

| hint | 取值 | 作用 | 缺省 |
|------|------|------|------|
| order | `"left"` / `"right"` / 序号 | 对称元件（按钮/LED 等）左右顺序 | 按信号脚位置（左板脚→左按钮，避免交叉） |
| sameSide | `true` | 显式声明"按钮信号与 GND 有意同侧（省线）"——无此声明时脚本默认对侧自动调整 | 无（默认对侧） |

### 开字段的判据（设计契约时用，防止塞冗余字段）

- **能被网表表达的（关系 / 侧别 / 配对）→ 不开字段**：网表是唯一事实源，再加字段会与之重复甚至冲突。
  - 例：按钮「对侧/同侧」由网表引脚唯一决定——信号 `2.r` + GND `1.l` = 对侧，信号 `1.l` + GND `2.l` = 同侧。脚本默认对侧兜底（同侧自动调整），有意省线用 `hint.sameSide` 显式声明，故不需要 `side` 字段。
  - 例：LED↔电阻配对由 `r1:2 → led1:A` 这条连接唯一决定，故不需要 `pair` 字段。
- **纯空间信息（顺序 / 落位）→ 开字段**：网表没有左右/上下概念，只能靠 `order`、`groups[].zone/region` 表达。
- **坐标 / 孔位 / 轨位置 → 永不开**：由脚本从 geometry.json / pins.json 推导。
  - 例外（2026-11-24 序列1）：用户**已经接好的物理孔位**可作为锁定端点直接写进 `connections[]` 端（见下「显式面包板端点」），这不是开字段，而是把已存在的实体端点带进网表。
- 可互换引脚方向（电阻 1/2 等 swapPair）→ 由脚本按上下文推导，模型不用写对

## connections[] 网表

| 字段 | 说明 |
|------|------|
| from | `"uno:13"` / `"r1:1"` / `"led1:A"`（元件:引脚） |
| to | 同上 |
| color | 线色（green/black/red/yellow…） |

网表是**电气意图**：谁连谁、用哪个引脚。脚本据此推导物理接线（$bb 配方、相邻孔出线、轨连接）。

### 显式面包板端点（锁定接点，2026-11-24 序列1）

用户已接好的物理孔/轨可以直接写进 `connections[]` 端，表示**锁定实体端点**（脚本原样接线、不再自动分配）：

| 端点写法 | 含义 |
|---|---|
| `bb1:8t.a` / `bb1:3b.j` | 元件区孔：`<行 1-30><t|b>.<字母>`（t 半区 a-e / b 半区 f-j） |
| `bb1:tn.25` / `bb1:tp.3` | 电源轨孔位：`<tn|tp|bn|bp>.<1-25>` |

规则：

- 显式端点必须合法且**不得重复占用**（同一孔被两个连接端点引用 → 预检失败，`exit 3`，不生成图）。
- 插面板元件（`placement:"bb"`）的引脚仍自动分孔（保留旧自动行为）；若一条线要锁定到指定孔，把它写成显式端点即可——可见线终点落在该孔，板内导通按实际插接解释。
- 生成后从实际 `diagram.json` 重建网络（可见导线 + `$bb` + 面包板行/轨内部导通 + Uno GND 共地），逐条核对必需连接。缺线、锁孔移动、网络误并 → **`exit 3`**，`diagram.json` 保留为诊断草稿，不可标记为可交付。
- 独立验收：`node scripts/check-required.js <intent.json> [--dir <项目目录>]`（退出码 0 通过 / 3 失败 / 1 输入错误；`--json` 输出逐项报告）。

## assignable[]（可互换引脚组，🆕 草案 2026-11-08，引擎尚未实现）

> 来源：用户手理线黄金样本（handoff §6.8-④）。mux I10–I15 电气可互换，用户靠"左源→低引脚带"
> 的通道重排砍掉 ~4 处交叉；intent 若不声明，引擎只能按字面连接，浪费这个自由度。

**这是模型的判断（C 值）**：哪些目标引脚组在电气上可互换（不影响 sketch 行为），
只有写代码的人/模型知道。**引擎只消费声明，不自行猜测**（猜错 = 电路行为改变 = 硬错误）。

| 字段 | 说明 |
|------|------|
| part | 目标元件 id（如 `mux1`） |
| pins | 可互换引脚名数组（如 `["I10","I11","I12","I13","I14","I15"]`） |
| rule | 分配策略提示，默认 `"by-source-position"`（按源位置就近排序分配） |

```jsonc
"assignable": [
  { "part": "mux1", "pins": ["I10","I11","I12","I13","I14","I15"] }
]
```

语义：凡 `connections[].to` 落在组内的连接，引擎可**在组内重排**目标引脚（源引脚不动），
分配目标=让走线最短/交叉最少。**同组引脚必须**：同一元件、同侧、电气等价（无序号语义）。
典型：mux/模拟开关通道、多路 IRQ、并联 LED 位。**不适用**：I2C（SDA/SCL 有序）、
中断优先级有语义的脚、charlieplex 有序位。

未声明时：行为与现在完全一致（按字面连接）——**向后兼容，纯增量自由度**。

## routing.zones（分区计划，🆕 草案 2026-11-09，引擎仅审计不消费）

> 来源：用户手绘心智模型（layout-rules.md「分区纪律」Z1-Z4）。人类是**分区决策一次成片**
> （多引脚/多线同步成画）；模型无视觉，但可以把"画面"翻译成分区表——**这是模型的判断（C 值）**，
> 引擎按表执行，不自行发明分区。

**语义**：分区表是布局之前的批量决策——每族电源落哪个区、哪个区承担什么角色。
引擎当前**只读入并审计**（`[ZONE]` 日志、违例提示），不改变走线行为；消费层（用表驱动
列选择/馈电位置/轨位）是下一步。

| 字段 | 说明 |
|------|------|
| zone | 区域名：`"rails"`（轨区）/ `"middle"`（中区）/ 自定义 |
| roles | 该区承担的角色数组：`"board-power-feed"`（板↔bb 馈电）/ `"jumper"`（列↔轨跳线）/ `"component-columns"`（元件列） |
| families | （可选）电源族→列提示，如 `{ "GND": "22t", "3.3V": "21b" }`；`"auto"` = 引擎按消费者就近选 |
| note | （可选）人读备注 |

```jsonc
"routing": {
  "zones": [
    { "zone": "rails",  "roles": ["board-power-feed", "jumper"],
      "note": "轨只做电源干道，不挂信号" },
    { "zone": "middle", "roles": ["component-columns"],
      "families": { "GND": "auto", "3.3V": "auto", "5V": "auto" } }
  ]
}
```

**审计规则（引擎现状）**：轨目标（`bb1:tn.N`/`tp.N`/`bn.N`/`bp.N`）的连接必须属于电源族
（`famOfConn` 非空），否则记 `[ZONE] 违例`；中区/板脚/元件目标的连接只做分布统计。
未声明 `routing.zones` 时：不审计、行为与旧版完全一致。

## routing.relays[]（中继声明，🆕 草案 2026-11-09，引擎对账审计）

> 来源：用户口述——面包板中继的真实作用是**一脚多用**：控制板/元件只有一个接口引脚
> （如 `uno:3.3V`），但该引脚要被多元件复用 → 面包板列把这个物理脚扩展成"虚拟引脚排"。
> **这是模型的判断（C 值）**：哪些网存在引脚稀缺、需要中继扇出，看网表即知；
> 引擎按声明选形态（单列即网 / 列总线）并对账，不自行发明中继。

| 字段 | 说明 |
|------|------|
| net | 网名（信息性，如 `"3.3V"`、`"I2C-SDA"`） |
| source | 稀缺物理脚（如 `"uno:3.3V"`）——一个脚、多消费者 |
| consumers | 消费者引脚数组（如 `["rfid1:3.3V","rfid2:3.3V"]`） |
| role | `"fanout"`（默认，一脚多用扇出）/ `"pass"`（过路）/ **`"bus"`（母线中继：先收成母线列再分发）/ `"isolation"`（隔离列：某元件某网独占一列）** |

```jsonc
"routing": {
  "relays": [
    { "net": "3.3V", "source": "uno:3.3V",
      "consumers": ["rfid1:3.3V", "rfid2:3.3V", "rfid3:3.3V"], "role": "fanout" }
  ]
}
```

**语义边界（重要）**：
- 中继**按网声明**，不按引脚名猜——mux 的 S0/S1/S2 名字像信号、电气上是 GND 成员，按网才判得对；
- 电源网之外，**信号总线同构适用**（I2C 的 SDA/SCL 一脚挂多传感器、共享 CS/IRQ）——
  **已实现**（2026-11-09，U3 样本）：声明的信号中继 → 引擎选列（t 半区），
  源脚合成馈电 → 列首孔 a，消费者 → b-e 孔（每列 1 源 + 最多 4 消费者），不经轨；
- **不经中继的网不上板**（如 mux 的 I10-I15 直连 rfid）——声明 relays 即划定了这个边界。

**对账审计（引擎现状）**：对每个声明的 relay 输出一行 `[RELAY]`——源实际落到哪、
消费者是否全部同列、引擎实际形态（单列即网 / 列总线(轨馈+跳线) / 直连×N）与声明是否相符。
未声明时不输出、行为与旧版完全一致。

## routing.profile（输出档位，🆕 2026-11-13）

| 值 | 含义 |
|---|---|
| `prototype`（缺省） | 共用轨/列，少线，视觉清晰——面包板原型/教学 |
| `matrix` | 母线中继列 + 一网一列 + 列↔列跳线，交叉最少，但线多面积大 |
| `device` | 产品内部（线束/固定/维修）——**引擎不支持，显式拒绝** |

```jsonc
"routing": { "profile": "matrix", "reason": "评审需要最少交叉" }
```

选 `matrix` 必须写 `reason`；用了母线/中继/隔离列 → 引擎强制产出 `wiring-notes.md` 跳线台账。
规格见 `wiring-profiles.md`。
## parts[].mount（连线底座，🆕 保留字 2026-11-09，引擎尚未实现）

> 来源：用户口述——部分版型把控制板/元件**插在面包板上**，面包板同时承担**中继**（电气扇出）
> 和**底座**（机械安装：元件引脚即孔，其连接变成"列合并"，零飞线）。

| 值 | 说明 |
|----|------|
| `"wire"`（缺省） | 独立放置 + 飞线连接（当前引擎唯一支持的模式） |
| `"bb"` | **保留字**：插入面包板——坐标贴孔网格、引脚占真实孔位、该件的连接变为列合并、列孔位预算（每列 a-j）成为硬约束。引擎未实现：声明时记 `[RELAY] ⚠` 警告并按 wire 处理 |

## constraints[]（空间约束）

| 字段 | 说明 |
|------|------|
| a, b | 元件 id |
| type | `"near"`（靠近）/ `"avoid"`（远离） |

> 软约束：仅在同区域时微调，跨区域放弃（区域约束优先）。

## 非法处理（脚本契约）

- 未知字段 → **忽略**（向前兼容）。
- 非法取值（zone/region/hint 不在枚举内）→ **回退默认 + stderr 日志**，不崩溃。
- 缺失必填字段 → 报错退出（明确信息）。

## 完整示例（含灰度字段）

```json
{
  "board": "wokwi-arduino-uno",
  "breadboard": "wokwi-breadboard-half",
  "parts": [
    { "id": "led1", "type": "wokwi-led", "attrs": { "color": "red" } },
    { "id": "r1", "type": "wokwi-resistor", "attrs": { "value": "220" } },
    { "id": "btn1", "type": "wokwi-pushbutton", "hint": { "order": "left" } },
    { "id": "btn2", "type": "wokwi-pushbutton", "hint": { "order": "right" } },
    { "id": "dht1", "type": "wokwi-dht22", "placement": "board" }
  ],
  "groups": [
    { "name": "指示区", "zone": "output", "parts": ["led1", "r1"] },
    { "name": "输入区", "zone": "input", "parts": ["btn1", "btn2"] },
    { "name": "传感区", "zone": "sensor", "parts": ["dht1"] }
  ],
  "connections": [
    { "from": "uno:13", "to": "r1:1", "color": "green" },
    { "from": "r1:2", "to": "led1:A", "color": "green" },
    { "from": "led1:C", "to": "uno:GND.1", "color": "black" },
    { "from": "uno:2", "to": "btn1:1.l", "color": "yellow" }
  ],
  "constraints": []
}
```

## 相关文档

- 规则：`layout-rules.md`（通用）、`layout-cards/`（元件级偏好）、`breadboard.md`（面包板）、`generic-wiring.md`（未收录元件兜底）
- 数据：`geometry.json`（面包板几何）、`pins.json`（引脚）、`sizes.json`（尺寸）
- 脚本：`layout-generator.js`（意图→几何）、`optimize-wiring.js`（检测）、`run-tests.js`（回归）
