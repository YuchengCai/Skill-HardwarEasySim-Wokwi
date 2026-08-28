// chip-geometry.js — 占位符(chip-<name>)几何共享模块
// 单一事实源: layout-generator.js(生成)与 optimize-wiring.js(检测)共用同一套
// 经验公式(值为 wokwi 截图实测校准), 避免两份常量漂移。
'use strict';
const MM2PX = 96 / 25.4;
const CHIP_GEO = { pitch: 2.54 * MM2PX, insetX: 4.5, marginY: 5, textPad: 5, charW: 5.5 };

// 由 chip.json 数据计算几何: 返回 { w, h, pins: {pinName: [x, y]} }
function computeChipGeometry(chipName, data) {
  const pinsArr = data.pins || [];
  const N = pinsArr.length;
  const rows = Math.ceil(N / 2);
  const name = String(data.name || chipName) + ' Breakout';
  const w = Math.max(2 * CHIP_GEO.insetX + 2 * CHIP_GEO.textPad + name.length * CHIP_GEO.charW,
                     2 * CHIP_GEO.insetX + 2 * CHIP_GEO.textPad + (rows - 1) * CHIP_GEO.pitch);
  const h = 2 * CHIP_GEO.marginY + (rows - 1) * CHIP_GEO.pitch;
  const pins = {};
  pinsArr.forEach((pn, i) => {
    if (!pn) return;
    if (i < rows) pins[pn] = [CHIP_GEO.insetX, CHIP_GEO.marginY + i * CHIP_GEO.pitch];
    else pins[pn] = [w - CHIP_GEO.insetX, CHIP_GEO.marginY + (N - 1 - i) * CHIP_GEO.pitch];
  });
  return { w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100, pins };
}

// 批量加载 parts 中的 chip-* 几何到 out 映射(partId → 几何)。
// chipPath 解析规则与 layout-generator.js 一致(attrs.chip 或 placeholders/<name>/<name>.chip.json)。
function loadChipPlaceholders(parts, projectDir, out, warnFn) {
  const fs = require('fs');
  const path = require('path');
  for (const p of parts || []) {
    if (!p.type || !p.type.startsWith('chip-')) continue;
    const chipName = p.type.slice('chip-'.length);
    const chipPath = p.attrs && p.attrs.chip
      ? path.resolve(projectDir, p.attrs.chip)
      : path.resolve(projectDir, 'placeholders', chipName, `${chipName}.chip.json`);
    if (!fs.existsSync(chipPath)) {
      if (warnFn) warnFn(`未找到占位符几何 ${chipPath}，chip-${chipName} 按 20×20 中心近似`);
      continue;
    }
    let data;
    try { data = JSON.parse(fs.readFileSync(chipPath, 'utf-8')); } catch (e) { continue; }
    out[p.id] = computeChipGeometry(chipName, data);
  }
  return out;
}

module.exports = { CHIP_GEO, computeChipGeometry, loadChipPlaceholders };
