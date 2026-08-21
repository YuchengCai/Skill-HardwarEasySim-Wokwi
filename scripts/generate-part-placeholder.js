#!/usr/bin/env node
/**
 * generate-part-placeholder.js — 库外元件占位符生成（v0.5.x 支线）
 *
 * 用途：wokwi 库没有的元件（RC522 / MP3 模块 / 各种国产传感器）无法模拟，
 *       但需要能画连线图。本脚本现场生成「占位符」= 引脚定义 + 矩形外观，
 *       加入 diagram.json 后连线可验证（模拟不行为，需实物验证）。
 *
 * 用法：
 *   node generate-part-placeholder.js <name> <pin1> [pin2 ...]
 *   node generate-part-placeholder.js rc522 SDA SCK MOSI MISO IRQ GND RST 3.3V
 *   node generate-part-placeholder.js mp3 VCC GND RX TX BUSY --out ./myproj
 *
 * 引脚格式：默认「上排/下排」交替自动布局；也可写 NAME:x:y 指定坐标。
 *
 * 输出：
 *   <out>/placeholders/<name>/board.json   引脚定义
 *   <out>/placeholders/<name>/board.svg    矩形 + 引脚标签外观
 *
 * 接入 diagram.json：
 *   { "type": "wokwi-custom-board", "id": "rc522", "top": 0, "left": 0,
 *     "attrs": { "board": "placeholders/rc522/board.json" } }
 */

const fs = require('fs');
const path = require('path');

// mm→px（96dpi；96/25.4）。board.json（逻辑）用 mm，board.svg（视觉）用 px，两者乘 MM2PX 对齐。
const MM2PX = 96 / 25.4;

function main() {
  const args = process.argv.slice(2);
  let outDir = '.';
  const outIdx = args.indexOf('--out');
  if (outIdx >= 0) {
    outDir = args[outIdx + 1];
    args.splice(outIdx, 2);
  }
  if (args.length < 2) {
    console.error('用法: node generate-part-placeholder.js <name> <pin1> [pin2 ...] [--out <dir>]');
    process.exit(1);
  }
  const name = args[0].toLowerCase();
  const pins = args.slice(1);

  // 解析引脚：NAME 或 NAME:x:y
  const parsed = pins.map(p => {
    const m = p.match(/^([^:]+):(-?\d+):(-?\d+)$/);
    if (m) return { name: m[1], x: parseFloat(m[2]), y: parseFloat(m[3]) };
    return { name: p, x: null, y: null };
  });

  // 自动布局：上排/下排交替，0.1 英寸标准引脚间距（mm）
  const N = parsed.length;
  const PITCH = 2.54;   // 标准 0.1 英寸引脚间距（mm）
  const H = 20;          // 矩形高（mm），上排 y=0，下排 y=20
  const MARGIN = 2.54;   // 左右边距（mm）
  const cols = Math.ceil(N / 2);
  const W = cols * PITCH + 2 * MARGIN;
  parsed.forEach((p, i) => {
    const top = i % 2 === 0;                   // 偶数上排，奇数下排
    const col = Math.floor(i / 2);
    if (p.x === null) p.x = MARGIN + col * PITCH;
    if (p.y === null) p.y = top ? 0 : H;
  });

  // board.json（Wokwi 自定义板格式）：pins 是对象 {name: {x,y}}，width/height 是 mm
  const pinsObj = {};
  parsed.forEach(p => { pinsObj[p.name] = { x: p.x, y: p.y }; });
  const boardJson = {
    name,
    version: 1,
    width: W,
    height: H,
    pins: pinsObj,
  };

  // board.svg（矩形 + 引脚标签）——board.json 是 mm，svg 是 px，全部乘 MM2PX 对齐
  // （viewBox/rect/文字一起乘，保证矩形与标签的相对位置与 board.json 一致）
  const svgW = W * MM2PX;
  const svgH = H * MM2PX;
  const labels = parsed
    .map(p => {
      // 标签坐标：p.x/p.y 是 mm（乘 MM2PX 转 px），偏移 -3/12 本来就是 px，不乘
      const ly = p.y * MM2PX + (p.y === 0 ? -3 : 12);
      return `  <text x="${p.x * MM2PX}" y="${ly}" font-size="9" text-anchor="middle">${p.name}</text>`;
    })
    .join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
  <rect x="${1 * MM2PX}" y="${1 * MM2PX}" width="${(W - 2) * MM2PX}" height="${(H - 2) * MM2PX}" fill="#e8e8e8" stroke="#333" rx="4"/>
  <text x="${(W / 2) * MM2PX}" y="${(H / 2 + 4) * MM2PX}" font-size="14" text-anchor="middle" font-family="monospace">${name}</text>
${labels}
</svg>
`;

  const dir = path.join(outDir, 'placeholders', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'board.json'), JSON.stringify(boardJson, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'board.svg'), svg);

  console.log(`[OK] 占位符已生成: ${dir}/`);
  console.log(`  引脚: ${parsed.map(p => p.name).join(', ')}`);
  console.log('');
  console.log(`接入 diagram.json（连线可验证，模拟不行为）:`);
  console.log(`  { "type": "wokwi-custom-board", "id": "${name}", "top": 0, "left": 0,`);
  console.log(`    "attrs": { "board": "placeholders/${name}/board.json" } }`);
  console.log('');
  console.log('⚠️ 占位符无模拟行为，需按数据手册给文字连线方案 + 实物验证提示。');
}

main();
