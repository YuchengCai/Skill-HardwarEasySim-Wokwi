#!/usr/bin/env node
/**
 * run-tests.js — 回归测试（金标 diff + 冲突计数）
 *
 * 每个 case 目录（tests/cases/<name>/）包含：
 *   intent.json  — layout-intent（模型给的布局意图）
 *   golden.json  — 已知正确、且经用户在 Wokwi 确认过的 diagram.json 快照
 *
 * 对每个 case：
 *   ① 重跑 layout-generator.js 生成 diagram.json
 *   ② diff 输出 vs golden.json（规范化 JSON 后逐字节比较）
 *   ③ 跑 optimize-wiring.js --dry-run，确认冲突数为 0（退出码 0）
 *
 * 用途：每次改动脚本/规则后，一键确认「没把之前对的东西改坏」（防回归）。
 * 用法：node scripts/run-tests.js
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CASES_DIR = path.join(ROOT, 'tests', 'cases');
const LAYOUT = path.join(__dirname, 'layout-generator.js');
const OPT = path.join(__dirname, 'optimize-wiring.js');

const normalize = (s) => JSON.stringify(JSON.parse(s), null, 2);

if (!fs.existsSync(CASES_DIR)) {
  console.log('[SKIP] 无 tests/cases 目录');
  process.exit(0);
}

let pass = 0, fail = 0;
const names = fs.readdirSync(CASES_DIR).sort();
for (const name of names) {
  const dir = path.join(CASES_DIR, name);
  const intent = path.join(dir, 'intent.json');
  const golden = path.join(dir, 'golden.json');
  if (!fs.existsSync(intent) || !fs.existsSync(golden)) continue;

  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  let ok = true;

  // ① 重生成
  try { execFileSync('node', [LAYOUT, intent, outDir], { stdio: 'inherit' }); }
  catch (e) { console.log(`  [gen] ${name} 生成失败`); ok = false; }

  // ② diff 金标
  const got = path.join(outDir, 'diagram.json');
  if (ok && fs.existsSync(got)) {
    try {
      const a = normalize(fs.readFileSync(got, 'utf-8'));
      const b = normalize(fs.readFileSync(golden, 'utf-8'));
      if (a !== b) { console.log(`  [diff] ${name} 输出 ≠ 金标`); ok = false; }
    } catch (e) { console.log(`  [diff] ${name} JSON 解析失败`); ok = false; }
  } else if (ok) { console.log(`  [diff] ${name} 未生成 diagram.json`); ok = false; }

  // ③ 冲突计数（--dry-run 冲突>0 时退出码 2）
  try { execFileSync('node', [OPT, outDir, '--dry-run'], { stdio: 'inherit' }); }
  catch (e) { console.log(`  [conflict] ${name} 检测未通过（退出码 ${e.status}）`); ok = false; }

  if (ok) { pass++; console.log(`[PASS] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name}`); }
}

// ============================================================
// 冲突固定件（fp- = false-positive 应 0 冲突 / fn- = false-negative 应 ≥1 冲突）
// 锁住检测器不误报（fp）也不漏报（fn）
// ============================================================
const CONFLICTS_DIR = path.join(ROOT, 'tests', 'conflicts');
if (fs.existsSync(CONFLICTS_DIR)) {
  for (const name of fs.readdirSync(CONFLICTS_DIR).sort()) {
    const dir = path.join(CONFLICTS_DIR, name);
    if (!fs.existsSync(path.join(dir, 'diagram.json'))) continue;
    const expectClean = name.startsWith('fp-');
    const r = spawnSync('node', [OPT, dir, '--dry-run'], { stdio: 'inherit' });
    const hasConflict = r.status === 2;
    if (expectClean ? !hasConflict : hasConflict) {
      pass++; console.log(`[PASS] ${name} (${expectClean ? '0 冲突' : '检测到冲突'})`);
    } else {
      fail++; console.log(`[FAIL] ${name} 期望 ${expectClean ? '0 冲突' : '≥1 冲突'}，实际 exit ${r.status}`);
    }
  }
}

console.log(`\n结果：${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
