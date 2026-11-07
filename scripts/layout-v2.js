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

const POWER_RE = /^(GND|5V|3\.3V|VIN|VCC|VDD)(\.\d+)?$/;   // 允许 GND.2 / 5V.1 这类带后缀脚名
const BB = geo;                                  // 半板：328.8 × 207.9
// 行间距 = 主走廊高度：left-edge 通道不再取模后，走廊要放得下同池的全部车道（10px/条）。
const MOD_GAP = 100, MOD_SPACING = 40, BOARD_GAP = 60, TARGET_ASPECT = 1.3;

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

// ── 2.5 信号分层（BFS）：直连板子=第 1 层（近板行），经模块中转=第 2+ 层（远行）
// 电源连接不参与距离（人人都有电源，不构成"该放一起"的理由）。
// 对应用户手绘 ref2 形态：RFID（只连 MUX）排上方行，MUX（直连板子）在近板行。
const isPowerPinRef = (id, pin) => {
  const t = id === boardId ? boardType : ((intent.parts.find(x => x.id === id) || {}).type);
  return (pins[t] || {})[pin] ? POWER_RE.test(pin) : false;
};
const sigAdj = {}, boardDirect = new Set();
for (const c of intent.connections || []) {
  const [fa, fb] = [String(c.from), String(c.to)];
  const [aid, apin] = fa.split(':'), [bid, bpin] = fb.split(':');
  if (isPowerPinRef(aid, apin) || isPowerPinRef(bid, bpin)) continue;      // 只看信号
  const aMod = mods.find(m => m.id === aid), bMod = mods.find(m => m.id === bid);
  if (aMod && bMod) {
    (sigAdj[aid] = sigAdj[aid] || new Set()).add(bid);
    (sigAdj[bid] = sigAdj[bid] || new Set()).add(aid);
  } else if (aMod && bid === boardId) boardDirect.add(aid);
  else if (bMod && aid === boardId) boardDirect.add(bid);
}
const distOf = {};
boardDirect.forEach(id => { distOf[id] = 1; });
for (let d = 1; d <= mods.length; d++) {
  const frontier = Object.keys(distOf).filter(id => distOf[id] === d);
  if (!frontier.length) break;
  for (const id of frontier) {
    (sigAdj[id] || new Set()).forEach(n => { if (distOf[n] == null) distOf[n] = d + 1; });
  }
}
mods.forEach(m => { if (distOf[m.id] == null) distOf[m.id] = 1; });       // 孤立模块（纯电源）放近行
const rowsByDist = {};
mods.forEach(m => { const d = distOf[m.id]; (rowsByDist[d] = rowsByDist[d] || []).push(m); });
const maxDist = Math.max(1, ...Object.keys(rowsByDist).map(Number));
const rowH = {};
for (let d = 1; d <= maxDist; d++) rowH[d] = rowsByDist[d] ? Math.max(...rowsByDist[d].map(m => m.h)) : 0;

// ── 3. 构图骨架（T1/T2 择优，与 compose-skeleton.js 同口径）──
// 多行模块带：第 1 层（近板）贴走廊，第 2+ 层依次向上叠
const H_mod = Object.values(rowH).reduce((a, b) => a + b, 0) + (maxDist - 1) * MOD_GAP;
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

