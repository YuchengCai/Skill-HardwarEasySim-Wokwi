# Intent Format — layout-intent.json 字段契约

> 这是「模型（规划层）↔ 脚本（执行层）」的接口契约。
> 模型写 intent 表达意图；`layout-generator.js` 把它算成精确几何。
> 核心原则：**模型定意图（功能分组 / 分区 / 网表），脚本定几何（坐标 / 孔位 / 走线）**。
> 状态：契约草案。字段中标注 🆕 的为灰度开口新增，**脚本实现留待 Phase 2 后续**。

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
| placement | string | ❌ | `"bb"` = 插面包板 / `"board"` = 直连板子旁 | 有面包板时 `"bb"` |
| attrs | object | ❌ | 元件属性（color/value/i2cAddress…） | {} |
| hint | object | ❌ | 灰度覆盖（见下，🆕） | {} |

## groups[] + 分区语义（核心）

`groups` = 模型的**功能分组 + 分区分析**结果。

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 功能组名（自由文本，如"指示区"/"输入区"） |
| parts | array | 组内元件 id |
| zone | string | 🆕 语义分区：`output` / `input` / `sensor` / `display` / `misc` |
| region | string | 物理落位（可选覆盖）：直连 `top/right/bottom/left`；面包板 `left/middle/right` |
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

## 灰度覆盖 hint（🆕 待脚本实现）

`parts[].hint`，只覆盖「脚本写死、但项目间确实会不同」的少数选择：

| hint | 取值 | 作用 | 缺省 |
|------|------|------|------|
| order | `"left"` / `"right"` / 序号 | 对称元件（按钮等）左右顺序 | 按 id 倒序（btn1 左） |
| side | `"opposite"` / `"same"` | 按钮对侧 / 同侧接线 | opposite |
| pair | 元件 id | 显式配对（LED↔电阻），网表无法唯一推导时用 | 从网表推导 |

> 只开「模型能合法判断、脚本无法从网表唯一推出」的点。坐标 / 孔位 / 轨位置等**不开**（脚本推导）。

## connections[] 网表

| 字段 | 说明 |
|------|------|
| from | `"uno:13"` / `"r1:1"` / `"led1:A"`（元件:引脚） |
| to | 同上 |
| color | 线色（green/black/red/yellow…） |

网表是**电气意图**：谁连谁、用哪个引脚。脚本据此推导物理接线（$bb 配方、相邻孔出线、轨连接）。

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
    { "id": "led1", "type": "wokwi-led", "placement": "bb", "attrs": { "color": "red" } },
    { "id": "r1", "type": "wokwi-resistor", "placement": "bb", "attrs": { "value": "220" } },
    { "id": "btn1", "type": "wokwi-pushbutton", "placement": "bb", "hint": { "order": "left" } },
    { "id": "btn2", "type": "wokwi-pushbutton", "placement": "bb", "hint": { "order": "right" } },
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
