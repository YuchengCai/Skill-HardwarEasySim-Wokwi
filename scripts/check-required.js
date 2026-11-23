#!/usr/bin/env node
/**
 * check-required.js — 需求对账与必需网络完整性检查（序列1/文档42）
 *
 * 职责：把 layout-intent 的「必需连接」与磁盘上的 diagram.json 逐项对账。
 *  1. 端点合法性：板/元件/自定义占位件(chip-<name>)的引脚键必须真实存在；
 *     面包板孔/轨必须是合法引用（非法引用不再静默跳过）。
 *  2. 网络重建：并查集（可见导线 + $bb 虚拟插接 + 面包板内部导通）。
 *  3. 需求对账：每条 intent 连接的两端必须在同一网络；显式孔位端点必须被
 *     实体线/插接真实接入（指定孔被移动时报错）。
 *  4. 占孔冲突：同一物理孔被多条连接占用 → 报错。
 *
 * 用法：
 *   node check-required.js <intent.json> [--dir <项目目录>] [--diagram <diagram.json>] [--json]
 *   默认 diagram 取 intent 同目录或 --dir 下的 diagram.json。
 *
 * 退出码：0 = 全部通过；3 = 存在必需连接/端点/孔位问题；1 = 输入/文件错误。
 * 输出（--json）：{ ok, errors[], warnings[], required[], endpoints, summary }。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REF_DIR = path.join(__dirname, '..', 'references', 'common');
const HOLE_RE = /^(\d+)([tb])\.([a-j])$/;   // bb 元件区孔：<row><t|b>.<letter>
const RAIL_RE = /^(tn|tp|bn|bp)\.(\d+)$/;    // bb 电源轨：<rail>.<pos 1..25>
const HALF_RANGE = { t: 'abcde', b: 'fghij' }; // 与 layout-generator / breadboard.md 一致

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function loadPins() { return readJson(path.join(REF_DIR, 'pins.json')); }
function loadBoards() { return readJson(path.join(REF_DIR, 'boards.json')).boards || {}; }

function splitRef(ref) {
  const s = String(ref || '');
  const i = s.indexOf(':');
  if (i <= 0 || i === s.length - 1) return null;
  return { id: s.slice(0, i), pin: s.slice(i + 1) };
}
function parseBBPin(pin) {
  let m = String(pin || '').match(HOLE_RE);
  if (m) {
    const row = parseInt(m[1], 10), half = m[2], letter = m[3];
    if (row < 1 || row > 30) return { error: `孔行号越界(${row})` };
    if (!(HALF_RANGE[half] || '').includes(letter)) return { error: `${half} 半区孔字母应为 ${HALF_RANGE[half]}，收到 ${letter}` };
    return { kind: 'hole', row, half, letter, key: `bb:${row}${half}` };
  }
  m = String(pin || '').match(RAIL_RE);
  if (m) {
    const n = parseInt(m[2], 10);
    if (n < 1 || n > 25) return { error: `轨位置号越界(${n})` };
    return { kind: 'rail', rail: m[1], n, key: `bb:rail:${m[1]}` };
  }
  return null;
}

// ── 并查集 ─────────────────────────────────────────────
function makeUF() {
  const parent = new Map();
  const find = x => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  return { find, union, nodes: () => [...parent.keys()] };
}

// ── 自定义芯片引脚定义 ─────────────────────────────────
function loadChipPins(part, dir) {
  const type = String(part.type || '');
  if (!type.startsWith('chip-')) return null;
  const name = type.slice(5);
  const cands = [];
  if (part.attrs && part.attrs.chip) cands.push(path.resolve(dir, part.attrs.chip));
  cands.push(path.join(dir, `${name}.chip.json`));
  cands.push(path.join(dir, 'placeholders', name, `${name}.chip.json`));
  for (const p of cands) {
    try { if (fs.existsSync(p)) { const j = readJson(p); if (Array.isArray(j.pins)) return j.pins.map(String); } } catch (e) { /* ignore */ }
  }
  return null;
}

