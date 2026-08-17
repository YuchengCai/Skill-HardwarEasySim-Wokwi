# Layout Cards — 元件布局/接线偏好卡（索引）

> 系统级布局偏好，按元件类型组织。生成 `diagram.json` 时，**只读当前项目实际用到元件**对应的卡片文件（按需加载，不整份读）。
> 灰度规则：默认这样做；脚本兜底；场景特殊时改意图（intent）覆盖，坐标始终由脚本推导。
> 未收录元件的通用兜底见 `../generic-wiring.md`。

| 元件 type | 卡片文件 | 一句话 | 验证 |
|-----------|---------|--------|------|
| `wokwi-led` | `led.md` | 与配对电阻同列、A 对电阻列、C 直连负轨 | ✅ |
| `wokwi-resistor` | `resistor.md` | rotate 90 跨槽、板下接 t 半区 / LED 上接 b 半区 | ✅ |
| `wokwi-pushbutton` | `pushbutton.md` | 对侧接线、顺序匹配 LED、GND 相邻孔出线 | ✅ |
| `wokwi-dht22` | `dht22.md` | $bb 连 b 区 4 孔 + 电源跳线 | 模板 |
| `board-ssd1306` | `oled.md` | SDA/SCL 直连板子 + VCC/GND→轨 | 模板 |
| `wokwi-buzzer` | `buzzer.md` | 直连板子 + GND→负轨 | 模板 |
