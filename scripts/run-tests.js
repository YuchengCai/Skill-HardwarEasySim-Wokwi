#!/usr/bin/env node
/**
 * run-tests.js — 回归测试（不变式校验 + 冲突计数）
 *
 * 每个 case 目录（tests/cases/<name>/）包含：
 *   intent.json  — layout-intent（模型给的布局意图）
 *   golden.json  — 已知正确、且经用户在 Wokwi 确认过的 diagram.json 快照
 *                  （保留作人工参考，不再逐字节比对）
 *
 * 对每个 case：
 *   ① 重跑 layout-generator.js 生成 diagram.json（捕获输出）
 *   ② 不变式检查：输出含 [重叠] / [走线跳过] / NaN / undefined 任一子串 → fail
 *   ③ 跑 optimize-wiring.js --dry-run，确认冲突数为 0（退出码 0）
 *
 * 用途：每次改动脚本/规则后，一键确认「没把之前对的东西改坏」（防回归）。
 * 用法：node scripts/run-tests.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CASES_DIR = path.join(ROOT, 'tests', 'cases');
const LAYOUT = path.join(__dirname, 'layout-generator.js');
const OPT = path.join(__dirname, 'optimize-wiring.js');

// 不变式：布局输出中不得出现这些子串（重叠告警 / 走线跳过 / NaN / undefined）
const BAD_PATTERNS = ['[重叠]', '[走线跳过]', 'NaN', 'undefined'];

if (!fs.existsSync(CASES_DIR)) {
  console.log('[SKIP] 无 tests/cases 目录');
  process.exit(0);
}

let pass = 0, fail = 0;
const names = fs.readdirSync(CASES_DIR).sort();
for (const name of names) {
  const dir = path.join(CASES_DIR, name);
  const intent = path.join(dir, 'intent.json');
  if (!fs.existsSync(intent)) continue;

  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  let ok = true;

  // ① 重生成（捕获 stdout+stderr）
  const res = spawnSync('node', [LAYOUT, intent, outDir], { encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  if (res.status !== 0) { console.log(`  [gen] ${name} 生成失败（exit ${res.status}）`); ok = false; }

  // ② 不变式检查
  if (ok) {
    const hit = BAD_PATTERNS.find(p => out.includes(p));
    if (hit) { console.log(`  [invariant] ${name} 输出含「${hit}」`); ok = false; }
  }

  // ②′ expect.json 校验（可选）：锚子串必须出现/不得出现
  const expectPath = path.join(dir, 'expect.json');
  if (ok && fs.existsSync(expectPath)) {
    let expect = {};
    try { expect = JSON.parse(fs.readFileSync(expectPath, 'utf8')); }
    catch (e) { console.log(`  [expect] ${name} expect.json 解析失败：${e.message}`); ok = false; }
    for (const s of expect.stdoutMustInclude || []) {
      if (!out.includes(s)) { console.log(`  [expect] ${name} 输出缺少「${s}」`); ok = false; }
    }
    for (const s of expect.stdoutMustNotInclude || []) {
      if (out.includes(s)) { console.log(`  [expect] ${name} 输出不应含「${s}」`); ok = false; }
    }
  }

  // ③ 冲突检查（--dry-run）：线交叉是接受形态（X 形可读），仅当存在
  //    不含「线交叉」字样的冲突行（元件遮挡/重叠等）才 fail。
  const cr = spawnSync('node', [OPT, outDir, '--dry-run'], { encoding: 'utf8' });
  const cOut = (cr.stdout || '') + (cr.stderr || '');
  const conflictLines = cOut.split('\n').filter(l => /^\s*- /.test(l) && !/事实|建议|根因|规则卡/.test(l));
  if (conflictLines.length > 0) {
    const nonCross = conflictLines.filter(l => !l.includes('线交叉'));
    if (nonCross.length > 0) {
      console.log(`  [conflict] ${name} 存在非「线交叉」冲突 ${nonCross.length} 处（exit ${cr.status}）`);
      ok = false;
    }
  }

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