function check({ intent, dir, diagramPath }) {
  const errors = [], warnings = [];
  const pushErr = (code, message, extra) => errors.push({ code, message, ...(extra || {}) });
  const diagram = readJson(diagramPath);
  const pins = loadPins();
  const boards = loadBoards();
  const boardType = intent.board || 'wokwi-arduino-uno';
  const boardId = (boards[boardType] || {}).id || 'uno';
  const parts = Array.isArray(diagram.parts) ? diagram.parts : [];
  const byId = {};
  parts.forEach(p => { if (p && p.id) byId[p.id] = p; });

  // 引脚表：boardId → 板引脚；元件 id → 允许的引脚 key 集合
  const allowed = {};   // id -> Set(pinKey) | null(=bb)
  const boardPins = pins[boardType] || {};
  allowed[boardId] = new Set(Object.keys(boardPins));
  for (const p of parts) {
    if (!p || !p.id) continue;
    const t = String(p.type || '');
    if (t === 'wokwi-text' || t.startsWith('wokwi-breadboard')) { allowed[p.id] = null; continue; }
    if (t.startsWith('chip-')) {
      const cp = loadChipPins(p, dir);
      if (!cp) { warnings.push({ code: 'CHIP_PINS_UNRESOLVED', message: `未找到 ${p.id}(${t}) 的芯片引脚定义，按未验证处理` }); allowed[p.id] = null; continue; }
      allowed[p.id] = new Set(cp);
      continue;
    }
    const pd = pins[t];
    allowed[p.id] = pd ? new Set(Object.keys(pd)) : null;
    if (!pd) warnings.push({ code: 'PART_PINS_UNRESOLVED', message: `未找到元件类型 ${t} 的引脚表（${p.id}），按未验证处理` });
  }

  const conns = Array.isArray(diagram.connections) ? diagram.connections : [];
  const uf = makeUF();
  const endpointRefs = [];      // 全部 diagram 端点（用于孔占用统计与指定孔接入检查）
  const diagramPairs = [];
  for (let i = 0; i < conns.length; i++) {
    const c = conns[i];
    if (!Array.isArray(c) || c.length < 2) continue;
    const from = splitRef(c[0]), to = splitRef(c[1]);
    if (!from || !to) { pushErr('BAD_CONNECTION', `diagram 连接 #${i} 端点格式非法：${JSON.stringify(c.slice(0, 2))}`); continue; }
    diagramPairs.push({ i, from: c[0], to: c[1], hidden: Array.isArray(c[3]) && c[3][0] === '$bb' });
    endpointRefs.push(c[0], c[1]);
    uf.union(c[0], c[1]);
    // 面包板内部导通
    for (const ref of [c[0], c[1]]) {
      const sp = splitRef(ref);
      if (!sp || sp.id !== 'bb1' && !byId[sp.id]) continue;
      const bb = parseBBPin(sp.pin);
      if (bb && !bb.error) uf.union(ref, bb.key);
      else if (bb && bb.error) pushErr('BAD_BB_HOLE', `diagram 中面包板引用 ${ref} 非法：${bb.error}`);
    }
  }

  // ── 边界：孔位占用冲突（同一孔被多条连接端点占用） ──
  const holeUses = new Map();
  for (const ref of endpointRefs) {
    const sp = splitRef(ref);
    if (!sp) continue;
    const bb = parseBBPin(sp.pin);
    if (bb && bb.kind === 'hole') {
      if (!holeUses.has(ref)) holeUses.set(ref, []);
      holeUses.get(ref).push(ref);
    }
  }
  for (const [ref, arr] of holeUses) if (arr.length > 1) pushErr('DUPLICATE_HOLE', `物理孔 ${ref} 被 ${arr.length} 条连接端点占用（占孔冲突）`);

  // 板内公共网络：Uno 的 GND.* 在板内共地（同网），其余电源脚各自独立。
  // 需求写 GND.1、图落在 GND.2 时仍属同一网络（不误报断网）。
  const boardPinsAll = [...(allowed[boardId] || [])];
  const gndPins = boardPinsAll.filter(p => /^GND(\.|$)/.test(p));
  gndPins.forEach(p => uf.union(`${boardId}:${p}`, `${boardId}:${gndPins[0]}`));

  // ── 端点合法性（对 diagram） ──
  function validateRef(ref, where) {
    const sp = splitRef(ref);
    if (!sp) { pushErr('BAD_REF', `${where} 端点格式非法：${ref}`); return false; }
    if (sp.id === 'bb1') {
      const bb = parseBBPin(sp.pin);
      if (!bb) { pushErr('BAD_BB_REF', `${where} 面包板引用非法：${ref}（应为 <row><t|b>.<a-j> 或 <tn|tp|bn|bp>.<1-25>）`); return false; }
      if (bb.error) { pushErr('BAD_BB_REF', `${where} 面包板引用非法：${ref}（${bb.error}）`); return false; }
      return true;
    }
    if (!byId[sp.id] && sp.id !== boardId) { pushErr('UNKNOWN_PART', `${where} 引用了 diagram 中不存在的元件：${ref}`); return false; }
    const set = allowed[sp.id];
    if (set && !set.has(sp.pin)) {
      pushErr('INVALID_PIN', `${where} 引用了未声明的引脚键：${ref}（${byId[sp.id] ? byId[sp.id].type : '板'} 实际声明：${[...set].slice(0, 16).join(',')}${set.size > 16 ? '…' : ''}）`);
      return false;
    }
    return true;
  }
  for (const d of diagramPairs) { validateRef(d.from, `diagram 连接#${d.i} from`); validateRef(d.to, `diagram 连接#${d.i} to`); }

  // ── 需求对账 ──
  const required = [];
  const intentConns = Array.isArray(intent.connections) ? intent.connections : [];
  intentConns.forEach((c, i) => {
    const from = c.from, to = c.to;
    const okFrom = validateRef(from, `需求#${i} from`);
    const okTo = validateRef(to, `需求#${i} to`);
    const item = { i, from, to, ok: false, reason: '' };
    if (!okFrom || !okTo) { item.reason = '端点非法'; required.push(item); return; }
    uf.find(from); uf.find(to);
    const same = uf.find(from) === uf.find(to);
    // 指定端点必须被实体线/插接真实接入（不能只靠内部导通间接到达）
    let explicitMissing = [];
    for (const ref of [from, to]) {
      const sp = splitRef(ref);
      if (!sp) continue;
      const bb = sp.id === 'bb1' ? parseBBPin(sp.pin) : null;
      if (bb && bb.kind === 'hole' && !endpointRefs.includes(ref)) explicitMissing.push(`指定孔 ${ref} 未被任何实体线/插接接入`);
    }
    item.ok = same && explicitMissing.length === 0;
    if (!item.ok) {
      item.reason = explicitMissing.length
        ? explicitMissing.join('；') + (same ? '' : '；两端不在同一网络')
        : '需求两端不在同一网络（缺失连接或网络断开）';
    }
    required.push(item);
  });

  const ok = errors.length === 0 && required.every(r => r.ok);
  return {
    ok,
    errors,
    warnings,
    required,
    summary: { intentConnections: intentConns.length, diagramConnections: conns.length, errors: errors.length, warnings: warnings.length, failedRequired: required.filter(r => !r.ok).length },
    endpoints: { boardId, parts: parts.map(p => `${p.id}:${p.type}`) },
  };
}

