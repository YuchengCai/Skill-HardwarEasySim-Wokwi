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
// ── 6 前置：行避障 + 车道分配 ──────────────────────────────
// 分层后实测三类问题（用户浏览器实测确认）：
//   ① 模块在板正上方时，线直落穿过板体（A4/A5 线穿 uno 190px）→ 底边脚必须绕板侧进
//   ② mux:S0→uno:GND.2 被当信号（S0 非电源名）三线汇聚板脚 → 电源看「任一端」，走轨
//   ③ 同层所有线共用一条车道 y → 共线重叠 → 每条线错开 8px
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
const laneUse = {};
const laneAlloc = (d) => {
  laneUse[d] = (laneUse[d] || 0) + 1;
  return laneBase(d) + ((laneUse[d] - 1) % 3) * 8;      // 错开 8px，最多 3 档后回绕
};
// 引脚开放侧（单位向量）：底边向下 / 顶边向上 / 左边向左 / 右边向右。
// 用于「离体段」与「方向一致性自检」——原理见 layout-rules.md「走线方向即语义」。
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
const dirOfW = (w) => {
  const m = /^([hv])(-?[\d.]+)$/.exec(String(w));
  if (!m) return null;
  const v = parseFloat(m[2]);
  if (Math.abs(v) <= 12) return null;                   // 微调段不算方向
  return m[1] === 'h' ? { x: Math.sign(v), y: 0 } : { x: 0, y: Math.sign(v) };
};
const belowBase = boardTop + boardSize.height + 14;      // 板底下方的绕行带
let belowUse = 0;
const belowAlloc = () => belowBase + (belowUse++ % 4) * 8;
const aroundX = (bxx) => {                               // 绕板侧的下降 x
  const right = bxx > boardLeft + boardSize.width / 2;
  let dx0 = right ? boardLeft + boardSize.width + 8 : boardLeft - 8;
  if (dx0 > bb.left - 6 && dx0 < bb.left + BB.width + 6) dx0 = boardLeft - 8;   // 右侧被面包板挡 → 走左
  return dx0;
};
const pickRailClear = (rail, wantX, d) => {
  let best = null, bd = Infinity;
  for (let n = 1; n <= geo.rail.maxPosition; n++) {
    if (railUsed[rail].has(n)) continue;
    const x = railX(n);
    if (blockedBelow(x, d)) continue;                   // 下落点被更低行/板体挡住 → 换位
    const dd = Math.abs(x - wantX);
    if (dd < bd) { bd = dd; best = n; }
  }
  if (best == null) return pickRail(rail, wantX);       // 全被挡则退回普通就近
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
  const srcId = swap ? tRef : fRef;
  const dSrc = distOf[src.id] || 1;

  // 电源判定看「任一端」：mux:S0→uno:GND.2 里 S0 非电源名但目标脚是 GND
  // → 整个网络按电源走轨（此前被当信号：三线汇聚板脚 + 穿板，用户实测确认）。
  const fam = (dst.id === boardId && famOf(dst.id, dst.pin)) || famOf(src.id, src.pin);

  if (fam && dst.id === boardId) {
    // 电源：消费者 → 轨（轨位避开更低行模块与板体；引脚无遮挡且轨位近则直落）
    const rail = railOf(fam);
    const n = pickRailClear(rail, a.x, dSrc);
    const rp = { x: railX(n), y: railY(rail) };
    let wps;
    if (!blockedBelow(a.x, dSrc) && Math.abs(rp.x - a.x) <= 12) {
      wps = [];
      if (Math.abs(rp.x - a.x) > 0.5) wps.push(`h${r1(rp.x - a.x)}`);   // 横段在自己本体内（豁免）
      wps.push(`v${r1(rp.y - a.y)}`);
    } else {
      const lane = laneAlloc(dSrc);
      wps = [`v${r1(lane - a.y)}`, `h${r1(rp.x - a.x)}`, `v${r1(rp.y - lane)}`];
    }
    conns.push([srcId, `bb1:${rail}.${n}`, fam === 'GND' ? 'black' : (fam === '3.3V' ? 'orange' : 'red'), wps]);
  } else if (dst.id === boardId && pinIsBottom(dst.pin)) {
    // 底边板脚（A0-A5/电源脚）：从上方直落必然穿板 → 绕板侧下降、从板底下方进脚
    const dx0 = aroundX(b.x);
    const lane = laneAlloc(dSrc);
    const below = belowAlloc();
    const wps = [`v${r1(lane - a.y)}`, `h${r1(dx0 - a.x)}`, `v${r1(below - lane)}`, `h${r1(b.x - dx0)}`, `v${r1(b.y - below)}`];
    conns.push([srcId, `${boardId}:${dst.pin}`, c.color || 'blue', wps]);
  } else if (dst.id === boardId) {
    // 顶边板脚（数字脚）：从上方进
    const lane = laneAlloc(dSrc);
    const wps = [];
    if (a.y < lane) wps.push(`v${r1(lane - a.y)}`);
    wps.push(`h${r1(b.x - a.x)}`, `v${r1(b.y - lane)}`);
    conns.push([srcId, `${boardId}:${dst.pin}`, c.color || 'green', wps]);
  } else {
    // 模块 → 模块：直落（同列）或 车道横移（车道错开）
    const dy = b.y - a.y, dx = b.x - a.x;
    let wps;
    if (Math.abs(dx) <= 12) wps = [`v${r1(dy)}`];
    else {
      const lane = laneAlloc(dSrc);
      const v1 = a.y < lane ? r1(lane - a.y) : 0;
      wps = [];
      if (v1) wps.push(`v${v1}`);
      wps.push(`h${r1(dx)}`, `v${r1(dy - v1)}`);
    }
    conns.push([srcId, swap ? `${boardId}:${dst.pin}` : tRef, c.color || 'green', wps]);
  }
  i++;
}