// ── 4. 放置：自下而上逐行放。第 1 层贴走廊（近板），第 2+ 层对齐其信号锚点 ──
const pos = {};
const rowBottoms = {};   // d → 该行下沿 y（间隙车道/避障判定要用）
const anchorXOf = (id, d) => {
  // 找同一信号的 d-1 层邻居，用其中心做行对齐基准
  for (const n of (sigAdj[id] || new Set())) {
    if (distOf[n] === d - 1 && pos[n]) return pos[n].left + ((mods.find(m => m.id === n) || {}).w || 0) / 2;
  }
  return null;
};
{
  const canvasW = Math.max(W_mod, BB.width, boardSize.width);
  let yBottom = y1_mod;                                  // 整个模块带的下沿 = 走廊上沿
  for (let d = 1; d <= maxDist; d++) {
    const list = rowsByDist[d] || [];
    if (!list.length) continue;
    const rowTop = yBottom - rowH[d];
    const rowW = list.reduce((s, m) => s + m.w + MOD_SPACING, 0) - MOD_SPACING;
    let startX;
    if (d === 1) {
      startX = tpl.name === 'T2' ? 0 : Math.max(0, (canvasW - rowW) / 2);
    } else {
      const ax = anchorXOf(list[0].id, d);
      startX = ax != null ? Math.max(0, ax - rowW / 2) : Math.max(0, (canvasW - rowW) / 2);
    }
    let x = startX;
    for (const m of list) {
      pos[m.id] = { left: Math.round(x), top: Math.round(rowTop + (rowH[d] - m.h)) };   // 行内底部对齐
      x += m.w + MOD_SPACING;
    }
    rowBottoms[d] = yBottom;
    yBottom = rowTop - MOD_GAP;
  }
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
// 轨位 n 全局唯一：tn/tp/bp 的 n 共用同一套 x 坐标，同 n 会让进轨竖段共线。
const railNUsed = new Set();
const railOf = fam => fam === 'GND' ? 'tn' : fam === '3.3V' ? 'bp' : 'tp';
const pickRail = (rail, wantX) => {
  let best = 1, bd = Infinity;
  for (let n = 1; n <= geo.rail.maxPosition; n++) {
    if (railNUsed.has(n)) continue;
    const d = Math.abs(railX(n) - wantX);
    if (d < bd) { bd = d; best = n; }
  }
  railUsed[rail].add(best);
  railNUsed.add(best);
  return best;
};
// ── 6 前置：行避障 + 通道分配 ──────────────────────────────
// 分层后实测三类问题（用户浏览器实测确认）：
//   ① 模块在板正上方时，线直落穿过板体（A4/A5 线穿 uno 190px）→ 底边脚必须绕板侧进
//   ② mux:S0→uno:GND.2 被当信号（S0 非电源名）三线汇聚板脚 → 电源看「任一端」，走轨
//   ③ 同层所有线共用一条车道 y → 共线重叠 → 改为两遍 left-edge 分通道（见 6a/6c）
// 另：v2 此前没有「板→轨馈电」，轨道电气悬空（optimize-wiring 会报 rail-unpowered）。
const blockedBelow = (x, d) => {
  // 更低行模块的 x 带
  if (mods.some(m => {
    if ((distOf[m.id] || 1) >= d) return false;
    const pp = pos[m.id];
    return pp && x > pp.left - 4 && x < pp.left + m.w + 4;
  })) return true;
  // 控制板本体的 x 带（从上方下落穿过板体 = 穿板硬冲突）
  return x > boardLeft - 4 && x < boardLeft + boardSize.width + 4;
};
const pinIsBottom = (pin) => {
  const pd = boardPins[pin];
  return Array.isArray(pd) && pd[1] > boardSize.height / 2;
};
const laneBase = (d) => (d >= 2 && rowBottoms[d] != null)
  ? Math.min(rowBottoms[d] + 20, y1_mod + 12)
  : y1_mod + 12;
const openSideRef = (id, pin) => {
  if (id === boardId) {
    const pd = boardPins[pin];
    if (!Array.isArray(pd)) return { x: 0, y: 1 };
    return pd[1] > boardSize.height / 2 ? { x: 0, y: 1 } : { x: 0, y: -1 };
  }
  const m = mods.find(x => x.id === id) || plugs.find(x => x.id === id);
  if (!m) return { x: 0, y: 1 };
  const pd = (pins[m.type] || {})[pin];
  if (!Array.isArray(pd)) return { x: 0, y: 1 };
  const dl = pd[0], dr = m.w - pd[0], dt = pd[1], db = m.h - pd[1];
  const mn = Math.min(dl, dr, dt, db);
  if (mn === db) return { x: 0, y: 1 };
  if (mn === dt) return { x: 0, y: -1 };
  if (mn === dl) return { x: -1, y: 0 };
  return { x: 1, y: 0 };
};
const belowBase = boardTop + boardSize.height + 14;      // 板底下方的绕行带
const aroundX = (bxx) => {                               // 绕板侧的下降 x
  const right = bxx > boardLeft + boardSize.width / 2;
  let dx0 = right ? boardLeft + boardSize.width + 8 : boardLeft - 8;
  if (dx0 > bb.left - 6 && dx0 < bb.left + BB.width + 6) dx0 = boardLeft - 8;   // 右侧被面包板挡 → 走左
  return dx0;
};
// 绕板侧竖向通道：同一侧多条线各占一条 x（间距 4px），避免竖向段共线重叠。
// 竖向段端点无法改（要精确落在板脚/轨位上），所以只能给"绕行下降 x"分通道。
const aroundUse = {};
const aroundXCh = (bxx) => {
  const base = aroundX(bxx);
  const k = aroundUse[base] || 0;
  aroundUse[base] = k + 1;
  const dir = base < boardLeft + boardSize.width / 2 ? -1 : 1;
  return r1(base + dir * k * 4);
};
const pickRailClear = (rail, wantX, d) => {
  let best = null, bd = Infinity;
  for (let n = 1; n <= geo.rail.maxPosition; n++) {
    if (railNUsed.has(n)) continue;
    const x = railX(n);
    if (blockedBelow(x, d)) continue;                   // 下落点被更低行/板体挡住 → 换位
    const dd = Math.abs(x - wantX);
    if (dd < bd) { bd = dd; best = n; }
  }
  if (best == null) return pickRail(rail, wantX);       // 全被挡则退回普通就近
  railUsed[rail].add(best);
  railNUsed.add(best);
  return best;
};

const famOf = (id, pin) => {
  const type = id === boardId ? boardType : (intent.parts.find(x => x.id === id) || {}).type;
  const pd = pins[type] || {};
  return pd[pin] && POWER_RE.test(pin) ? pin.replace(/\.\d+$/, '') : null;
};

// ── 6a. 第一遍：只收集水平 run，不生成 waypoints ──────────────
// run = 一段水平走线 { pool, left, right, meta }：
//   pool = `A:${d}` → 第 d 层模块带下方的主走廊（base = laneBase(d)）
//   pool = 'B'      → 板底下方的绕行带（base = belowBase）
// 分通道时按 left 升序 + left-edge 复用：复用第一条 lastRight < left-4 的车道，
// 否则新开一条；y = base + rank*10（不取模——取模正是第 4 条与第 1 条共线的根因）。
// rank 是车道的纯置换（宽 run 放上、窄 run 放下），不改变任何两条 run 的共存关系。
const runs = [];
const plans = [];
const mkRun = (pool, x1, x2, meta) => {
  const run = { pool, left: Math.min(x1, x2), right: Math.max(x1, x2), meta, laneIdx: -1, y: 0 };
  runs.push(run);
  return run;
};

// 同一侧引脚共用一个开放方向：若所有线都只外移固定距离，竖段会落在同一 x 上互相压线。
// 给每个 (元件, 开放侧) 依次 +4px 的离体/进脚偏移，形成独立竖向通道。
const sideUse = {};
const sideOffset = (id, side) => {
  const key = `${id}:${side}`;
  const k = sideUse[key] || 0;
  sideUse[key] = k + 1;
  // 每元件一个固定相位，避免两个不同元件的竖通道恰好落在同一 x。
  const phase = (String(id).split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) % 5);
  return phase + k * 4;
};

