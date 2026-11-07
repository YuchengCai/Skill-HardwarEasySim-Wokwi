#!/usr/bin/env node
/**
 * layout-v2.js — 布局引擎 v2（模块先行版）
 *
 * 与旧引擎的根本区别：
 *   ① 先算构图骨架（band），再由骨架推导元件坐标——没有写死坐标；
 *   ② 走线按「几何类别」分发：正下方 → 直落；错列 → 阶梯；电源 → 单点喂轨 + 就近取电；
 *   ③ 每条连接都有明确的走线方法，没有"其它情况走默认分支"。
 *   ④ 水平段走两遍法 + left-edge 通道（16px/条），同源平行束按引脚次序分槽；
 *      电源走面包板中列孔总线（消费者→孔，列→长轨一根跳线），不再人人直连长轨。
 *
 * 当前能力：模块（不可插接件）→ 板脚 + 电源列总线/轨；可插接离散件尚未支持（明确告警）。
 * 用法：node layout-v2.js <layout-intent.json> <输出目录> [--json]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sizes = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/sizes.json'), 'utf8')).sizes;
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/pins.json'), 'utf8'));
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/geometry.json'), 'utf8')).breadboard;
const boardsCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/boards.json'), 'utf8')).boards;

const POWER_RE = /^(GND|5V|3\.3V|VIN|VCC|VDD|V\+|V-)(\.\d+)?$/;   // 允许 GND.2 / 5V.1 这类带后缀脚名；舵机 V+ 也算电源
const BB = geo;                                  // 半板：328.8 × 207.9
// 行间距 = 主走廊高度：left-edge 通道不再取模后，走廊要放得下同池的全部车道。
// 用户实测 10px 仍看不出分开，车道步距改 16px；行距随之加到 160。
const LANE_STEP = 16, SLOT_STEP = 4;
const MOD_GAP = 160, MOD_SPACING = 40, BOARD_GAP = 60, TARGET_ASPECT = 1.3;

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
// 分通道时按"组（同源同侧）+ 引脚 y 降序"处理 + left-edge 复用：
// 复用第一条 lastRight < left-4 的车道，否则新开；y = base + rank*LANE_STEP（16px）。
// y 不取模——取模正是第 4 条与第 1 条共线的根因；rank 是受同源束次序约束的纯置换。
const runs = [];
const plans = [];
const mkRun = (pool, x1, x2, meta, opts = {}) => {
  const left = Math.min(x1, x2), right = Math.max(x1, x2);
  const run = {
    pool, left, right, meta,
    laneIdx: -1, y: 0,
    group: opts.group || meta,
    pinY: opts.pinY,
    sortLeft: opts.sortLeft != null ? opts.sortLeft : left,
  };
  runs.push(run);
  return run;
};

// 同一侧引脚共用一个开放方向：不按连接顺序分槽，而是按"引脚沿边的次序"分槽——
// 下面的引脚先处理 → 拿最近的竖向槽；上面的引脚后处理 → 更靠外。
const sidePhase = (id) => (String(id).split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) % 5);
const sideOffset = (id, slot) => sidePhase(id) + slot * SLOT_STEP;

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
// 进孔/进脚前的横向段 y 也全局唯一：不同族的同字母孔 y 相同，必须错开，否则水平段共线。
const usedHorizY = [];
const regHorizY = (y, dir) => {
  let yy = r1(y), guard = 0;
  while (usedHorizY.some(u => Math.abs(u - yy) < 0.5) && guard++ < 60) yy = r1(yy + dir * 2);
  usedHorizY.push(yy);
  return yy;
};

// ── 6 预：连接归一 / 竖向槽次序 / 电源列总线 ───────────────────
const connList = intent.connections || [];
const normed = connList.map((c) => {
  const [fRef, tRef] = [String(c.from), String(c.to)];
  const [fid, fpin] = fRef.split(':');
  const [tid, tpin] = tRef.split(':');
  const swap = fid === boardId && tid !== boardId;
  return {
    fRef, tRef, swap,
    src: swap ? { id: tid, pin: tpin } : { id: fid, pin: fpin },
    dst: swap ? { id: fid, pin: fpin } : { id: tid, pin: tpin },
  };
});
const famOfConn = (n) => (n.dst.id === boardId && famOf(n.dst.id, n.dst.pin)) || famOf(n.src.id, n.src.pin);
const famColor = (fam) => fam === 'GND' ? 'black' : (fam === '3.3V' ? 'orange' : 'red');

// 竖向槽：同一 (元件, 开放侧) 内按引脚 y 降序（下面的引脚先拿最近的槽）。
const buildSlotMap = (which, lowerLast) => {
  const groups = {};
  normed.forEach((n, i) => {
    const pp = pinPos(n[which].id, n[which].pin);
    if (!pp) return;
    const os = openSideRef(n[which].id, n[which].pin);
    if (os.x === 0) return;
    const key = `${n[which].id}:${os.x}`;
    (groups[key] = groups[key] || []).push({ i, y: pp.y });
  });
  const map = new Map();
  for (const key of Object.keys(groups)) {
    // 源端：下面的引脚先处理 → 近槽（槽序与车道序一致）；目标端同样按引脚 y 降序。
    groups[key].sort((a, b) => (lowerLast ? a.y - b.y : b.y - a.y));
    groups[key].forEach((e, k) => map.set(e.i, k));
  }
  return map;
};
const escSlotOf = buildSlotMap('src', false);
const appSlotOf = buildSlotMap('dst', false);
// 同一 (源元件, 开放侧) 的线数：>1 时即使 x 近似对齐也强制走车道，
// 否则后处理的引脚会退化成"无水平段"，平行束就谈不上线序。
const srcGroupCount = {};
normed.forEach((n) => {
  const os = openSideRef(n.src.id, n.src.pin);
  if (os.x === 0) return;
  const key = `${n.src.id}:${os.x}`;
  srcGroupCount[key] = (srcGroupCount[key] || 0) + 1;
});

const holeXOf = (col) => bb.left + geo.width - (geo.hole.offsetX + (col - 1) * geo.pitch);
const holePosOf = (col, half, letter) => {
  const li = letter.charCodeAt(0) - 97;
  const ox = geo.hole.offsetX + (col - 1) * geo.pitch;
  const oy = geo.hole.offsetY + li * geo.pitch + (half === 'b' ? geo.hole.halfBOffset : 0);
  return { x: bb.left + geo.width - ox, y: bb.top + geo.height - oy };
};

// 电源列总线：每族（≥2 个真实电源引脚消费者）在板中列开一条竖向孔列，
// 消费者只连到孔；孔列到长轨只出一根跳线。同族不共列，孔字母按消费者引脚 y 排。
const busHoleOf = new Map();
const busJumpers = [];
{
  const byFam = {};
  normed.forEach((n, i) => {
    n.fam = famOfConn(n);
    if (n.fam && n.dst.id === boardId && famOf(n.src.id, n.src.pin)) (byFam[n.fam] = byFam[n.fam] || []).push(i);
  });
  const usedCols = new Set();
  for (const fam of ['GND', '5V', '3.3V']) {
    const idxs = (byFam[fam] || []).slice();
    if (idxs.length < 2) continue;
    const xs = idxs.map(i => (pinPos(normed[i].src.id, normed[i].src.pin) || {}).x).filter(x => x != null);
    const meanX = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : bb.left + BB.width / 2;
    let col = 10, bd = Infinity;
    for (let c = 10; c <= 20; c++) {
      if (usedCols.has(c)) continue;
      const dd = Math.abs(holeXOf(c) - meanX);
      if (dd < bd) { bd = dd; col = c; }
    }
    usedCols.add(col);
    const half = fam === '3.3V' ? 'b' : 't';              // 3.3V 轨在旋转后板顶 → 用靠上的 b 半区孔
    const letters = half === 't' ? ['a', 'b', 'c', 'd', 'e'] : ['f', 'g', 'h', 'i', 'j'];
    idxs.sort((i, j) => {
      const pi = pinPos(normed[i].src.id, normed[i].src.pin) || { y: 0 };
      const pj = pinPos(normed[j].src.id, normed[j].src.pin) || { y: 0 };
      return pj.y - pi.y;                                  // 下面的引脚 → 下面的孔
    });
    const onBus = idxs.slice(0, letters.length);
    onBus.forEach((i, k) => {
      const hp = holePosOf(col, half, letters[k]);
      busHoleOf.set(i, {
        pin: `bb1:${col}${half}.${letters[k]}`, x: hp.x, y: hp.y,
        dir: half === 't' ? 1 : -1,                         // 孔开放侧：t 朝下、b 朝上
        fam, col, half, letter: letters[k],
      });
    });
    idxs.slice(letters.length).forEach(i => { normed[i].busExtra = true; });
    const jumpLetter = half === 't' ? letters[0] : letters[onBus.length - 1];
    const jp = holePosOf(col, half, jumpLetter);
    const rail = railOf(fam);
    const n = pickRailClear(rail, jp.x, 1);
    busJumpers.push({
      fam, rail, n, half,
      holePin: `bb1:${col}${half}.${jumpLetter}`, hole: jp,
      railX: railX(n), railY: railY(rail),
    });
  }
}

// 同一条板脚上多条线（如 mux:S0/S1/S2 → uno:GND.2）汇合时，进脚前的横段由 regHorizY 逐条错开。

for (const [idx, c] of connList.entries()) {
  const n0 = normed[idx];
  const { fRef, tRef, swap, src, dst } = n0;
  const a = pinPos(src.id, src.pin), b = pinPos(dst.id, dst.pin);
  if (!a || !b) { console.log(`  [跳过] ${fRef} → ${tRef}：引脚坐标缺失`); continue; }
  const srcId = swap ? tRef : fRef;
  const dSrc = distOf[src.id] || 1;
  const pinY0 = a.y;

  // ── 离体/进脚（原理：沿引脚开放侧；左/右边缘引脚必须先水平离开本体）──
  // 实测：rfid 的引脚在左边缘，若直接向下，会穿过自身本体 110px（用户肉眼看到的那根黑线）。
  let escW = null, appW = null, escBaseX = null, escGroup = null;
  {
    const mSrc = mods.find(m => m.id === src.id) || plugs.find(m => m.id === src.id);
    const osS = openSideRef(src.id, src.pin);
    if (mSrc && pos[src.id] && osS.x !== 0) {
      const rel = a.x - pos[src.id].left;
      const edge = osS.x > 0 ? (mSrc.w - rel) : rel;
      const slot = escSlotOf.get(idx) || 0;
      const dBase = osS.x * (Math.max(14, edge + 14) + sidePhase(src.id));
      const d = osS.x * (Math.max(14, edge + 14) + sideOffset(src.id, slot));
      const a0x = a.x;
      escBaseX = r1(a0x + dBase);
      a.x = regVert(r1(a0x + d), Math.sign(d));
      escW = `h${r1(a.x - a0x)}`;
      escGroup = `${src.id}:${osS.x}`;
    } else if (mSrc && osS.y < 0) {
      escW = 'v-14'; a.y = r1(a.y - 14);
      escGroup = `${src.id}:0`;
    }
  }
  if (dst.id !== 'bb1' && dst.id !== boardId) {
    const mT = mods.find(m => m.id === dst.id) || plugs.find(m => m.id === dst.id);
    const oT = openSideRef(dst.id, dst.pin);
    if (mT && pos[dst.id]) {
      const rel = b.x - pos[dst.id].left;
      const edge = oT.x > 0 ? (mT.w - rel) : rel;
      if (oT.x !== 0) {
        const slot = appSlotOf.get(idx) || 0;
        const d = oT.x * (Math.max(14, edge + 14) + sideOffset(dst.id, slot));
        const b0x = b.x;
        b.x = regVert(r1(b0x + d), Math.sign(d));
        appW = `h${r1(-(b.x - b0x))}`;
      } else if (oT.y !== 0) {
        const d = oT.y * 14; b.y = r1(b.y + d); appW = `v${r1(-d)}`;
      }
    }
  }

  // 电源判定看「任一端」：mux:S0→uno:GND.2 里 S0 非电源名但目标脚是 GND
  // → 整个网络按电源网处理；但只有「源引脚本身就是电源脚」的才算列总线消费者。
  const fam = famOfConn(n0);
  const realPower = !!famOf(src.id, src.pin);
  const plan = {
    idx, srcId, fam, srcGroup: escGroup, pinY: pinY0, escBaseX,
    target: swap ? `${boardId}:${dst.pin}` : tRef,
    color: c.color || 'green',
    escW, appW, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, dSrc,
  };

  const srcRun = (pool, x1, x2, meta, target) => mkRun(pool, x1, x2, meta, {
    group: plan.srcGroup, pinY: plan.pinY,
    sortLeft: plan.escBaseX != null ? Math.min(plan.escBaseX, x2) : Math.min(x1, x2),
  });

  if (busHoleOf.has(idx)) {
    // 电源消费者 → 板中列孔（短路径），不再直连长轨
    const hole = busHoleOf.get(idx);
    plan.kind = 'bus';
    plan.hole = hole;
    plan.target = hole.pin;
    plan.color = famColor(fam);
    // 从板右 +90px 的中右带下降：避开板侧竖线群（A:1 汇流），再短横到孔列。
    plan.dx0 = regVert(boardLeft + boardSize.width + 90, 1);
    plan.approachY = regHorizY(hole.y + hole.dir * 14, hole.dir);   // t 孔从下进，b 孔从上进
    plan.runA = srcRun(`A:${dSrc}`, a.x, plan.dx0, `${srcId}→${hole.pin}`, hole.pin);
  } else if (fam && dst.id === boardId && realPower) {
    // 单消费者/总线溢出：仍直连轨（轨位避开更低行模块与板体）
    const rail = railOf(fam);
    const n = pickRailClear(rail, a.x, dSrc);
    const rp = { x: railX(n), y: railY(rail) };
    plan.kind = 'power';
    plan.rp = rp;
    plan.rail = rail;
    plan.target = `bb1:${rail}.${n}`;
    plan.color = famColor(fam);
    const railAtBottom = rp.y > bb.top + BB.height / 2;   // rot180 后 t* 轨渲染在板下缘
    if (!railAtBottom && !blockedBelow(a.x, dSrc) && Math.abs(rp.x - a.x) <= 12) {
      plan.variant = 'direct';                            // 上缘轨近旁直落
    } else if (railAtBottom) {
      // 下缘轨：从轨下方 14px 处向上进轨（末段方向与引脚开放侧一致）
      plan.variant = 'jog';
      plan.x1 = regVert(r1(rp.x + 14), 1);
      plan.runA = srcRun(`A:${dSrc}`, a.x, plan.x1, `${srcId}→${rail}`, plan.target);
    } else {
      plan.variant = 'lane';                              // 上缘轨（bp）：从上方进
      plan.runA = srcRun(`A:${dSrc}`, a.x, rp.x, `${srcId}→${rail}`, plan.target);
    }
  } else if (dst.id === boardId && pinIsBottom(dst.pin)) {
    // 底边板脚：绕板侧下降、从板底下方短距进脚（不再下探到 B 带）
    const dx0 = aroundChX(b.x);
    const underY = regHorizY(Math.max(b.y + 14, boardTop + boardSize.height + 4), 1);
    plan.kind = 'bottom';
    plan.dx0 = dx0;
    plan.underY = underY;
    plan.color = fam ? famColor(fam) : (c.color || 'blue');
    plan.target = `${boardId}:${dst.pin}`;
    plan.runA = srcRun(`A:${dSrc}`, a.x, dx0, `${srcId}→${boardId}:${dst.pin}`, plan.target);
  } else if (dst.id === boardId) {
    // 顶边板脚（数字脚）：从上方进
    plan.kind = 'top';
    plan.color = fam ? famColor(fam) : (c.color || 'green');
    plan.target = `${boardId}:${dst.pin}`;
    plan.runA = srcRun(`A:${dSrc}`, a.x, b.x, `${srcId}→${boardId}:${dst.pin}`, plan.target);
  } else {
    // 模块 → 模块：直落（同列）或 车道横移（车道错开）
    const dx = b.x - a.x;
    const bundled = plan.srcGroup && srcGroupCount[plan.srcGroup] > 1;
    plan.target = swap ? `${boardId}:${dst.pin}` : tRef;
    if (Math.abs(dx) <= 12 && !bundled) plan.kind = 'modDirect';
    else {
      plan.kind = 'mod';
      plan.color = c.color || 'green';
      plan.runA = srcRun(`A:${dSrc}`, a.x, b.x, `${srcId}→${tRef}`, plan.target);
    }
  }
  plans.push(plan);
}

// ── 6b. 列总线 → 长轨：每族一根短跳线 ───────────────────────
for (const bj of busJumpers) {
  plans.push({
    kind: 'busJumper',
    srcId: bj.holePin, target: `bb1:${bj.rail}.${bj.n}`,
    color: famColor(bj.fam),
    a: { x: bj.hole.x, y: bj.hole.y }, b: { x: bj.railX, y: bj.railY },
    bj,
  });
  console.log(`[INFO] 列跳线: ${bj.holePin} → bb1:${bj.rail}.${bj.n}（${bj.fam} 列总线）`);
}

// ── 6c. 板 → 轨馈电（每族一根）：没有馈电则轨道电气悬空 ──────
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
    console.log(`[INFO] 馈电: ${boardId}:${pin} → bb1:${rail}.${n}（轨 ${rail} 共 ${railUsed[rail].size} 个连接）`);
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
    // 同源平行束：同一 (源元件, 开放侧) 的 run 连续处理，且按引脚 y 降序——
    // 下面的引脚先处理拿最近车道，上面的引脚随后落到更深车道；组间按最左端排序。
    const keyOf = (r) => (r.pinY != null ? r.group : `~${r.meta}`);
    const groupMin = {};
    for (const r of list) {
      const g = keyOf(r);
      groupMin[g] = Math.min(groupMin[g] != null ? groupMin[g] : Infinity, r.sortLeft);
    }
    const gRank = new Map(Object.keys(groupMin)
      .sort((a, b) => groupMin[a] - groupMin[b])
      .map((g, i) => [g, i]));
    list.sort((p, q) =>
      (gRank.get(keyOf(p)) - gRank.get(keyOf(q))) ||
      ((q.pinY ?? 0) - (p.pinY ?? 0)) ||
      (p.sortLeft - q.sortLeft) ||
      (p.left - q.left) || (p.right - q.right));
    const groupLastLane = {};                             // 同源束内车道号只能递增
    const groupSeq = {};                                  // 同源束占用的车道序列（有序约束）
    for (const run of list) {
      const g = run.pinY != null ? run.group : null;
      const start = g && groupLastLane[g] != null ? groupLastLane[g] + 1 : 0;
      let idx = -1;
      for (let k = start; k < lanes.length; k++) {
        if (lanes[k].lastRight < run.left - 4) { idx = k; break; }
      }
      if (idx < 0) { idx = lanes.length; lanes.push({ lastRight: run.right, span: 0 }); }
      else lanes[idx].lastRight = Math.max(lanes[idx].lastRight, run.right);
      lanes[idx].span = Math.max(lanes[idx].span, run.right - run.left);
      run.laneIdx = idx;
      if (g) {
        groupLastLane[g] = idx;
        (groupSeq[g] = groupSeq[g] || []).push(idx);
      }
    }
    // 车道 y 的纯置换：宽 run 放上（跨线少），窄 run 放下；但同源束的先后是硬约束，
    // 用车道的偏序图做"带约束的拓扑排序"——优先选 span 最大的可用车道。
    const n = lanes.length;
    const indeg = new Array(n).fill(0);
    const adj = Array.from({ length: n }, () => new Set());
    for (const seq of Object.values(groupSeq)) {
      for (let i = 0; i + 1 < seq.length; i++) {
        if (seq[i] === seq[i + 1]) continue;
        if (!adj[seq[i]].has(seq[i + 1])) { adj[seq[i]].add(seq[i + 1]); indeg[seq[i + 1]]++; }
      }
    }
    const remaining = new Set(lanes.map((_, k) => k));
    const rank = new Map();
    let rk = 0;
    while (remaining.size) {
      let pick = -1;
      for (const k of remaining) {
        if (indeg[k] === 0 && (pick < 0 || lanes[k].span > lanes[pick].span)) pick = k;
      }
      if (pick < 0) break;                                // 理论上不会成环
      rank.set(pick, rk++);
      remaining.delete(pick);
      for (const v of adj[pick]) indeg[v]--;
    }
    if (remaining.size) {                                 // 兜底：按车道号
      for (const k of [...remaining].sort((a, b) => a - b)) rank.set(k, rk++);
    }
    for (const run of list) {
      run.y = base + rank.get(run.laneIdx) * LANE_STEP;
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
      pushV(plan.runA.y); pushH(plan.dx0); pushV(plan.underY);
      pushH(b.x); pushV(b.y);
    } else if (plan.kind === 'bus') {
      pushV(plan.runA.y); pushH(plan.dx0); pushV(plan.approachY);
      pushH(plan.hole.x); pushV(plan.hole.y);
    } else if (plan.kind === 'busJumper') {
      const bj = plan.bj;
      if (bj.half === 't') {                              // t 孔朝下 → 向下出孔，向上进轨
        pushV(bj.railY + 14); pushH(bj.railX); pushV(bj.railY);
      } else {                                            // b 孔朝上 → 向上出孔，向下进轨
        pushV(bj.railY - 14); pushH(bj.railX); pushV(bj.railY);
      }
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
