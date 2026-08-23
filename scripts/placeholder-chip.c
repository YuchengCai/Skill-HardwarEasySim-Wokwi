/**
 * placeholder-chip.c — 库外元件占位符的"空芯片"实现
 *
 * 用途：让 wokwi custom chip 占位符（chip.json + chip.wasm）能正常显示、连线，
 *      但不产生任何仿真行为（引脚全部悬空）。
 *
 * 官方要求（docs.wokwi.com/chips-api/getting-started）：
 *   - 必须实现 chip_init()（每个 chip 实例启动时调用一次）
 *   - 本实现为空：不初始化引脚、不注册任何回调 → 无电气行为
 *
 * 编译（官方指南 docs.wokwi.com/guides/custom-chips-to-wasm）：
 *   wokwi-cli chip compile placeholder-chip.c
 *   （产物：placeholder-chip.wasm，与 placeholder-chip.json 配对使用）
 */
#include "wokwi-api.h"

void chip_init() {
  // 占位符：什么都不做，所有引脚保持悬空。
  // 连线可验证（视觉），无仿真行为（电气）。
}