// 竖向通道占用表：所有固定竖段 x（板脚/轨位/上下边引脚）+ 已分配的机动竖段 x。
// 机动竖段（离体/进脚/绕行/进轨下降）若与已有竖段同 x（<0.5），沿开放方向再挪 2px。
const FIXED_X = [];
for (let n = 1; n <= geo.rail.maxPosition; n++) FIXED_X.push(railX(n));
const fixedPinsOf = (id) => {
  const type = id === boardId ? boardType : (intent.parts.find(x => x.id === id) || {}).type;
  const pd = pins[type] || {};
  for (const pin of Object.keys(pd)) {
    if (pin.startsWith('_')) continue;
    const pp = pinPos(id, pin);
    if (pp) FIXED_X.push(pp.x);
  }
};
[boardId, ...mods.map(m => m.id)].forEach(fixedPinsOf);
const vertXs = FIXED_X.map(r1);
const hasVert = (x) => vertXs.some(u => Math.abs(u - x) < 0.5);
const regVert = (x, dir) => {
  let xx = r1(x), guard = 0;
  while (hasVert(xx) && guard++ < 40) xx = r1(xx + dir * 2);
  vertXs.push(xx);
  return xx;
};
const aroundChX = (targetX) => {
  const x0 = aroundXCh(targetX);
  const dir = x0 < boardLeft + boardSize.width / 2 ? -1 : 1;
  return regVert(x0, dir);
};

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
  const srcId = swap ? tRef : fRef;
  const dSrc = distOf[src.id] || 1;

  // ── 离体/进脚（原理：沿引脚开放侧；左/右边缘引脚必须先水平离开本体）──
  // 实测：rfid 的引脚在左边缘，若直接向下，会穿过自身本体 110px（用户肉眼看到的那根黑线）。
  let escW = null, appW = null;
  {
    const mSrc = mods.find(m => m.id === src.id) || plugs.find(m => m.id === src.id);
    const osS = openSideRef(src.id, src.pin);
    if (mSrc && pos[src.id] && osS.x !== 0) {
      const rel = a.x - pos[src.id].left;
      const edge = osS.x > 0 ? (mSrc.w - rel) : rel;
      const d = osS.x * (Math.max(14, edge + 14) + sideOffset(src.id, osS.x));
      const a0x = a.x;
      a.x = regVert(r1(a0x + d), Math.sign(d));
      escW = `h${r1(a.x - a0x)}`;
    } else if (mSrc && osS.y < 0) {
      escW = 'v-14'; a.y = r1(a.y - 14);
    }
  }
  if (dst.id !== 'bb1' && dst.id !== boardId) {
    const mT = mods.find(m => m.id === dst.id) || plugs.find(m => m.id === dst.id);
    const oT = openSideRef(dst.id, dst.pin);
    if (mT && pos[dst.id]) {
      const rel = b.x - pos[dst.id].left;
      const edge = oT.x > 0 ? (mT.w - rel) : rel;
      if (oT.x !== 0) {
        const d = oT.x * (Math.max(14, edge + 14) + sideOffset(dst.id, oT.x));
        const b0x = b.x;
        b.x = regVert(r1(b0x + d), Math.sign(d));
        appW = `h${r1(-(b.x - b0x))}`;
      } else if (oT.y !== 0) {
        const d = oT.y * 14; b.y = r1(b.y + d); appW = `v${r1(-d)}`;
      }
    }
  }

  // 电源判定看「任一端」：mux:S0→uno:GND.2 里 S0 非电源名但目标脚是 GND
  // → 整个网络按电源走轨（此前被当信号：三线汇聚板脚 + 穿板，用户实测确认）。
  const fam = (dst.id === boardId && famOf(dst.id, dst.pin)) || famOf(src.id, src.pin);
  const plan = {
    srcId, target: swap ? `${boardId}:${dst.pin}` : tRef,
    color: c.color || 'green',
    escW, appW, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, dSrc,
  };

  if (fam && dst.id === boardId) {
    // 电源：消费者 → 轨（轨位避开更低行模块与板体）。
    const rail = railOf(fam);
    const n = pickRailClear(rail, a.x, dSrc);
    const rp = { x: railX(n), y: railY(rail) };
    plan.kind = 'power';
    plan.rp = rp;
    plan.rail = rail;
    plan.target = `bb1:${rail}.${n}`;
    plan.color = fam === 'GND' ? 'black' : (fam === '3.3V' ? 'orange' : 'red');
    const railAtBottom = rp.y > bb.top + BB.height / 2;   // rot180 后 t* 轨渲染在板下缘
    if (!railAtBottom && !blockedBelow(a.x, dSrc) && Math.abs(rp.x - a.x) <= 12) {
      plan.variant = 'direct';                            // 上缘轨近旁直落
    } else if (railAtBottom) {
      // 下缘轨：从轨下方 14px 处向上进轨（末段方向与引脚开放侧一致），
      // 下降竖段走轨位右侧 14px 的独立竖通道，避免与进轨竖段自重叠。
      plan.variant = 'jog';
      plan.x1 = regVert(r1(rp.x + 14), 1);
      plan.runA = mkRun(`A:${dSrc}`, a.x, plan.x1, `${srcId}→${rail}`);
    } else {
      plan.variant = 'lane';                              // 上缘轨（bp）：从上方进
      plan.runA = mkRun(`A:${dSrc}`, a.x, rp.x, `${srcId}→${rail}`);
    }
  } else if (dst.id === boardId && pinIsBottom(dst.pin)) {
    // 底边板脚（A0-A5/电源脚）：从上方直落必然穿板 → 绕板侧下降、从板底下方进脚
    const dx0 = aroundChX(b.x);                           // 每条线一条独立竖向通道
    plan.kind = 'bottom';
    plan.dx0 = dx0;
    plan.color = c.color || 'blue';
    plan.runA = mkRun(`A:${dSrc}`, a.x, dx0, `${srcId}→${boardId}:${dst.pin}`);
    plan.runB = mkRun('B', dx0, b.x, `${srcId}→${boardId}:${dst.pin}`);
  } else if (dst.id === boardId) {
    // 顶边板脚（数字脚）：从上方进
    plan.kind = 'top';
    plan.color = c.color || 'green';
    plan.runA = mkRun(`A:${dSrc}`, a.x, b.x, `${srcId}→${boardId}:${dst.pin}`);
  } else {
    // 模块 → 模块：直落（同列）或 车道横移（车道错开）
    const dx = b.x - a.x;
    if (Math.abs(dx) <= 12) plan.kind = 'modDirect';
    else {
      plan.kind = 'mod';
      plan.color = c.color || 'green';
      plan.runA = mkRun(`A:${dSrc}`, a.x, b.x, `${srcId}→${tRef}`);
    }
  }
  plans.push(plan);
}

