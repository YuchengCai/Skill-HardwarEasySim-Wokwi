#!/usr/bin/env node
/**
 * iterate-layout.js — 迭代布局骨架（v0.5.x 主线）
 *
 * 生成 → 检测 → 硬伤/软伤分级 → 扩容重排（便宜，脚本兜底）→ 建议改组/换区（交模型）
 *
 * 用法: node iterate-layout.js <layout-intent.json> [output-dir] [--rounds N] [--tolerance M] [--step S]
 * 默认: rounds=3  tolerance=1  step=20（间距 30 起，每轮 +20）
 *
 * 约束分级（与 references/common/layout-rules.md「约束分级」一致）：
 *   硬伤（必须修）：hits-part / parts-overlap / part-on-board / part-on-breadboard /
 *                    wire-through-board / bb-misaligned
 *   软伤（可妥协）：cross / overlap
 *
 * 说明：脚本只做「局部扩容」这一种便宜修复（间距加大消重叠）；交叉这类软伤和
 * 高元件压孔这类硬伤本质是布局/走线设计问题，脚本不硬改，输出建议交回模型。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('用法: node iterate-layout.js <layout-intent.json> [output-dir] [--rounds N] [--tolerance M] [--step S]');
  process.exit(1);
}
const intentPath = path.resolve(args[0]);
const outDir = args[1] && !args[1].startsWith('--') ? path.resolve(args[1]) : path.dirname(intentPath);
const getFlag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : def;
};
const ROUNDS = getFlag('--rounds', 3);
const TOLERANCE = getFlag('--tolerance', 1);
const STEP = getFlag('--step', 20);

const LAYOUT = path.join(__dirname, 'layout-generator.js');
const OPT = path.join(__dirname, 'optimize-wiring.js');
const SUMMARY = path.join(outDir, '.conflicts-summary.json');

let spacing = 30;
let last = null;
for (let r = 0; r < ROUNDS; r++) {
  console.log(`\n[iter ${r + 1}/${ROUNDS}] 生成布局（spacing=${spacing}）…`);
  const g = spawnSync('node', [LAYOUT, intentPath, outDir, '--spacing', String(spacing)], { stdio: 'inherit' });
  if (g.status !== 0) { console.error('[ERR] 布局生成失败'); process.exit(g.status || 1); }

  spawnSync('node', [OPT, outDir, '--dry-run', '--summary-out', SUMMARY], { stdio: 'inherit' });
  if (!fs.existsSync(SUMMARY)) { console.error('[ERR] 未生成冲突摘要（optimize-wiring.js 可能报错）'); process.exit(1); }
  last = JSON.parse(fs.readFileSync(SUMMARY, 'utf-8'));
  console.log(`[iter ${r + 1}] 硬伤=${last.hard} 软伤=${last.soft} 豁免=${last.exempt || 0}（共 ${last.total} 处）`);

  if (last.hard === 0 && last.soft <= TOLERANCE) {
    console.log(`[OK] 达标（硬伤 0、软伤 ≤ ${TOLERANCE}）`);
    break;
  }
  spacing += STEP;
}

if (last && (last.hard > 0 || last.soft > TOLERANCE)) {
  console.log('\n[未达标] 局部扩容无法解决，建议回到模型改组/换区（脚本不自动改分组）：');
  const SUGGEST = {
    'hits-part': '线穿元件 → 高元件出线需绕行 / 元件移位',
    'part-on-board': '元件压板子 → 移回目标 region',
    'part-on-breadboard': '元件压面包板未插接 → 改 placement=bb 或移开',
    'parts-overlap': '元件重叠 → 错开间距',
    'wire-through-board': '线穿板子 → 分侧出线',
    'bb-misaligned': '引脚未对齐孔位 → 用 2 位小数精确对齐（r2）',
    'cross': '线交叉 → 车道错开 / 调整 zone→band 或元件顺序',
    'overlap': '线共线重叠 → 车道错开'
  };
  const types = [...new Set([...(last.hardTypes || []), ...(last.softTypes || [])])];
  for (const t of types) console.log(`  - ${t}: ${SUGGEST[t] || '见 optimize-wiring.js 建议'}`);
}
