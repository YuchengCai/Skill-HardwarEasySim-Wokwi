#!/usr/bin/env node
/**
 * generate-part-placeholder.js — 库外元件占位符生成（v0.7.x：breakout 修复）
 *
 * 用途：wokwi 库没有的元件（RC522 / MP3 模块 / 各种国产传感器）无法模拟，
 *       但需要能画连线图。本脚本现场生成「占位符」= custom chip 引脚定义
 *       （chip.json，官方格式）+ 专属 chip.c + 编译专属 chip.wasm。
 *
 * 机制：wokwi custom chip（官方文档 docs.wokwi.com/chips-api/chip-json）：
 *   - chip.json 的 pins 是「字符串数组」（无坐标，DIP 自动布局，pin1 左上）
 *   - 文件名：<chip-name>.chip.json（如 nrf24l01.chip.json）
 *   - diagram.json 里 type 写 chip-<name>，且 wokwi.toml 需加 [[chip]] 配置
 *   - chip.wasm 必须存在（官方要求，issue #947），否则 "Missing chip" 且连线丢失
 *   - ⚠️ breakout 修复：wasm 的 chip_init() 必须对每个引脚调用 pin_init()
 *     （真实 chip 例子 inverter/mcp9808/tps65185 均如此），否则 wokwi 无法
 *     生成引脚引出（breakout），显示 "Missing chip breakout" 且连线不显示。
 *     本脚本为每个占位符生成专属 chip.c（pin_init 全部引脚为 INPUT 悬空）
 *     并调用 wokwi-cli 编译专属 wasm；wokwi-cli 不可用时降级为通用空 wasm
 *     （此时 breakout 可能仍缺失，会在提示中标注）。
 *
 * 用法：
 *   node generate-part-placeholder.js <name> <pin1> [pin2 ...]
 *   node generate-part-placeholder.js rc522 SDA SCK MOSI MISO IRQ GND RST 3.3V
 *   node generate-part-placeholder.js mp3 VCC GND RX TX BUSY --out ./myproj
 *
 * 输出（<out>/placeholders/<name>/）：
 *   <name>.chip.json   引脚定义（官方 chip 格式）
 *   <name>.chip.c      专属源码（pin_init 全部引脚）
 *   <name>.chip.wasm   编译产物（wokwi-cli 编译，或通用空 wasm 降级）
 *
 * 接入 diagram.json：
 *   { "type": "chip-<name>", "id": "<name>", "top": 0, "left": 0 }
 * 并在 wokwi.toml 加：
 *   [[chip]]
 *   name = '<name>'
 *   binary = 'placeholders/<name>/<name>.chip.wasm'
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
  // 官方格式：pins 是字符串数组（无坐标；旧版 NAME:x:y 语法不再有意义，只取名字）
  const pinNames = args.slice(1).map(p => p.split(':')[0]);

  const dir = path.join(outDir, 'placeholders', name);
  fs.mkdirSync(dir, { recursive: true });

  // 1) chip.json（官方 Custom Chip JSON 格式）：
  //    name/author + pins 字符串数组；无坐标、无 width/height（DIP 自动布局）
  const chipJson = {
    name,
    author: 'wokwi-skill placeholder',
    pins: pinNames,
  };
  const chipFile = `${name}.chip.json`;
  fs.writeFileSync(path.join(dir, chipFile), JSON.stringify(chipJson, null, 2) + '\n');

  // 2) 专属 chip.c：pin_init 全部引脚（INPUT 悬空）。
  //    breakout 修复：wokwi 需要 wasm 运行时注册引脚（pin_init），
  //    否则引脚引出缺失 → "Missing chip breakout" + 连线不显示。
  const chipC = `/**
 * ${name}.chip.c — 占位符芯片（由 generate-part-placeholder.js 生成）
 *
 * 引脚全部初始化为 INPUT（悬空）：提供引脚实体供 wokwi breakout 渲染与连线，
 * 无任何仿真行为（不接总线、不注册回调）。所有引脚保持悬空。
 * 编译：wokwi-cli chip compile ${name}.chip.c -o ${name}.chip.wasm
 */
#include "wokwi-api.h"

void chip_init() {
${pinNames.map(p => `  pin_init("${p}", INPUT);`).join('\n')}
}
`;
  const chipCFile = `${name}.chip.c`;
  fs.writeFileSync(path.join(dir, chipCFile), chipC);

  // 3) 编译专属 wasm：wokwi-cli 自动 fetch 工具链；失败则降级通用空 wasm。
  const wasmFile = `${name}.chip.wasm`;
  const wasmPath = path.join(dir, wasmFile);
  let compiled = false;
  try {
    const r = spawnSync('wokwi-cli', ['chip', 'compile', chipCFile, '-o', wasmFile], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 300000,
    });
    compiled = r.status === 0 && fs.existsSync(wasmPath);
    if (!compiled) {
      console.error(`[WARN] wokwi-cli 编译失败: ${(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(-3).join(' | ')}`);
    }
  } catch (e) {
    console.error(`[WARN] 无法调用 wokwi-cli（${e.message}）`);
  }
  let wasmNote = '';
  if (!compiled) {
    const wasmSrc = path.join(__dirname, 'placeholder-chip.wasm');
    if (fs.existsSync(wasmSrc)) {
      fs.copyFileSync(wasmSrc, wasmPath);
      wasmNote = '（降级：通用空 wasm，未 pin_init 引脚，breakout 可能仍 Missing）';
    } else {
      wasmNote = '（缺失：未找到通用 wasm，wokwi 将显示 Missing chip）';
    }
  }

  // 4) wokwi-api.h 供用户重编译（若 skill 目录有则复制；wokwi-cli 也会自动获取）
  const apiSrc = path.join(__dirname, 'wokwi-api.h');
  if (fs.existsSync(apiSrc) && !fs.existsSync(path.join(dir, 'wokwi-api.h'))) {
    fs.copyFileSync(apiSrc, path.join(dir, 'wokwi-api.h'));
  }

  console.log(`[OK] 占位符已生成: ${dir}/`);
  console.log(`  ${chipFile}（引脚定义）`);
  console.log(`  ${chipCFile}（pin_init 全部引脚，INPUT 悬空）`);
  console.log(`  ${wasmFile}（${compiled ? 'wokwi-cli 编译' : wasmNote}）`);
  console.log(`  引脚: ${pinNames.join(', ')}`);
  console.log('');
  console.log(`接入 diagram.json（连线可验证，模拟不行为）:`);
  console.log(`  { "type": "chip-${name}", "id": "${name}", "top": 0, "left": 0 }`);
  console.log('');
  console.log(`wokwi.toml 需声明 custom chip（官方要求）：`);
  console.log(`  [[chip]]`);
  console.log(`  name = '${name}'`);
  console.log(`  binary = 'placeholders/${name}/${name}.chip.wasm'`);
  console.log('');
  console.log(`⚠️ wokwi.toml 的 [wokwi] 段必须含 firmware 字段（必填字符串，缺失会报`);
  console.log(`   "Firmware path must be a string" 且 diagram.json 无法加载）：`);
  console.log(`  [wokwi]`);
  console.log(`  version = 1`);
  console.log(`  firmware = 'build/<项目名>.ino.hex'   # 或 'sketch.ino'（云端直接编译模式）`);
  console.log('');
  console.log('⚠️ 占位符无模拟行为（引脚悬空），需按数据手册给文字连线方案 + 实物验证提示。');
  if (!compiled) {
    console.log('⚠️ 建议安装 wokwi-cli（npm i -g wokwi-cli）后重新生成，以编译专属 wasm 修复 breakout。');
  }
}

main();