// ── 6b. 板 → 轨馈电（每族一根）：没有馈电则轨道电气悬空 ──────
{
  const FEED = { tn: 'GND.2', tp: '5V', bp: '3.3V' };
  for (const rail of ['tn', 'tp', 'bp']) {
    if (!railUsed[rail].size) continue;
    const pin = boardPins[FEED[rail]] ? FEED[rail] : FEED[rail].split('.')[0];
    const pp = pinPos(boardId, pin);
    if (!pp) continue;
    const n = pickRailClear(rail, boardLeft + boardSize.width + 30, 1);
    const rp = { x: railX(n), y: railY(rail) };
    plans.push({
      kind: 'feed', srcId: `${boardId}:${pin}`, target: `bb1:${rail}.${n}`,
      color: rail === 'tn' ? 'black' : (rail === 'bp' ? 'orange' : 'red'),
      escW: null, appW: null, a: { x: pp.x, y: pp.y }, b: { x: rp.x, y: rp.y },
      rp, rail, dSrc: 1,
      runB: mkRun('B', pp.x, rp.x, `feed:${rail}`),
    });
    console.log(`[INFO] 馈电: ${boardId}:${pin} → bb1:${rail}.${n}（${railUsed[rail].size} 个消费者）`);
  }
}

// ── 6c. 第二遍：left-edge 通道分配（先定 y，再生成 waypoints）──
{
  const byPool = new Map();
  for (const run of runs) {
    if (!byPool.has(run.pool)) byPool.set(run.pool, []);
    byPool.get(run.pool).push(run);
  }
  for (const [pool, list] of byPool) {
    const base = pool === 'B' ? belowBase : laneBase(+pool.slice(2));
    const lanes = [];                                     // 每条车道只记 lastRight
    list.sort((p, q) => (p.left - q.left) || (p.right - q.right));
    for (const run of list) {
      let idx = -1;
      for (let k = 0; k < lanes.length; k++) {
        if (lanes[k].lastRight < run.left - 4) { idx = k; break; }
      }
      if (idx < 0) { idx = lanes.length; lanes.push({ lastRight: run.right, span: 0 }); }
      else lanes[idx].lastRight = Math.max(lanes[idx].lastRight, run.right);
      lanes[idx].span = Math.max(lanes[idx].span, run.right - run.left);
      run.laneIdx = idx;
    }
    // 车道 y 的排列顺序：宽 run 放上面（跨线少），窄 run 放下面——纯置换，不影响不重叠性。
    const rank = new Map();
    const order = lanes.map((l, k) => k);
    order.sort((a, b) => (lanes[b].span - lanes[a].span) || (a - b));
    order.forEach((k, r) => rank.set(k, r));
    for (const run of list) {
      const r = rank.get(run.laneIdx);
      run.y = base + r * 10;
    }
  }
}

