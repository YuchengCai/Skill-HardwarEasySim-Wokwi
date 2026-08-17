# Generic Wiring — 未收录元件的通用兜底

> 当元件不在 `layout-cards/` 或元件目录里（首次使用、库外元件）时的**原则化兜底**。
> 核心：不靠「背每个元件」，靠「识引脚 → 分类 → 套通用规则 → 确定性走线」处理任何新元件。
> 首次使用跑通后，把学到的元件级偏好沉淀回 `layout-cards/` 并标 ✅（dev-workflow 闭环）。

## 步骤（模型按此推导，脚本负责确定性几何）

1. **识引脚**（拿到 type + pin 列表）
   ① 查 `references/arduino/index.json` / `detail/<type>.json`
   ② 缺 → 抓 wokwi-elements 源码 pinInfo（curl，见 SKILL.md source fallback）
   ③ 仍缺（库外元件）→ 用户提供引脚 + `generate-part-placeholder.js`

2. **按引脚功能分类**（不是按具体元件背）
   - 电源脚：VCC / 5V / 3V3 / VIN / GND
   - 数字/模拟 I/O 脚
   - 总线脚：I2C(SDA/SCL)、SPI(MOSI/MISO/SCK/CS)
   - 无源两端：电阻/电容（串联在信号链里）

3. **套通用接线规则**
   - GND → 负轨（面包板）/ 板子 GND（直连）
   - VCC → 正轨 / 板子 5V / 3V3
   - 信号脚 → 就近的板子 GPIO（或对应总线脚）
   - 无源元件 → 串联在信号链里（如 LED 串限流电阻）
   - 颜色：红 = 电源、黑 = GND、其它 = 信号

4. **摆放**
   - 按功能分组（输入 / 输出 / 传感 / 显示），相关元件就近
   - 元件 > 8 或共享电源 → 面包板

5. **走线**（确定性，脚本已实现，与元件无关）
   - 板线分车道、轨线从相邻孔出线、最小 waypoint、就近端口、一孔一接
   - 详见 `layout-rules.md` / `waypoints.md` / `breadboard.md`

## 首次使用后的闭环

跑通 + 用户确认 → 提炼元件级偏好 → 写入 `layout-cards/<type>.md` 并标 ✅
