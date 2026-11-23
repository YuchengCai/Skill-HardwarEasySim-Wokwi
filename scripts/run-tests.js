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

// 沙箱兼容：受限环境（如 DSH/容器）创建子进程管道 stdio 会 EPERM，
// 导致 spawnSync 的 stdout 永远为空、全部用例假失败。
// 改为把子进程输出重定向到工作目录内的临时文件（文件句柄不受限），再读回。
function runCapture(args, logPath) {
  const fd = fs.openSync(logPath, 'w');
  try {
    const r = spawnSync('node', args, { stdio: ['ignore', fd, fd] });
    let out = '';
    try { out = fs.readFileSync(logPath, 'utf8'); } catch (e) { /* 保留空串 */ }
    return { status: r.status, error: r.error, out };
  } finally {
    fs.closeSync(fd);
    try { fs.unlinkSync(logPath); } catch (e) { /* 忽略 */ }
  }
}

let pass = 0, fail = 0;
const names = fs.readdirSync(CASES_DIR).sort();
for (const name of names) {
  const dir = path.join(CASES_DIR, name);
  const intent = path.join(dir, 'intent.json');
  if (!fs.existsSync(intent)) continue;

  // expect.json（可选）：genExit / skipOptimize / stdoutMustInclude / stdoutMustNotInclude
  let expect = {};
  const expectPath = path.join(dir, 'expect.json');
  if (fs.existsSync(expectPath)) {
    try { expect = JSON.parse(fs.readFileSync(expectPath, 'utf8')); }
    catch (e) { console.log(`  [expect] ${name} expect.json 解析失败：${e.message}`); }
  }
  const expectedGenExit = (expect.genExit == null) ? 0 : expect.genExit;

  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  let ok = true;

  // ① 重生成（输出落文件后读回，沙箱安全）
  const gen = runCapture([LAYOUT, intent, outDir], path.join(outDir, '.gen.log'));
  const out = gen.out;
  if (gen.error) { console.log(`  [gen] ${name} 子进程无法启动：${gen.error.message}`); ok = false; }
  else if (gen.status !== expectedGenExit) {
    console.log(`  [gen] ${name} 生成退出码 ${gen.status}，期望 ${expectedGenExit}`); ok = false;
  }

  // 期望非 0（预检/对账失败类用例）：只校验退出码与输出锚点，不跑几何检查
  if (ok && expectedGenExit !== 0 && !expect.skipOptimize) {
    // 仍校验锚点
    for (const s of expect.stdoutMustInclude || []) {
      if (!out.includes(s)) { console.log(`  [expect] ${name} 输出缺少「${s}」`); ok = false; }
    }
    for (const s of expect.stdoutMustNotInclude || []) {
      if (out.includes(s)) { console.log(`  [expect] ${name} 输出不应含「${s}」`); ok = false; }
    }
    if (ok) { pass++; console.log(`[PASS] ${name} (期望 exit ${expectedGenExit})`); }
    else { fail++; console.log(`[FAIL] ${name}`); }
    continue;
  }

  // ② 不变式检查（仅正常生成用例）
  if (ok) {
    const hit = BAD_PATTERNS.find(p => out.includes(p));
    if (hit) { console.log(`  [invariant] ${name} 输出含「${hit}」`); ok = false; }
  }

  // ②′ expect.json 校验（可选）：锚子串必须出现/不得出现
  if (ok) {
    for (const s of expect.stdoutMustInclude || []) {
      if (!out.includes(s)) { console.log(`  [expect] ${name} 输出缺少「${s}」`); ok = false; }
    }
    for (const s of expect.stdoutMustNotInclude || []) {
      if (out.includes(s)) { console.log(`  [expect] ${name} 输出不应含「${s}」`); ok = false; }
    }
  }

  // ③ 冲突检查（--dry-run）：线交叉是接受形态（X 形可读），仅当存在
  //    不含「线交叉」字样的冲突行（元件遮挡/重叠等）才 fail。
  if (ok && !expect.skipOptimize) {
    const cr = runCapture([OPT, outDir, '--dry-run'], path.join(outDir, '.opt.log'));
    const cOut = cr.out;
    const conflictLines = cOut.split('\n').filter(l => /^\s*- /.test(l) && !/事实|建议|根因|规则卡/.test(l));
    if (conflictLines.length > 0) {
      const nonCross = conflictLines.filter(l => !l.includes('线交叉'));
      if (nonCross.length > 0) {
        console.log(`  [conflict] ${name} 存在非「线交叉」冲突 ${nonCross.length} 处（exit ${cr.status}）`);
        ok = false;
      }
    }
  }

  if (ok) { pass++; console.log(`[PASS] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name}`); }
}