// ── 6d. 生成 waypoints：y 已在上一遍定好，不再"补段再补偿" ──────
{
  const emit = (plan) => {
    const w = [];
    if (plan.escW) w.push(plan.escW);
    let cur = { x: plan.a.x, y: plan.a.y };
    const pushV = (ty) => {
      const d = r1(ty - cur.y);
      if (Math.abs(d) >= 0.05) { w.push(`v${d}`); cur.y = r1(cur.y + d); }
    };
    const pushH = (tx) => {
      const d = r1(tx - cur.x);
      if (Math.abs(d) >= 0.05) { w.push(`h${d}`); cur.x = r1(cur.x + d); }
    };
    const b = plan.b;
    if (plan.kind === 'power') {
      if (plan.variant === 'direct') {
        pushH(plan.rp.x); pushV(plan.rp.y);
      } else if (plan.variant === 'lane') {
        pushV(plan.runA.y); pushH(plan.rp.x); pushV(plan.rp.y);
      } else {                                            // jog：下缘轨从轨下方进
        pushV(plan.runA.y); pushH(plan.x1); pushV(plan.rp.y + 14);
        pushH(plan.rp.x); pushV(plan.rp.y);
      }
    } else if (plan.kind === 'bottom') {
      pushV(plan.runA.y); pushH(plan.dx0); pushV(plan.runB.y);
      pushH(b.x); pushV(b.y);
    } else if (plan.kind === 'top') {
      pushV(plan.runA.y); pushH(b.x); pushV(b.y);
    } else if (plan.kind === 'mod') {
      pushV(plan.runA.y); pushH(b.x); pushV(b.y);
    } else if (plan.kind === 'modDirect') {
      pushV(b.y);
    } else if (plan.kind === 'feed') {
      pushV(plan.runB.y); pushH(plan.rp.x); pushV(plan.rp.y);
    }
    if (plan.appW) w.push(plan.appW);
    conns.push([plan.srcId, plan.target, plan.color, w]);
  };
  plans.forEach(emit);
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
