#!/usr/bin/env node
/**
 * layout-v2.js — 布局引擎 v2（模块先行版）
 *
 * 与旧引擎的根本区别：
 *   ① 先算构图骨架（band），再由骨架推导元件坐标——没有写死坐标；
 *   ② 走线按「几何类别」分发：正下方 → 直落；错列 → 阶梯；电源 → 单点喂轨 + 就近取电。
 *   ③ 每条连接都有明确的走线方法，没有"其它情况走默认分支"。
 *
 * 当前能力：模块（不可插接件）→ 板脚 + 电源轨；可插接离散件尚未支持（明确告警）。
 * 用法：node layout-v2.js <layout-intent.json> <输出目录> [--json]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sizes = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/sizes.json'), 'utf8')).sizes;
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/pins.json'), 'utf8'));
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/geometry.json'), 'utf8')).breadboard;
const boardsCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/boards.json'), 'utf8')).boards;

const POWER_RE = /^(GND|5V|3\.3V|VIN|VCC|VDD)$/;
const BB = geo;                                  // 半板：328.8 × 207.9
const MOD_GAP = 40, MOD_SPACING = 40, BOARD_GAP = 60, TARGET_ASPECT = 1.3;

const file = process.argv[2], outDir = process.argv[3];
if (!file || !outDir) { console.error('用法: node layout-v2.js <layout-intent.json> <输出目录>'); process.exit(1); }
const intent = JSON.parse(fs.readFileSync(file, 'utf8'));
const sizeOf = t => sizes[t] || { width: 20, height: 20 };
const boardPart = (intent.parts || []).find(p => /arduino|esp32|rp2040|franzininho/i.test(p.type));
const boardType = boardPart ? boardPart.type : 'wokwi-arduino-uno';
const boardId = boardPart ? boardPart.id : 'uno';
const boardSize = sizeOf(boardType);
const boardPins = pins[boardType] || {};

// ── 1. 分类 ────────────────────────────────────────────────
const mods = [], plugs = [];
for (const p of intent.parts || []) {
  if (p.id === boardId) continue;
  const s = sizeOf(p.type);
  const small = s.width * s.height < 3600;
  ((p.placement || 'bb') === 'bb' && small ? plugs : mods).push({ ...p, w: s.width, h: s.height });
}
if (plugs.length) {
  console.log(`[WARN] v2 暂不支持可插接离散件（${plugs.length} 个：${plugs.map(p => p.id).join(',')}）→ 按模块方式直连放置`);
  plugs.forEach(p => mods.push(p));
}

// ── 2. 模块排序（按目标板脚 x 升序）────────────────────────
const pinXOf = (id) => {
  const xs = [];
  for (const c of intent.connections || []) {
    const [a, b] = [String(c.from), String(c.to)];
    if (!a.startsWith(id + ':') && !b.startsWith(id + ':')) continue;
    const other = a.startsWith(id + ':') ? b : a;
    const [oid, opin] = other.split(':');
    if (oid !== boardId) continue;
    const pd = boardPins[opin];
    if (Array.isArray(pd)) xs.push(pd[0]);
  }
  return xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 1e9;
};
mods.sort((a, b) => pinXOf(a.id) - pinXOf(b.id));

// ── 3. 构图骨架（T1/T2 择优，与 compose-skeleton.js 同口径）──
const H_mod = mods.length ? Math.max(...mods.map(m => m.h)) : 0;
const W_mod = mods.reduce((a, m) => a + m.w + MOD_SPACING, 0) - (mods.length ? MOD_SPACING : 0);
const cands = [];
{
  const h = H_mod + 20 + MOD_GAP + BB.height + BOARD_GAP + boardSize.height;
  const w = Math.max(W_mod, BB.width, boardSize.width);
  cands.push({ name: 'T1', w, h, aspect: w / h });
}
{
  const w = boardSize.width + 40 + Math.max(BB.width, W_mod - boardSize.width - 40);
  const h = Math.max(H_mod + MOD_GAP + Math.max(BB.height, boardSize.height), boardSize.height + 40);
  cands.push({ name: 'T2', w, h, aspect: w / h });
}
cands.forEach(c => { c.score = Math.abs(c.aspect - TARGET_ASPECT); });
cands.sort((a, b) => a.score - b.score);
const tpl = cands[0];

const y0_mod = 0, y1_mod = H_mod;
const y1_corridor = y1_mod + 20 + MOD_GAP;
let bbLeft, bbTop, boardLeft, boardTop;
if (tpl.name === 'T2') {
  boardLeft = 0; boardTop = y1_corridor;
  bbLeft = boardSize.width + 40; bbTop = y1_corridor;
} else {
  const W = Math.max(W_mod, BB.width, boardSize.width), cx = W / 2;
  bbTop = y1_corridor; bbLeft = cx - BB.width / 2;
  boardTop = bbTop + BB.height + BOARD_GAP;
  boardLeft = cx - boardSize.width / 2;
}

// ── 4. 放置：模块底部对齐 band0，水平依次排开 ────────────────
const pos = {};
let mx = tpl.name === 'T2' ? 0 : Math.max(0, (Math.max(W_mod, BB.width, boardSize.width) - W_mod) / 2);
for (const m of mods) {
  pos[m.id] = { left: Math.round(mx), top: Math.round(y1_mod - m.h) };
  mx += m.w + MOD_SPACING;
}
const bb = { type: 'wokwi-breadboard-half', id: 'bb1', left: Math.round(bbLeft), top: Math.round(bbTop), rotate: 180 };

// ── 5. 坐标助手（面包板 rot180；元件按 pins.json + 旋转）────
const pinPos = (id, pin) => {
  if (id === 'bb1') {
    let m = String(pin).match(/^(\d+)([tb])\.([a-j])$/);
    if (m) {
      const n = +m[1], li = m[3].charCodeAt(0) - 97;
      const ox = geo.hole.offsetX + (n - 1) * geo.pitch;
      const oy = geo.hole.offsetY + li * geo.pitch + (m[2] === 'b' ? geo.hole.halfBOffset : 0);
      return { x: bb.left + geo.width - ox, y: bb.top + geo.height - oy };
    }
    m = String(pin).match(/^([tb])([pn])\.(\d+)$/);
    if (m) {
      const idx = +m[3] - 1;
      const ox = geo.rail.xLeftRot0 + (idx + Math.floor(idx / geo.rail.groupSize)) * geo.pitch;
      return { x: bb.left + geo.width - ox, y: bb.top + geo.rail.yRot180[m[1] + m[2]] };
    }
    return null;
  }
  const p = pos[id] || (id === boardId ? { left: boardLeft, top: boardTop } : null);
  if (!p) return null;
  const type = id === boardId ? boardType : (intent.parts.find(x => x.id === id) || {}).type;
  const pd = pins[type];
  if (!pd) return null;
  const o = pd[pin];
  if (!Array.isArray(o)) return null;
  return { x: p.left + o[0], y: p.top + o[1] };
};
const railX = n => bb.left + geo.width - (geo.rail.xLeftRot0 + ((n - 1) + Math.floor((n - 1) / geo.rail.groupSize)) * geo.pitch);
const railY = r => bb.top + geo.rail.yRot180[r];

// ── 6. 走线：按几何类别分发 ─────────────────────────────────
const conns = [];
const r1 = v => Math.round(v * 10) / 10;
const railUsed = { tp: new Set(), tn: new Set(), bp: new Set(), bn: new Set() };
const railOf = fam => fam === 'GND' ? 'tn' : fam === '3.3V' ? 'bp' : 'tp';
const pickRail = (rail, wantX) => {
  let best = 1, bd = Infinity;
  for (let n = 1; n <= geo.rail.maxPosition; n++) {
    if (railUsed[rail].has(n)) continue;
    const d = Math.abs(railX(n) - wantX);
    if (d < bd) { bd = d; best = n; }
  }
  railUsed[rail].add(best);
  return best;
};

const famOf = (id, pin) => {
  const type = id === boardId ? boardType : (intent.parts.find(x => x.id === id) || {}).type;
  const pd = pins[type] || {};
  return pd[pin] && POWER_RE.test(pin) ? pin.replace(/\.\d+$/, '') : null;
};

let i = 0;
for (const c of intent.connections || []) {
  const [fRef, tRef] = [String(c.from), String(c.to)];
  const [fid, fpin] = fRef.split(':');
  const [tid, tpin] = tRef.split(':');
  // 方向归一：板脚始终当"目标"
  const swap = fid === boardId && tid !== boardId;
  const src = swap ? { id: tid, pin: tpin } : { id: fid, pin: fpin };
  const dst = swap ? { id: fid, pin: fpin } : { id: tid, pin: tpin };
  const a = pinPos(src.id, src.pin), b = pinPos(dst.id, dst.pin);
  if (!a || !b) { console.log(`  [跳过] ${fRef} → ${tRef}：引脚坐标缺失`); continue; }
  const fam = famOf(src.id, src.pin);
  const srcId = swap ? tRef : fRef;
  const wantX = a.x;

  // 统一"先离体"：模块行下沿 +12 是走廊基准，任何横走都必须先降到它下面
  // （否则横段会穿过同排相邻模块的本体——实测 12 处穿件全由此产生）
  const dropY = y1_mod + 12;
  const vDown = (curY) => (curY < dropY ? r1(dropY - curY) : 0);
  if (fam && dst.id === boardId) {
    // 电源：消费者 → 轨；板子 → 轨（单点喂入）
    const rail = railOf(fam);
    const n = pickRail(rail, wantX);
    const rp = { x: railX(n), y: railY(rail) };
    const wps = [];
    const v1 = vDown(a.y);
    if (v1) wps.push(`v${v1}`);
    const midY = a.y + v1;
    const dx = rp.x - a.x;
    if (Math.abs(dx) > 0.5) wps.push(`h${r1(dx)}`);
    if (Math.abs(rp.y - midY) > 0.5) wps.push(`v${r1(rp.y - midY)}`);
    conns.push([srcId, `bb1:${rail}.${n}`, fam === 'GND' ? 'black' : (fam === '3.3V' ? 'orange' : 'red'), wps]);
  } else {
    // 信号：正下方 → 直落；错列 → 先降到走廊再横移再直落
    const dy = b.y - a.y, dx = b.x - a.x;
    let wps;
    if (Math.abs(dx) <= 12) wps = [`v${r1(dy)}`];
    else {
      const v1 = vDown(a.y);
      wps = [];
      if (v1) wps.push(`v${v1}`);
      wps.push(`h${r1(dx)}`, `v${r1(dy - v1)}`);
    }
    conns.push([srcId, swap ? `${boardId}:${dst.pin}` : tRef, c.color || 'green', wps]);
  }
  i++;
}

// ── 7. 输出 ───────────────────────────────────────────────
const partsOut = [
  { type: bb.type, id: 'bb1', top: bb.top, left: bb.left, rotate: bb.rotate, attrs: {} },
  { type: boardType, id: boardId, top: Math.round(boardTop), left: Math.round(boardLeft), attrs: {} },
  ...mods.map(m => ({ type: m.type, id: m.id, top: pos[m.id].top, left: pos[m.id].left, attrs: {} })),
];
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'diagram.json'), JSON.stringify({ version: 1, author: 'layout-v2', editor: 'wokwi', parts: partsOut, connections: conns }, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(outDir, 'sketch.ino'), 'void setup() {}\nvoid loop() {}\n', 'utf8');
console.log(`[OK] v2 骨架 ${tpl.name}(${Math.round(tpl.w)}×${Math.round(tpl.h)}, 宽高比 ${tpl.aspect.toFixed(2)})｜模块 ${mods.length}｜连接 ${conns.length}｜输出 ${path.join(outDir, 'diagram.json')}`);