// ── CLI ───────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('用法: node check-required.js <intent.json> [--dir <dir>] [--diagram <diagram.json>] [--json]'); process.exit(1); }
  const intentPath = path.resolve(args[0]);
  const dirArg = args.indexOf('--dir') >= 0 ? path.resolve(args[args.indexOf('--dir') + 1]) : path.dirname(intentPath);
  const diagArg = args.indexOf('--diagram') >= 0 ? path.resolve(args[args.indexOf('--diagram') + 1]) : path.join(dirArg, 'diagram.json');
  const asJson = args.includes('--json');
  let intent, dir = dirArg;
  try { intent = readJson(intentPath); } catch (e) { console.error('[ERROR] 读取 intent 失败：' + e.message); process.exit(1); }
  if (!fs.existsSync(diagArg)) { console.error('[ERROR] 找不到 diagram.json：' + diagArg); process.exit(1); }
  let res;
  try { res = check({ intent, dir, diagramPath: diagArg }); }
  catch (e) { console.error('[ERROR] 检查失败：' + e.message); process.exit(1); }
  if (asJson) console.log(JSON.stringify(res, null, 2));
  else {
    console.log('===== 需求对账与网络完整性检查 =====');
    console.log(`连接：需求 ${res.summary.intentConnections} 条 / 图纸 ${res.summary.diagramConnections} 条`);
    for (const r of res.required) {
      if (r.ok) console.log(`  [OK]   ${r.from} → ${r.to}`);
      else console.log(`  [FAIL] ${r.from} → ${r.to}：${r.reason}`);
    }
    for (const w of res.warnings) console.log(`  [WARN] ${w.code}: ${w.message}`);
    for (const e of res.errors) console.log(`  [ERR]  ${e.code}: ${e.message}`);
    console.log(res.ok ? `[OK] 需求对账通过（${res.required.filter(r => r.ok).length}/${res.required.length}）` : `[FAIL] 需求对账失败：${res.errors.length} 个错误，${res.summary.failedRequired} 条必需连接未满足`);
  }
  process.exit(res.ok ? 0 : 3);
}

module.exports = { check, parseBBPin, splitRef };