// ── 6d-pre. 离体段补齐：首段与源引脚开放侧不符 → 前置离体段，并在后续首个
// 同轴段上补偿回来（净位移 0，终点不变）。实测：mfr522/mux 的引脚在左/右边缘，
// 而走线一律向下离体 → U1 8 条 / U2 17 条首段方向不符。
for (const c of conns) {
  if (!Array.isArray(c[3]) || !c[3].length) continue;
  const [fid, fpin] = String(c[0]).split(':');
  if (fid === 'bb1' || fid === boardId) continue;        // 板/孔侧由其它规则保证
  const os = openSideRef(fid, fpin);
  if (os.x !== 0) {
    const d = 14 * os.x;
    const first = dirOfW(c[3][0]);
    if (!first || first.x !== os.x) {
      let comp = false;
      for (let i = 0; i < c[3].length; i++) {
        const m = /^h(-?[\d.]+)$/.exec(c[3][i]);
        if (m) { c[3][i] = 'h' + r1(parseFloat(m[1]) - d); comp = true; break; }
      }
      if (!comp) c[3].push('h' + r1(-d));                // 没有水平段 → 末尾补回
      c[3].unshift('h' + r1(d));
    }
  } else if (os.y < 0) {
    const d = -14;
    const first = dirOfW(c[3][0]);
    if (!first || first.y !== -1) {
      let comp = false;
      for (let i = 0; i < c[3].length; i++) {
        const m = /^v(-?[\d.]+)$/.exec(c[3][i]);
        if (m) { c[3][i] = 'v' + r1(parseFloat(m[1]) - d); comp = true; break; }
      }
      if (!comp) c[3].push('v' + r1(-d));
      c[3].unshift('v' + r1(d));
    }
  }
}
// ── 6d-pre2. 进脚钩：末段方向与目标引脚开放侧不符 → 在末段前把落点挪到
// 「开放侧一侧 14px」，末段改为沿开放侧反向入脚（净位移 0，终点不变）。
// 实测：rfid→mux 的线从上方垂直进 mux，而 mux 引脚开放侧在右侧（5 条不符）。
for (const c of conns) {
  if (!Array.isArray(c[3]) || c[3].length < 2) continue;
  const [tid, tpin] = String(c[1]).split(':');
  if (tid === 'bb1') continue;
  const os = openSideRef(tid, tpin);
  const last = dirOfW(c[3][c[3].length - 1]);
  if (!last) continue;
  const good = last.x * -os.x + last.y * -os.y >= 0.5;   // 末段应沿 -开放侧
  if (good) continue;
  // 找末段之前最后一个同轴段并挪动，再追加沿开放侧反向的小段
  const axis = os.x !== 0 ? 'h' : 'v';
  const d = 14 * (os.x !== 0 ? os.x : os.y);
  let moved = false;
  for (let i = c[3].length - 1; i >= 0; i--) {
    const m = /^([hv])(-?[\d.]+)$/.exec(c[3][i]);
    if (!m || m[1] !== axis) continue;
    c[3][i] = axis + r1(parseFloat(m[2]) + d);
    moved = true;
    break;
  }
  if (!moved) continue;                                   // 找不到可挪段就不动
  c[3].push(axis + r1(-d));
}
// ── 6d. 方向一致性自检（原理层：起点/终点应沿引脚开放侧离体/进脚）─────
// P-方向：底边脚向下、顶边脚向上、左边脚向左、右边脚向右。
// 首段/末段与开放侧不一致 → 说明写反了方向或几何绕错了侧（提示级，不阻断）。
{
  const openSide = (id, pin) => {
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
  const dirOf = (w) => {
    const m = /^([hv])(-?[\d.]+)$/.exec(String(w));
    if (!m) return null;
    const v = parseFloat(m[2]);
    if (Math.abs(v) <= 12) return null;                   // 微调段不算方向
    return m[1] === 'h' ? { x: Math.sign(v), y: 0 } : { x: 0, y: Math.sign(v) };
  };
  let escBad = 0, appBad = 0;
  for (const c of conns) {
    const [fr, to, , wps] = c;
    if (!Array.isArray(wps) || !wps.length) continue;
    const [fid, fpin] = String(fr).split(':');
    const first = dirOf(wps[0]);
    if (first && fid !== 'bb1') {
      const os = openSide(fid, fpin);
      if (first.x * os.x + first.y * os.y < 0.5) escBad++;
    }
    const [tid, tpin] = String(to).split(':');
    const lastDir = dirOf(wps[wps.length - 1]);
    if (lastDir && tid !== 'bb1') {
      const os = openSide(tid, tpin);
      // 进入方向应与开放侧相反（从开放侧向内）
      if (lastDir.x * -os.x + lastDir.y * -os.y < 0.5) appBad++;
    }
  }
  if (escBad || appBad) {
    console.log(`[WARN] 方向一致性: 首段离体方向不符 ${escBad} 条 / 末段进脚方向不符 ${appBad} 条（提示级）`);
  } else {
    console.log('[INFO] 方向一致性: 全部符合引脚开放侧');
  }
}
{
  const FEED = { tn: 'GND.2', tp: '5V', bp: '3.3V' };
  for (const rail of ['tn', 'tp', 'bp']) {
    if (!railUsed[rail].size) continue;
    const pin = boardPins[FEED[rail]] ? FEED[rail] : FEED[rail].split('.')[0];
    const pp = pinPos(boardId, pin);
    if (!pp) continue;
    const n = pickRailClear(rail, boardLeft + boardSize.width + 30, 1);
    const rp = { x: railX(n), y: railY(rail) };
    const below = belowAlloc();
    const wps = [`v${r1(below - pp.y)}`, `h${r1(rp.x - pp.x)}`, `v${r1(rp.y - below)}`];
    conns.push([`${boardId}:${pin}`, `bb1:${rail}.${n}`, rail === 'tn' ? 'black' : (rail === 'bp' ? 'orange' : 'red'), wps]);
    console.log(`[INFO] 馈电: ${boardId}:${pin} → bb1:${rail}.${n}（${railUsed[rail].size} 个消费者）`);
  }
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