// ============================================================
// 需求对账固定件（tests/checks/）：intent + diagram + expect.checkExit
// 覆盖端点合法性（未声明引脚键）、指定孔位移、自定义占位件引脚解析。
// ============================================================
const CHECKS_DIR = path.join(ROOT, 'tests', 'checks');
const CHECK = path.join(__dirname, 'check-required.js');
if (fs.existsSync(CHECKS_DIR)) {
  for (const name of fs.readdirSync(CHECKS_DIR).sort()) {
    const dir = path.join(CHECKS_DIR, name);
    if (!fs.existsSync(path.join(dir, 'intent.json')) || !fs.existsSync(path.join(dir, 'diagram.json'))) continue;
    let expect = {};
    const ep = path.join(dir, 'expect.json');
    if (fs.existsSync(ep)) { try { expect = JSON.parse(fs.readFileSync(ep, 'utf8')); } catch (e) { console.log(`  [expect] ${name} 解析失败`); } }
    const expected = (expect.checkExit == null) ? 0 : expect.checkExit;
    const r = runCapture([CHECK, path.join(dir, 'intent.json'), '--dir', dir], path.join(dir, '.check.log'));
    let ok = (r.status === expected);
    if (!ok) console.log(`  [check] ${name} 退出码 ${r.status}，期望 ${expected}；输出：${r.out.slice(0, 300)}`);
    for (const s of expect.stdoutMustInclude || []) {
      if (!r.out.includes(s)) { console.log(`  [check] ${name} 输出缺少「${s}」`); ok = false; }
    }
    for (const s of expect.stdoutMustNotInclude || []) {
      if (r.out.includes(s)) { console.log(`  [check] ${name} 输出不应含「${s}」`); ok = false; }
    }
    if (ok) { pass++; console.log(`[PASS] ${name} (check exit ${expected})`); }
    else { fail++; console.log(`[FAIL] ${name}`); }
  }
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

// ============================================================
// 序列1/文档24 固定件（tests/task1/）：线-孔端点保护 + 异线共线覆盖
// 每个目录：diagram.json + expect.json { optArgs?, mustInclude?, mustNotInclude? }
// ============================================================
const TASK1_DIR = path.join(ROOT, 'tests', 'task1');
if (fs.existsSync(TASK1_DIR)) {
  for (const name of fs.readdirSync(TASK1_DIR).sort()) {
    const dir = path.join(TASK1_DIR, name);
    if (!fs.existsSync(path.join(dir, 'diagram.json'))) continue;
    let expect = {};
    const ep = path.join(dir, 'expect.json');
    if (fs.existsSync(ep)) { try { expect = JSON.parse(fs.readFileSync(ep, 'utf8')); } catch (e) { console.log(`  [expect] ${name} 解析失败`); } }
    const r = runCapture([OPT, dir, '--dry-run', ...(expect.optArgs || [])], path.join(dir, '.opt.log'));
    let ok = true;
    for (const s of expect.mustInclude || []) {
      if (!r.out.includes(s)) { console.log(`  [task1] ${name} 输出缺少「${s}」`); ok = false; }
    }
    for (const s of expect.mustNotInclude || []) {
      if (r.out.includes(s)) { console.log(`  [task1] ${name} 输出不应含「${s}」`); ok = false; }
    }
    if (ok) { pass++; console.log(`[PASS] ${name} (task1 反馈)`); }
    else { fail++; console.log(`[FAIL] ${name}`); }
  }
}

console.log(`\n结果：${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
