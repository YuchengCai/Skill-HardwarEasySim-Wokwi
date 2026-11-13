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
const LANE_STEP = 16, SLOT_STEP = 12;
const MOD_GAP = 170, BOARD_GAP = 60, TARGET_ASPECT = 1.3;
// 位置搜索参数（默认=原值；环境变量仅供布局实验）
const MOD_SPACING0 = parseFloat(process.env.V2_MOD_SPACING || '0') || 0;
const ROW_DX = parseFloat(process.env.V2_ROW_DX || '0') || 0;
const MOD_OFF = (() => { const m = {}; for (const kv of (process.env.V2_MOD_OFF || '').split(',')) { const [k, v] = kv.split(':'); if (k && v) m[k.trim()] = parseFloat(v) || 0; } return m; })();
const BB_DX = parseFloat(process.env.V2_BB_DX || '0') || 0;
const BOARD_DX = parseFloat(process.env.V2_BOARD_DX || '0') || 0;
const ROW_DY = parseFloat(process.env.V2_ROW_DY || '0') || 0;
// 面包板相对控制板下移：让 tn/tp 轨落在板底脚下方，板→孔/轨可以"向下再向下"直进，
// 不再需要"到轨下方再折回"的 180° 钩。
const BB_DROP = 60;

const file = process.argv[2], outDir = process.argv[3];
if (!file || !outDir) { console.error('用法: node layout-v2.js <layout-intent.json> <输出目录>'); process.exit(1); }
const intent = JSON.parse(fs.readFileSync(file, 'utf8'));
// 可读性模式开关（提前声明：放置段就要用——曾因 TDZ 崩溃三次，2026-11-10）
const readability = !!(intent.routing && (Array.isArray(intent.routing.zones) || Array.isArray(intent.routing.relays)));
// 决策轨迹（V2_TRACE=1）：每根线记录「类别 / 逃逸 x / 由哪条规则决定 / 落在哪条缝 / 阶段行」。
// 用途：避免"改了没效果"时盲猜钩子（本项目曾 3 次找错位置）。关掉时只多一个 if 判断。
const TRACE = !!process.env.V2_TRACE;
const traceOf = new Map();
const T = (k, v) => { if (TRACE) { const r = traceOf.get(k) || {}; Object.assign(r, v); traceOf.set(k, r); } };
// 声明了 routing 的电路（可读性模式）：同排间距加大——离体梯不再挤在 71px 窗口
// （实测 mpu 右梯 371.6 与 rtc 左梯 370 只差 1.6px，两根 300px 长竖线视觉重合）
const MOD_SPACING = MOD_SPACING0 || ((intent.routing && (Array.isArray(intent.routing.zones) || Array.isArray(intent.routing.relays))) ? 130 : 72);   // 130：线束走廊下限（110/130/150 在 U3 上同为 30，但 150 会把 U2r 43→60，130 是两图公共最优）
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
// 走廊（模块带→面包板/板子）与行间隙分治：多行电路的信号车道在行间隙里，
// 走廊只承载最下行模块的少量线（实测 U2 仅 mux 的 ~3 车道）→ 走廊可窄；
// 单行电路（U1 型）全部车道都在走廊 → 走廊保持行间隙宽度。
const CORR_GAP = MOD_GAP;
const H_mod = Object.values(rowH).reduce((a, b) => a + b, 0) + (maxDist - 1) * MOD_GAP;
const W_mod = mods.reduce((a, m) => a + m.w + MOD_SPACING, 0) - (mods.length ? MOD_SPACING : 0);
const cands = [];
{
  const h = H_mod + 20 + CORR_GAP + BB.height + BOARD_GAP + boardSize.height;
  const w = Math.max(W_mod, BB.width, boardSize.width);
  cands.push({ name: 'T1', w, h, aspect: w / h });
}
{
  const w = boardSize.width + 40 + Math.max(BB.width, W_mod - boardSize.width - 40);
  const h = Math.max(H_mod + CORR_GAP + Math.max(BB.height + BB_DROP, boardSize.height), boardSize.height + 40);
  cands.push({ name: 'T2', w, h, aspect: w / h });
}
// T3 两排式（ref2 形态，任务 D）：板 | 枢纽行 | 面包板 同排，其余模块行叠在上方。
// 只在"有枢纽行 + 上方还有行"时作为候选；宽度高比择优与 T1/T2 同口径。
const T3_ROW1 = rowsByDist[1] || [];
const T3_UPPER = [];
for (let d = 2; d <= maxDist; d++) if (rowsByDist[d] && rowsByDist[d].length) T3_UPPER.push(d);
// 【合并 2026-11-12】T3 骨架已弃用：枢纽同排（Rule 7）统一走下方 hub 放置路径，
// 只保留一个入口。V2_T3=1 现在等价于「自动识别枢纽 + bb-band 放置」，输出与本轮
// hub19 一致（交叉 36 / hard 4）。旧 T3 骨架代码保留但不参与候选，便于回溯。
if (process.env.V2_T3 === '1' && !process.env.V2_HUB_PART) {
  // 枢纽识别（Rule 7 可判定版）：连接数最多的模块；并列时取连到板脚更多的那个。
  const deg = {};
  for (const c of (intent.connections || [])) {
    const e0 = Array.isArray(c) ? c[0] : c.from;
    const e1 = Array.isArray(c) ? c[1] : c.to;
    for (const e of [e0, e1]) {
      const id = String(e).split(':')[0];
      if (!mods.some(m => m.id === id)) continue;
      deg[id] = (deg[id] || 0) + 1;
    }
  }
  const boardTouches = {};
  for (const c of (intent.connections || [])) {
    const e0 = String(Array.isArray(c) ? c[0] : c.from);
    const e1 = String(Array.isArray(c) ? c[1] : c.to);
    const m0 = e0.split(':')[0], m1 = e1.split(':')[0];
    if (m1 === boardId) boardTouches[m0] = (boardTouches[m0] || 0) + 1;
    if (m0 === boardId) boardTouches[m1] = (boardTouches[m1] || 0) + 1;
  }
  const ranked = Object.keys(deg).sort((u, v) => (deg[v] - deg[u]) || ((boardTouches[v] || 0) - (boardTouches[u] || 0)));
  if (ranked.length) {
    process.env.V2_HUB_PART = ranked[0];
    if (!process.env.V2_HUB_POS) process.env.V2_HUB_POS = 'bb-band';
    console.log(`[INFO] 枢纽同排（T3=V2_T3）：枢纽 ${ranked[0]}（连接 ${deg[ranked[0]]}，接板 ${boardTouches[ranked[0]] || 0}）`);
  }
}
const T3_OK = false;   // 旧 T3 骨架不再参与候选
// 板↔枢纽间隙：80px 可容 5 根 14px 进脚柱（60px 只放 4 根，第 5 根被挤进板带穿板——实测）。
const GAP_HUB = 80;
const t3RowW = (list) => list.reduce((s, m) => s + m.w + MOD_SPACING, 0) - (list.length ? MOD_SPACING : 0);
if (T3_OK) {
  const w1 = t3RowW(T3_ROW1);
  const hUp = T3_UPPER.reduce((s, d) => s + rowH[d], 0) + (T3_UPPER.length - 1) * MOD_GAP;
  const w = boardSize.width + GAP_HUB + w1 + GAP_HUB + BB.width;
  const h = hUp + MOD_GAP + Math.max(boardSize.height, BB.height);
  cands.push({ name: 'T3', w, h, aspect: w / h });
}
cands.forEach(c => { c.score = Math.abs(c.aspect - TARGET_ASPECT); });
cands.sort((a, b) => a.score - b.score);
// V2_T3=1 是显式意图：flag 存在时直接用 T3（宽高比竞赛不推翻显式选择——
// 实测 GAP_HUB 80 后 T3 宽高比 1.556，以 0.001 之差输给 T2，flag 失效）。
const tpl = (T3_OK && cands.find(c => c.name === 'T3')) || cands[0];

const y0_mod = 0, y1_mod = H_mod;
const y1_corridor = y1_mod + 20 + CORR_GAP;
let bbLeft, bbTop, boardLeft, boardTop;
if (tpl.name === 'T3') {
  // 上排高度 + 一个行间隙 → 板行的顶部
  const hUp = T3_UPPER.reduce((s, d) => s + rowH[d], 0) + (T3_UPPER.length - 1) * MOD_GAP;
  boardLeft = 0;
  boardTop = hUp + MOD_GAP;
} else if (tpl.name === 'T2') {
  boardLeft = BOARD_DX; boardTop = y1_corridor;
  bbLeft = boardSize.width + (parseFloat(process.env.V2_GAP_H || '0') || 40) + BB_DX;
  // 枢纽在板与 bb 之间（用户标定 2026-11-10）：把 bb 右移一个枢纽宽 + 两侧留白
  if (process.env.V2_HUB_PART && (process.env.V2_HUB_POS || '') === 'bb-band') {
    const hm0 = (typeof mods !== 'undefined' ? mods : []).find(q => q.id === process.env.V2_HUB_PART);
    if (hm0) bbLeft = Math.round(boardSize.width + hm0.w + 2 * (parseFloat(process.env.V2_GAP_H || '0') || 40));
  }
  // 前提校验（边缘回归集 a*g150 实测）：行距 < 170 时模块线会穿板/穿件——
  // 硬前提是 ≥170，低于则抬回并在日志提示（不让坏布局带着冲突输出）。
  {
    const gv = parseFloat(process.env.V2_GAP_V || "0");
    if (gv > 0 && gv < 170) {
      console.log(`[WARN] V2_GAP_V=${gv} < 170（硬前提）→ 自动抬到 170`);
      process.env.V2_GAP_V = "170";
    }
  }
  bbTop = parseFloat(process.env.V2_GAP_V || '0') > 0 ? y1_mod + parseFloat(process.env.V2_GAP_V) : y1_corridor + BB_DROP;
  // 行间压缩（V2_GAP_V）时**板随 bb 一起移动**：默认布局里板顶 = bb 顶 - BB_DROP，
  // 保持这个相对关系，否则板脚馈电会横穿板体（实测 GAP_V=170 穿件 2 处）。
  if (parseFloat(process.env.V2_GAP_V || '0') > 0) boardTop = Math.round(bbTop - BB_DROP);
  // 可读性电路默认压缩行间：模块带→bb 顶 = 170（实测 150/170/200/220 交叉拓扑完全相同，
  // 取紧凑值只为减少空白、缩短线长；非可读性电路保持 250 不变）。
  if (!(parseFloat(process.env.V2_GAP_V || '0') > 0) && process.env.V2_NOCOMPACT !== '1') {
    const rdy = !!(intent.routing && (Array.isArray(intent.routing.zones) || Array.isArray(intent.routing.relays)));
    if (rdy) { bbTop = Math.round(y1_mod + 170); boardTop = Math.round(bbTop - BB_DROP); }
  }
  if (process.env.V2_RECT === '1') {
    // 整体外框成矩形：板与 bb **底边对齐**（板顶 262 在走线走廊之下，不占孔行上方空间；
    // 顶对齐实测会把板推进走廊 → 交叉 30→52）
    boardTop = Math.round(bbTop + BB.height - boardSize.height);
  }
  if (process.env.V2_TIGHT === '1') {
    // 压缩：模块带下沿到 bb 顶 = 150（默认 250）；板随 bb 一起下移，保持同一 y 带
    bbTop = Math.round(y1_mod + (parseFloat(process.env.V2_TIGHT_V || '0') || 150));
    boardTop = Math.round(bbTop + 10);
  }
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
  const isT3 = tpl.name === 'T3';
  let yBottom = isT3 ? boardTop - MOD_GAP : y1_mod;   // 整个模块带的下沿 = 走廊上沿
  for (let d = isT3 ? 2 : 1; d <= maxDist; d++) {
    const list = rowsByDist[d] || [];
    if (!list.length) continue;
    const rowTop = yBottom - rowH[d];
    const rowW = list.reduce((s, m) => s + m.w + MOD_SPACING, 0) - MOD_SPACING;
    let startX;
    if (d === 1) {
      // 模板锚定：模块带对齐「面包板列」而非画布左边（T2 板在左、面包板在右；
      // 板子那一列的上方没有可连对象，模块压在那里只会拉长线——ref2 的形态是
      // 模块聚在面包板上方）。行比面包板宽时按面包板中心居中并左钳 0。
      const bbCx = bbLeft + BB.width / 2;
      // 实测（2026-11-08）：把近板行水平挪到板右缘（ref2 的 MUX 摆位）但没有把该行
      // 下移到板/面包板同一水平 → U2 硬冲突 0→6、交叉 53→66。收益来自"同一行"，
      // 不是水平平移；要做必须改模板（见 handoff 任务 D）。
      // 行定位：可读性电路默认按「板左缘..bb右缘」全跨度居中（收紧外框右缘，实测 824→667）；
      // V2_ROWSPAN=0 关闭，V2_RECT/V2_ROWSPAN=1 强制。
      const spanCenter = (boardLeft + bbLeft + BB.width) / 2 - rowW / 2;
      const spanOnlyFirstRow = d === 1 && maxDist === 1;   // 只有单行布局才全跨度居中（U2 的 mux@290 挪动会把 43→51）
      const wantSpan = (process.env.V2_RECT === '1' || process.env.V2_ROWSPAN === '1' || spanOnlyFirstRow);
      startX = tpl.name === 'T2'
        ? Math.max(0, wantSpan ? spanCenter : bbCx - rowW / 2)
        : Math.max(0, (canvasW - rowW) / 2);
    } else {
      const ax = anchorXOf(list[0].id, d);
      startX = ax != null ? Math.max(0, ax - rowW / 2) : Math.max(0, (canvasW - rowW) / 2);
      // 实测（2026-11-08 行-列对位实验）：把消费行右端对齐总线列（rfid3 对准列直落）
      // 单看电源扇入是变好的，但信号线（rfid→mux 左引脚）被迫横穿新增的电源柱区，
      // U2 交叉 53→62。T2 堆叠布局里信号扇和电源扇共用一条走廊，挪哪边都拆东墙补西墙。
      // 结论：行-列对位只能在 T3（mux 进板行、两扇天然分离）里做，见 handoff 任务 D。
    }
    // 布局（用户 2026-11-10）：V2_ALIGN=1 → MPU 与板左对齐、SSD 与 bb 右缘对齐、DS 居中；
    // 否则单行可读性 → 全跨度均匀分布；其余 → 固定间距（历史行为）。
    const isAlign = process.env.V2_ALIGN === '1' && d === 1 && list.length === 3;
    const isEven = !isAlign && readability && d === 1 && maxDist === 1 && list.length > 1;
    if (isAlign) {
      const spanL = boardLeft, spanR = bbLeft + BB.width;
      const seq = [
        list.find(m => /mpu|imu/i.test(m.id)) || list[0],
        list.find(m => /rtc|ds/i.test(m.id)) || list[1],
        list.find(m => /oled|ssd/i.test(m.id)) || list[2],
      ];
      const [L0, M0, R0] = seq;
      pos[L0.id] = { left: Math.round(spanL), top: Math.round(rowTop + ROW_DY + (rowH[d] - L0.h)) };
      pos[R0.id] = { left: Math.round(spanR - R0.w), top: Math.round(rowTop + ROW_DY + (rowH[d] - R0.h)) };
      const freeL = pos[L0.id].left + L0.w, freeR = pos[R0.id].left;
      pos[M0.id] = { left: Math.round((freeL + freeR) / 2 - M0.w / 2), top: Math.round(rowTop + ROW_DY + (rowH[d] - M0.h)) };
    } else if (isEven) {
      const spanL = boardLeft, spanR = bbLeft + BB.width;
      const sumW = list.reduce((q, m) => q + m.w, 0);
      const gap = (spanR - spanL - sumW) / (list.length + 1);
      let xx = spanL + gap;
      for (const m of list) {
        pos[m.id] = { left: Math.round(xx + (MOD_OFF[m.id] || 0)), top: Math.round(rowTop + ROW_DY + (rowH[d] - m.h)) };
        xx += m.w + gap;
      }
    } else {
      let x = startX + ROW_DX;
      for (const m of list) {
        pos[m.id] = {
          left: Math.round(x + (MOD_OFF[m.id] || 0)),
          top: Math.round(rowTop + ROW_DY + (rowH[d] - m.h)),
        };
        x += m.w + MOD_SPACING;
      }
    }
    rowBottoms[d] = yBottom;
    yBottom = rowTop - MOD_GAP;
  }
  // 枢纽元件入左走廊（用户标定 2026-11-10）：MUX 放在 rfid 行与板之间的左侧空区，
  // 信号线进它自己左侧引脚、不占面包板列区——把 bb 留给电源/GND/跳线。
  // V2_HUB_PART=mux1 + V2_HUB_POS=above-board（默认，板左侧上方）| left-of-bb（bb 左缘）
  if (process.env.V2_HUB_PART) {
    const hid = process.env.V2_HUB_PART;
    const hm = mods.find(q => q.id === hid);
    if (hm && pos[hid]) {
      const mode = process.env.V2_HUB_POS || 'above-board';
      let hubTop, hubLeft;
      // 缝宽按"过线数"算（用户 2026-11-10 提议 + `_clearance.js` 实测：mux↔bb 需 6×9.6+12=70）：
      // 净空 = 该缝过线数 × 9.6 + 12，下限 80（留余量）；线与缝的算式写进 layout-analysis.md。
      if (mode === 'bb-band') {
        const hubToBb = (intent.connections || []).filter(c2 => {
          const e0 = Array.isArray(c2) ? c2[0] : c2.from;
          const e1 = Array.isArray(c2) ? c2[1] : c2.to;
          const s0 = String(e0), s1 = String(e1);
          const isHub = s0.startsWith(hid + ':') || s1.startsWith(hid + ':');
          const toBb = s0.startsWith('bb1:') || s1.startsWith('bb1:');
          return isHub && toBb;
        }).length;
        const seamNeed = Math.max(80, Math.round((hubToBb + 2) * 9.6 + 12));   // +2：轨馈与一条预留
        hubTop = Math.round(bbTop - 1);
        hubLeft = Math.round(bbLeft - hm.w - seamNeed);   // 枢纽右缘 ↔ bb 左缘 = seamNeed
        // 板让开枢纽走廊（实测 2026-11-10）：板左移 ≥80px 后 rfid→bb 的竖线不再被板挡，
        // 交叉 54→47；再往左无额外收益。用户手画版是 -154。
        if (!process.env.V2_BOARD_DX) boardLeft = Math.round(boardLeft - 100);
        console.log(`[INFO] 枢纽缝宽: mux↔bb 过线 ${hubToBb} 根 → 需要 ${seamNeed}px`);
      } else if (mode === 'left-of-bb') {
        hubTop = Math.round(bbTop - hm.h - 60);
        hubLeft = Math.round(bbLeft - hm.w - 20);
      } else {
        hubTop = Math.round(boardTop - hm.h - 60);
        hubLeft = Math.round(boardLeft);
      }
      pos[hid] = { left: Math.round(Math.max(0, hubLeft)), top: Math.round(Math.max(0, hubTop)) };
      // bb-band 专用（用户手画布局标定）：板顶下移到 mux 顶 + 60——在 mux 左引脚与板顶之间
      // 留出一条 ~60px 的水平进入槽（rfid→mux 左脚的横段走这里，实测不留槽会穿板 5 处）。
      if (mode === 'bb-band') boardTop = Math.round(pos[hid].top + 60);
      // 行下沿也随之更新（通道规划用 rowBottoms 判定"更低的行"）
      for (const d of Object.keys(rowBottoms)) rowBottoms[d] = Math.max(rowBottoms[d], pos[hid].top + hm.h);
      console.log('[INFO] 枢纽入左走廊:', hid, '→', pos[hid].left + ',' + pos[hid].top, '(' + mode + ')');
    }
  }
  if (isT3) {
    // 枢纽行：与板同一 y 带，贴在板右侧（ref2 的 MUX 摆位）——它的两个去向
    // （左侧板脚、右侧面包板列孔）都在手边，这是 T3 的全部意义。
    const list = T3_ROW1;
    const rowW = t3RowW(list);
    const rowTop = boardTop + (boardSize.height - rowH[1]) / 2;
    let x = boardLeft + boardSize.width + GAP_HUB;
    for (const m of list) {
      pos[m.id] = { left: Math.round(x), top: Math.round(rowTop + (rowH[1] - m.h)) };
      x += m.w + MOD_SPACING;
    }
    rowBottoms[1] = boardTop + rowH[1];
    bbLeft = boardLeft + boardSize.width + GAP_HUB + rowW + GAP_HUB;
    bbTop = boardTop + 10;
  }
}
const bb = { type: 'wokwi-breadboard-half', id: 'bb1', left: Math.round(bbLeft), top: Math.round(bbTop), rotate: 180 };

// 元件/板本体矩形（穿件判定用）：直落式与转角柱都要"两段都不穿本体"。
const partRects = [
  { id: boardId, l: boardLeft, t: boardTop, r: boardLeft + boardSize.width, b: boardTop + boardSize.height },
  ...mods.filter(m => pos[m.id]).map(m => ({ id: m.id, l: pos[m.id].left, t: pos[m.id].top, r: pos[m.id].left + m.w, b: pos[m.id].top + m.h })),
];
const segHitsRect = (x1, y1, x2, y2, skip) => {
  const l = Math.min(x1, x2), r = Math.max(x1, x2), t = Math.min(y1, y2), bt = Math.max(y1, y2);
  const m = 2;
  return partRects.some(p => !(skip && skip.has(p.id)) && r > p.l + m && l < p.r - m && bt > p.t + m && t < p.b - m);
};
// 下方走廊 y：所有本体（板+模块）下缘外 8px。T3（板/枢纽同排）里馈电与电源末段
// 不能在孔行/轨行 y 上横走（会穿 mux/板本体），统一改走这条走廊再竖进目标。
const underCorridorY = () => Math.max(...partRects.map(p => p.b)) + 8;

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
// laneBase：T3 的枢纽行在板同一行 → 它的车道放在板行上方（枢纽行与上排之间）；
// 其余行仍取下沿+20（行间隙里）。
const laneBase = (d) => (tpl.name === 'T3')
  ? (d === 1 ? boardTop - 24 : (rowBottoms[d] != null ? rowBottoms[d] + 20 : boardTop - 24))
  : (d >= 2 && rowBottoms[d] != null)
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
const aroundUse = {};const aroundXCh = (bxx) => {
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

const famOf = (id, pin) => {  const type = id === boardId ? boardType : (intent.parts.find(x => x.id === id) || {}).type;
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
    cls: opts.cls || 'sig',                    // 去向类别：sig 模块 / brd 板脚 / pwr 电源（分带用）
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

// ── 6 预-0：转角柱（turn posts）──────────────────────────────
// 用户反馈"同束线的转弯 x 各用各的、直角不齐"的根因：转角 x 由多家公式
// （hole.x±16+k*4 / 绕行 aroundX+k*4 / 进脚 slot）各自推导，再被 regVert 以 2px
// 步长避让 → 束内出现 2/5/7px 的碎间距，视觉上没有"走廊"。
// 做法：① 每束（同元件同侧 / 同目标 / 同目的地列）只分配一组**等距柱**；
//       ② 柱锚吸到 14px 全局网格 → 不同束的柱子落在同一张网上，转角对齐；
//       ③ 冲突时整梯平移一个柱距（不是挪 2px），束内等距不被破坏。
// 注意：占用判定必须带 y 区间——轨位 x 每 9.6px 一个，若按"全 x 唯一"，
// 任何 5 连柱都会撞轨、被挤到面包板外（实测 mux 进脚柱从 434 被挤到 336）。
const POST_STEP = 14;
const POST_CLEAR = 6;                                  // 柱与柱/固定桩的最小视觉间距
const VSEG = [];                                       // 竖向占用：{x, y1, y2}
const vBusy = (x, y1, y2) => VSEG.some(s => Math.abs(s.x - x) < POST_CLEAR
  && Math.min(s.y2, y2) - Math.max(s.y1, y1) > 0.5);
const vReg = (x, y1, y2) => { VSEG.push({ x: r1(x), y1, y2 }); return r1(x); };
// 固定竖段：引脚只挡自身 ±16 的短桩；轨位只挡轨线附近 ±16
for (const id of [boardId, ...mods.map(m => m.id)]) {
  const type = id === boardId ? boardType : (intent.parts.find(x => x.id === id) || {}).type;
  const pd = pins[type] || {};
  for (const pin of Object.keys(pd)) {
    if (pin.startsWith('_')) continue;
    const pp = pinPos(id, pin);
    if (pp) vReg(pp.x, pp.y - 16, pp.y + 16);
  }
}
for (let n = 1; n <= geo.rail.maxPosition; n++) {
  for (const rk of ['tn', 'tp', 'bn', 'bp']) {
    if (geo.rail.yRot180[rk] == null) continue;
    vReg(railX(n), railY(rk) - 16, railY(rk) + 16);
  }
}
const postXs = [];
// 注：曾试过给 postFree 加"柱竖段不得穿本体"的硬检查 —— T2 基线被打坏（U2 共线+1、转弯 53），
// T3 反而更差（硬冲突 15→25）。转角柱的合法性必须由"走廊模型"保证，不能靠事后否决。
const postFree = (x, y1, y2) => !postXs.some(u => Math.abs(u - x) < POST_CLEAR) && !vBusy(x, y1, y2);
const takePost = (x, y1, y2) => {
  if (!postXs.some(u => Math.abs(u - x) < 1)) postXs.push(r1(x));
  vReg(x, y1, y2); vertXs.push(r1(x));
  return r1(x);
};
const escLadders = new Map();      // 离体梯子：key → { xs, step, baseD }
const turnLadders = new Map();     // 转角梯子：key → { xs }

// 离体梯子：同 (元件, 开放侧) 的线共用一组等距槽，整体落进可用窗口 [base, maxDist]。
const escPost = (key, slot, a0x, dir, base, maxDist, n, y1, y2) => {
  let L = escLadders.get(key);
  if (!L) {
    const cnt = Math.max(n, slot + 1, 1);
    // 锚点吸网格：整梯的第一个槽落在 14 的整数倍上（束间对齐）
    let baseD = base;
    const snapX = Math.round((a0x + dir * base) / POST_STEP) * POST_STEP;
    const snapD = Math.abs(snapX - a0x);
    if (snapD >= 6 && snapD <= maxDist && snapD >= base - POST_STEP) baseD = snapD;
    // 窗口放不下整梯 → 在窗口内均匀压缩（绝不塌成同一 x）
    const room = Math.max(0, maxDist - baseD);
    let step = SLOT_STEP;
    if (cnt > 1 && (cnt - 1) * step > room + 0.01) step = Math.max(3, room / (cnt - 1));
    const xs = [];
    for (let i = 0; i < cnt; i++) xs.push(r1(a0x + dir * (baseD + i * step)));
    // 与已分配柱保持最小间距：整梯沿 dir 微移（保持等距），仍须落在窗口内
    let placed = xs;
    for (let s = 0; s <= 10; s++) {
      const off = (s % 2 === 0 ? s / 2 : -(s + 1) / 2) * 2;      // 0, +2, -2, +4, -4 …
      const cand = xs.map(x => r1(x + dir * off));
      const dFirst = Math.abs(cand[0] - a0x), dLast = Math.abs(cand[cand.length - 1] - a0x);
      if (dFirst < 6 || dLast > maxDist + 0.01) continue;
      if (cand.every(x => !postXs.some(u => Math.abs(u - x) < POST_CLEAR))) { placed = cand; break; }
    }
    placed.forEach(x => takePost(x, y1, y2));
    L = { xs: placed, step, baseD };
    escLadders.set(key, L);
  }
  return L.xs[Math.min(slot, L.xs.length - 1)];
};

// 稀疏束（落孔转角柱）：按下标按需生长，避免为"可能到来的槽"预留整梯而撞轨。
const growPost = (key, slot, o) => {
  let L = turnLadders.get(key);
  if (!L) {
    const base = Math.round(o.prefer / POST_STEP) * POST_STEP;
    let x0 = null;
    for (let k = 0; k <= 40 && x0 == null; k++) {
      for (const s of (k === 0 ? [0] : [k, -k])) {
        const x = r1(base + s * POST_STEP * o.dir);
        if (x >= o.lo && x <= o.hi && postFree(x, o.y1, o.y2)) { x0 = x; break; }
      }
    }
    if (x0 == null) x0 = r1(o.prefer);
    L = { xs: [takePost(x0, o.y1, o.y2)] };
    turnLadders.set(key, L);
  }
  while (L.xs.length <= slot) {
    let placed = null;
    for (let k = 1; k <= 12 && placed == null; k++) {          // 向外找下一个空柱（允许跳格）
      const x = r1(L.xs[L.xs.length - 1] + o.dir * k * (o.step || POST_STEP));
      if (x < o.lo || x > o.hi) break;
      if (postFree(x, o.y1, o.y2)) placed = x;
    }
    if (placed == null) placed = regVert(r1(L.xs[L.xs.length - 1] + o.dir * (o.step || POST_STEP)), o.dir);
    if (process.env.V2_POSTDBG) console.log('[GROW-DBG]', key, 'slot', slot, 'last', L.xs[L.xs.length - 1], '->', placed);
    L.xs.push(takePost(placed, o.y1, o.y2));
  }
  return L.xs[slot];
};
const turnPost = (key, slot, o) => {
  // 转角梯子：open 空间里的竖向转弯柱（绕板 x / 进脚 x）。束内整梯等距、锚吸 14px 网格。
  let L = turnLadders.get(key);
  if (!L) {
    const n = Math.max(1, o.count || 1), step = o.step || POST_STEP;
    const base = Math.round(o.prefer / POST_STEP) * POST_STEP;
    let best = null;
    for (let k = 0; k <= 40 && !best; k++) {
      for (const s of (k === 0 ? [0] : [k, -k])) {
        const x0 = r1(base + s * POST_STEP * o.dir);
        const xs = [];
        let ok = true;
        for (let i = 0; i < n; i++) {
          const x = r1(x0 + o.dir * i * step);
          if (x < o.lo - 0.01 || x > o.hi + 0.01 || !postFree(x, o.y1, o.y2)) { ok = false; break; }
          xs.push(x);
        }
        if (ok) { best = xs; break; }
        if (process.env.V2_POSTDBG) {
          const bad = [];
          for (let i = 0; i < n; i++) {
            const x = r1(x0 + o.dir * i * step);
            if (x < o.lo - 0.01 || x > o.hi + 0.01) { bad.push(`${x}:OOB`); continue; }
            if (postXs.some(u => Math.abs(u - x) < 1)) bad.push(`${x}:POST`);
            const hit = VSEG.filter(s => Math.abs(s.x - x) < 0.5 && Math.min(s.y2, o.y2) - Math.max(s.y1, o.y1) > 0.5);
            if (hit.length) bad.push(`${x}:VSEG(${hit.map(h => h.x + '@' + Math.round(h.y1) + '-' + Math.round(h.y2)).join('|')})`);
          }
          console.log('[POST-DBG]', key, 'try', x0, 'bad', bad.join(' '));
        }
      }
    }
    if (!best) {                                   // 兜底：逐柱 2px 退让（老行为）
      best = [];
      for (let i = 0; i < n; i++) best.push(regVert(r1(o.prefer + o.dir * i * step), o.dir));
    }
    best.forEach(x => takePost(x, o.y1, o.y2));
    L = { xs: best };
    turnLadders.set(key, L);
  }
  return L.xs[Math.min(slot, L.xs.length - 1)];
};
// 进孔/进脚前的横向段 y 也全局唯一：不同族的同字母孔 y 相同，必须错开，否则水平段共线。
const usedHorizY = [];
const regHorizY = (y, dir) => {
  let yy = r1(y), guard = 0;
  while (usedHorizY.some(u => Math.abs(u - yy) < 0.5) && guard++ < 60) yy = r1(yy + dir * 2);
  usedHorizY.push(yy);
  return yy;
};

// ── 5.5 assignable[]：可互换引脚组重排（intent 显式声明，引擎按几何分配）──────
// 电气等价的目标引脚（mux 通道等）是走线维度：左源拿低引脚带（用户黄金样本 §6.8-④ 标定，
// 手工重排 -4 交叉）。只在 intent.assignable 存在时生效；未声明行为与旧版完全一致。
// 语义见 intent-format.md「assignable[]」——引擎不猜，只消费声明。
if (Array.isArray(intent.assignable)) {
  for (const g of intent.assignable) {
    const partDef = (intent.parts || []).find(p => p.id === g.part);
    if (!partDef) continue;
    const pd = pins[partDef.type] || {};
    const groupPins = (g.pins || []).filter(p => Array.isArray(pd[p]));
    if (groupPins.length < 2) continue;
    const members = [];
    (intent.connections || []).forEach((c, i) => {
      const [fid, fpin] = String(c.from).split(':');
      const [tid, tpin] = String(c.to).split(':');
      let other = null, isFrom = false;
      if (tid === g.part && groupPins.includes(tpin)) other = { id: fid, pin: fpin };
      else if (fid === g.part && groupPins.includes(fpin)) { other = { id: tid, pin: tpin }; isFrom = true; }
      if (!other) return;
      const sp = pinPos(other.id, other.pin);
      if (!sp) return;
      members.push({ i, sp, isFrom, otherId: other.id });
    });
    if (members.length < 2 || members.length > groupPins.length) continue;
    // 源按 (x 升序, y 升序) ↔ 组内引脚按 y 降序（屏幕最低的引脚带给最左/最上的源）
    members.sort((a, b) => (a.sp.x - b.sp.x) || (a.sp.y - b.sp.y));
    const sorted = groupPins
      .map(p => ({ p, pp: pinPos(g.part, p) }))
      .filter(e => e.pp)
      .sort((a, b) => b.pp.y - a.pp.y);
    members.forEach((m, k) => {
      const np = sorted[k % sorted.length].p;
      const c = intent.connections[m.i];
      if (m.isFrom) c.from = `${g.part}:${np}`;
      else c.to = `${g.part}:${np}`;
      console.log(`[INFO] assignable: ${g.part} 重排，源 ${m.otherId} → ${np}`);
    });
  }
}

// ── 6 预：连接归一 / 竖向槽次序 / 电源列总线 ───────────────────
const connList = intent.connections || [];
const normed = connList.map((c) => {
  const [fRef, tRef] = [String(c.from), String(c.to)];
  const [fid, fpin] = fRef.split(':');
  const [tid, tpin] = tRef.split(':');
  const swap = fid === boardId && tid !== boardId;
  return {
    fRef, tRef, swap, color: c.color,
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
// 进脚束（同目标元件同侧）的线数：转角梯子按整梯分配，束内等距
const appGroupCount = {};
normed.forEach((n) => {
  if (n.dst.id === 'bb1' || n.dst.id === boardId) return;
  const os = openSideRef(n.dst.id, n.dst.pin);
  if (os.x === 0) return;
  const key = `app:${n.dst.id}:${os.x}`;
  appGroupCount[key] = (appGroupCount[key] || 0) + 1;
});
// 绕板带（底边板脚）同侧线数 + 次序：与 aroundX 同口径判定走哪一侧，
// 按板脚 x 升序排座位（靠左的脚用靠板的柱，绕行横段最短）。
const aroundSideOf = (bxx) => {
  const right = bxx > boardLeft + boardSize.width / 2;
  let dx0 = right ? boardLeft + boardSize.width + 8 : boardLeft - 8;
  if (dx0 > bb.left - 6 && dx0 < bb.left + BB.width + 6) dx0 = boardLeft - 8;
  return dx0 < boardLeft + boardSize.width / 2 ? 'L' : 'R';
};
const bottomRank = new Map();
const bottomSideOf = new Map();
const aroundCount = { L: 0, R: 0 };
{
  const list = [];
  normed.forEach((n, i) => {
    if (n.dst.id !== boardId || !pinIsBottom(n.dst.pin)) return;
    if (famOfConn(n)) return;                       // 电源线走列总线/轨，不占绕板柱
    const pp = pinPos(boardId, n.dst.pin);
    if (!pp) return;
    const side = aroundSideOf(pp.x);
    list.push({ i, side, x: pp.x });
    aroundCount[side]++;
  });
  list.sort((a, b) => a.x - b.x);
  const seen = { L: 0, R: 0 };
  for (const e of list) { bottomRank.set(e.i, seen[e.side]++); bottomSideOf.set(e.i, e.side); }
}
// 绕板柱按需分配（见 bottom 分支）：不能在这里提前预留——
// 直落式（bottomDrop）根本不用绕板柱，预留会白占板侧走廊（U2 实测把落孔柱挤到 336、
// 与离体梯 338 只差 2px）。

const holeXOf = (col) => bb.left + geo.width - (geo.hole.offsetX + (col - 1) * geo.pitch);
const holePosOf = (col, half, letter) => {
  const li = letter.charCodeAt(0) - 97;
  const ox = geo.hole.offsetX + (col - 1) * geo.pitch;
  const oy = geo.hole.offsetY + li * geo.pitch + (half === 'b' ? geo.hole.halfBOffset : 0);
  return { x: bb.left + geo.width - ox, y: bb.top + geo.height - oy };
};

// C9 轨组分块（2026-11-09 用户提供）：正负轨每 5 位一组、组间空 1 列 →
// 中区天然是「5 列一块 + 1 列分隔」（轨位 1-5↔列 2-6，6-10↔8-12，…，实测对齐，
// 分隔列 = 7/13/19/25）。每个电气网独占一块：块内选列，分隔列永远空着 →
// 组间自动分离，不需要靠启发式间距。单网多用列（一排 GND）时块内多列各自由轨跳线供电。
const BLOCK_G = 5;                                  // 块数（半板 30 列 → 5 块）
const blockCols = (g) => { const a = 6 * g - 4; return [a, a + 1, a + 2, a + 3, a + 4]; };
const blockSepCol = (g) => 6 * g + 1;              // 分隔列（保持空）
const blockPick = (targetX, validCol, used, onlyBlock) => {
  // 返回 { g, col }：跳过已占用/含分隔列的块，块内取最贴近目标且合法的列
  let best = null;
  for (let g = 1; g <= BLOCK_G; g++) {
    if (onlyBlock != null && g !== onlyBlock) continue;
    const cols = blockCols(g);
    if (cols.some(c => used.has(c))) continue;
    const ok = cols.filter(c => validCol(c));
    if (!ok.length) continue;
    const cc = ok.reduce((a, b) => Math.abs(holeXOf(b) - targetX) < Math.abs(holeXOf(a) - targetX) ? b : a);
    const dd = Math.abs(holeXOf(cc) - targetX);
    if (!best || dd < best.dd) best = { g, col: cc, dd };
  }
  return best;
};
// C8（2026-11-09 用户手画版标定）：长横段**全部放到面包板面之外的上方自由区**
// （y < bb.top）——bb 面上只留竖直落孔。用户原话："面上一根横线都没有，看得很清楚"；
// 我们此前把横段放在"孔行之间"仍在面上，十几根平行横线 + 孔阵 = 视觉乱。
// 同层按跨度复用（x 不重叠共享一层）。竖落段贴列 x 偏 3-6px：经过同列上方孔是同网，无害。
// ── 统一横段分配器（2026-11-10）────────────────────────────
// 所有长横段（网线走廊、馈电、板脚回环）共用一张占用表：最小间距 9.6px（一个孔距，
// 用户手画实测值），同层按 x 跨度复用。此前三套独立池子互相不避让，
// 实测平行线最小间距只有 0.5-5px（视觉上并线）。
const horizRuns = [];   // [{ y, lo, hi }]
const MIN_SEP = 9.6;
const HORIZ_STEP = 9.6;
// 横段不得压在孔行上（孔行不属于 horizRuns，需单独避让）
const holeRowClash = (y) => {
  // 消费者孔（busHoleOf）+ 全部孔行（a-e, t/b 两半）——馈电孔的 a 行不在 busHoleOf 里
  if (typeof busHoleOf !== "undefined" && busHoleOf && busHoleOf.size) {
    for (const hh of busHoleOf.values()) {
      if (hh && typeof hh.y === "number" && Math.abs(hh.y - y) < 4.4) return true;
    }
  }
  if (typeof holePosOf === "function") {
    for (const half of ["t", "b"]) {
      for (const lt of ["a", "b", "c", "d", "e"]) {
        const hp = holePosOf(1, half, lt);
        if (hp && Math.abs(hp.y - y) < 4.4) return true;
      }
    }
  }
  return false;
};
// 向上（y 减小）搜索第一个可用层：与已有横段在 x 上不重叠且间距 >=9.6，且不穿本体
const allocHorizUp = (y0, lo, hi, opts = {}) => {
  const minY = opts.minY != null ? opts.minY : 0;
  const tries = opts.tries || 26;
  const step = opts.step || HORIZ_STEP;
  const skipRects = opts.skipRects !== false;
  for (let k = 0; k < tries; k++) {
    const cand = r1(y0 - k * step);
    if (cand < minY) break;
    if (holeRowClash(cand)) continue;
    if (skipRects && segHitsRect(lo, cand, hi, cand, null)) continue;
    const clash = horizRuns.some(r2 => Math.abs(r2.y - cand) < MIN_SEP - 0.05
      && hi > r2.lo + 2 && lo < r2.hi - 2);
    if (clash) continue;
    horizRuns.push({ y: cand, lo, hi });
    return cand;
  }
  return r1(y0);   // 兜底（调用方另有 segHitsRect 保护）
};
// 向下搜索（板下走廊用）：语义同 allocHorizUp
const allocHorizDown = (y0, lo, hi, opts = {}) => {
  const tries = opts.tries || 12;
  const skipRects = opts.skipRects !== false;
  for (let k = 0; k < tries; k++) {
    const cand = r1(y0 + k * HORIZ_STEP);
    if (holeRowClash(cand)) continue;
    if (skipRects && segHitsRect(lo, cand, hi, cand, null)) continue;
    const clash = horizRuns.some(r2 => Math.abs(r2.y - cand) < MIN_SEP - 0.05
      && hi > r2.lo + 2 && lo < r2.hi - 2);
    if (clash) continue;
    horizRuns.push({ y: cand, lo, hi });
    return cand;
  }
  return r1(y0);
};
const stageRows = [];   // 兼容旧字段（统计/调试用）
const betweenRowY = (holeY, x1, x2) => {
  const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
  const y = allocHorizUp(r1(bb.top - 14), lo, hi, { step: 14 });
  if (process.env.V2_DBG5) console.log("[dbg5] row", lo.toFixed(0), hi.toFixed(0), "->", y);
  return y;
};
const feedRowY = (ppY, holeY, x1, x2) => {
  const y0 = r1(Math.max(holeY - 4.8, ppY + 6));
  const lo = Math.min(x1 == null ? 0 : x1, x2 == null ? 0 : x2);
  const hi = Math.max(x1 == null ? 0 : x1, x2 == null ? 0 : x2);
  return allocHorizUp(y0, lo, hi, { skipRects: true, tries: 6 });
};

// ── 可读性纪律（C2/C5/C9，2026-11-09 用户手理线样本；layout-rules.md「可读性纪律」）──
// 只在 intent 声明了 routing 计划（zones/relays = 模型已给出分区意图）时启用，
// 未声明时行为与旧版完全一致（U1/U2/N1/U2a 不受影响）。
const colSideRank = {};   // 列×侧 → 已排梳数（贴列排梳用）

// 列序（网→块）：默认「电源网在最左、信号中继按声明序向右」——U3 24 种列序穷举的
// 最优模式（GND,5V,SDA,SCL = 41 交叉；最差 53）。实验可用 V2_NETORDER 覆盖。
const relayNetNames = (intent.routing && Array.isArray(intent.routing.relays))
  ? intent.routing.relays.map(r => r && r.net).filter(Boolean) : [];
const NET_ORDER = ((process.env.V2_NETORDER || '').split(',').map(s => s.trim()).filter(Boolean).length
  ? process.env.V2_NETORDER.split(',').map(s => s.trim()).filter(Boolean)
  : (readability
    // 包裹序（用户 2026-11-10）：左→右 = SCL,SDA,GND,5V——最左板脚（5V）的网落在 bb 最右块，
    // 依次向内包裹。relayNetNames 可能混入电源网，故先剔重、分离信号/电源。
    ? (maxDist === 1
      ? (() => {
        const uniq = [...new Set(relayNetNames)];
        const PWR = ['GND', '5V', '3.3V'];
        const sig = uniq.filter(n => !PWR.includes(n)).reverse();
        const pwr = PWR.filter(n => uniq.includes(n));
        return [...sig, ...pwr];
      })()
      : ['GND', '5V', '3.3V', ...relayNetNames])
    : []));
if (process.env.V2_DBG7) console.log("[dbg7] NET_ORDER", JSON.stringify(NET_ORDER), "| relayNetNames", JSON.stringify(relayNetNames), "| envOrder", JSON.stringify(process.env.V2_NETORDER || null), "| maxDist", maxDist);
const netBlockPref = (net) => {
  if (process.env.V2_WRAP === "0") return null;   // B 版：旧规则（贪心就近选列）
  if (!readability || !NET_ORDER.length) return null;
  const i = NET_ORDER.indexOf(net);
  if (i < 0) return null;
  // 序首 = 最左块，序末 = 最右块（块1）：块号 = N - i，让最后一个网真正落在 bb 最右端
  // 单行（包裹序）：序末=最右块（块1）；多行保持旧映射（5-i，历史调优值）
  return maxDist === 1 ? Math.max(1, NET_ORDER.length - i) : (5 - i);
};
// 顶开放引脚的"横移出带"槽序：同源按引脚 x 降序（右→左）排名（离体槽位与末端形态共用）。
const topOpenRank = new Map();
const modSideOf = {};   // 元件级出线侧（按元件统一，不按引脚半边）
{
  const bySrc = {};
  normed.forEach((n, i) => {
    const os = openSideRef(n.src.id, n.src.pin);
    if (os.x !== 0 || os.y >= 0) return;
    const p = pinPos(n.src.id, n.src.pin);
    if (!p) return;
    (bySrc[n.src.id] = bySrc[n.src.id] || []).push({ i, x: p.x });
  });
  for (const sid of Object.keys(bySrc)) {
    bySrc[sid].sort((a, b) => b.x - a.x);
    bySrc[sid].forEach((e, k) => topOpenRank.set(e.i, k));
  }
}
// 消费者"离体后 x"的近似（C2 判进入侧用）：侧开放=侧向离体；顶开放=横移出带后的 x。
const approachXOf = (i) => {
  const n = normed[i], p = pinPos(n.src.id, n.src.pin);
  if (!p) return null;
  const m = mods.find(x => x.id === n.src.id) || plugs.find(x => x.id === n.src.id);
  if (!m || !pos[n.src.id]) return p.x;
  const os = openSideRef(n.src.id, n.src.pin);
  const rel = p.x - pos[n.src.id].left;
  if (os.x !== 0) {
    const edge = os.x > 0 ? (m.w - rel) : rel;
    return p.x + os.x * (Math.max(14, edge + 14) + sidePhase(n.src.id));
  }
  if (os.y < 0) {
    const dir2 = rel > m.w / 2 ? 1 : -1;
    const k2 = topOpenRank.get(i) || 0;
    return dir2 > 0
      ? pos[n.src.id].left + m.w + 12 + k2 * POST_STEP
      : pos[n.src.id].left - 12 - k2 * POST_STEP;
  }
  return p.x;
};
// C2 孔序：按进入侧分组——左侧来线从低孔起（远源取最低）、右侧来线从高孔起（近源取最高）。
// 两组自两端向中间填，有富余时中间自然留下 1 孔缓冲（两侧不占相邻孔 → 列口端点可区分）。
const assignLetters = (idxs, col, lettersLowToHigh) => {
  const L = lettersLowToHigh;
  const colX = holeXOf(col);
  const lefts = idxs.filter(i => { const x = approachXOf(i); return x != null && x < colX; })
    .sort((a, b) => Math.abs(approachXOf(b) - colX) - Math.abs(approachXOf(a) - colX));   // 远→近
  const rights = idxs.filter(i => { const x = approachXOf(i); return x != null && x >= colX; })
    .sort((a, b) => Math.abs(approachXOf(a) - colX) - Math.abs(approachXOf(b) - colX));   // 近→远
  const out = new Map();
  let lo = 0, hi = L.length - 1;
  for (const i of lefts) { if (lo > hi) break; out.set(i, L[lo++]); }
  for (const i of rights) { if (lo > hi) break; out.set(i, L[hi--]); }
  for (const i of idxs) if (!out.has(i)) {
    const used = new Set(out.values());
    const freeL = L.find(l => !used.has(l));
    if (freeL) out.set(i, freeL);
  }
  return out;
};

// 电源列总线：每族（≥2 个真实电源引脚消费者）选一列"靠近消费者均值"的中部列（8–22），
// 消费者只连到该列的 t 半区孔（横进入孔）；列内最低孔下跳到底轨 / 最高孔上跳到顶轨。
// 板→列由一根"板脚向下 → 横进孔"的馈电线完成；长轨由列跳线供电，不再从板直连长轨。
const busHoleOf = new Map();
const busJumpers = [];
const singleColFeed = new Map();   // fam → { holePin, x, y }（单列即网：馈电与消费者同列，免轨免跳线）
const sigFeeds = [];               // 信号中继馈电（Z5）：{ id, pin, color, col }（板脚→列首孔）
const hubDirectFams = new Set();   // hub 布局：单消费者电源 fam（板脚直连元件）
{
  // hub 布局：单消费者电源网 → 板脚直连元件（不占列/轨），用户手画标定 2026-11-10
  const byFam = {};
  normed.forEach((n, i) => {
    n.fam = famOfConn(n);
    // 归族条件放宽（用户手画标定）：只要**目标**是板电源脚就算该族——S0/S1/S2 这类
    // "地址脚接地"的源引脚不是电源脚，之前被漏掉 → 落到直连轨分支（4 条线各敲一个轨点）。
    // hub 布局放宽归族（S0/S1/S2 等"接地脚"入组）；其余地图保持原条件（实测放宽会破坏基线）
    const famOK = process.env.V2_HUB_PART ? true : !!famOf(n.src.id, n.src.pin);
    if (n.fam && n.dst.id === boardId && famOK) (byFam[n.fam] = byFam[n.fam] || []).push(i);
  });
  const usedCols = new Set();
  const LETTERS = ['a', 'b', 'c', 'd', 'e'];
  // 电源网按**消费者簇**分组（用户手画标定 2026-11-10）：同一 fam 里按消费者的 BFS 行号分簇——
  // mux（d=1）与 rfid（d=2）各占一列：mux 的 GND 就近、rfid 的 GND 单独一组、3.3V 单独一组。
  // 单行布局（U3）所有模块同行 → 每族仍只有一簇，行为不变。
  const famGroups = [];
  // 分组模式：none（历史：每族一列）/ cluster（枢纽布局：按行分簇）/ isolated（实验：每个元件独立成组）  const splitMode = process.env.V2_ISOLATED === "1" ? "isolated" : (process.env.V2_HUB_PART ? "cluster" : "none");  const splitByCluster = splitMode !== "none";
  for (const fam of ['GND', '5V', '3.3V']) {
    const all = (byFam[fam] || []).slice();
    if (process.env.V2_HUB_PART && process.env.V2_ISOLATED !== "1" && all.length === 1) hubDirectFams.add(fam);
    if (!all.length) continue;
    if (!splitByCluster) { famGroups.push({ fam, cluster: 1, idxs: all }); continue; }
    const byCluster = {};
    for (const i2x of all) {
      const key3 = splitMode === "isolated" ? `m:${normed[i2x].src.id}` : (distOf[normed[i2x].src.id] || 1);
      (byCluster[key3] = byCluster[key3] || []).push(i2x);
    }
    for (const dk of Object.keys(byCluster).sort((u, v) => String(u).localeCompare(String(v)))) {
      famGroups.push({ fam, cluster: dk, idxs: byCluster[dk] });
    }
    for (const i2 of all) {
      const d2 = distOf[normed[i2].src.id] || 1;
      (byCluster[d2] = byCluster[d2] || []).push(i2);
    }
    for (const dk of Object.keys(byCluster).sort((u, v) => (+u) - (+v))) {
      famGroups.push({ fam, cluster: +dk, idxs: byCluster[dk] });
    }
  }
  for (const fg of famGroups) {
    const fam = fg.fam;
    const idxs = fg.idxs.slice();
    if (idxs.length < 1) continue;
    // R-按网选基础设施（用户黄金样本 U2-golden-power）：参与者 ≤2（1 馈电 + 1 消费者）
    // → 单列即网：馈电占列首孔、消费者占列尾孔，不经轨、零跳线。列固定 t 半区（贴板侧）。
    const single = idxs.length === 1;
    // 消费者的"离体后 x"估算（单列选位用：列 x ≈ 离体 x → 消费者线纯竖直，用户黄金样本标定：
    // 5V 列 13t(500)→10t(529≈VCC 离体 528)，消掉我们版里 30px 的孔行回折）。
    const escXOf = (i) => {
      const n = normed[i], p = pinPos(n.src.id, n.src.pin);
      if (!p) return null;
      const os = openSideRef(n.src.id, n.src.pin);
      if (os.x === 0) return p.x;
      const m = mods.find(x => x.id === n.src.id) || plugs.find(x => x.id === n.src.id);
      if (!m || !pos[n.src.id]) return p.x;
      const rel = p.x - pos[n.src.id].left;
      const edge = os.x > 0 ? (m.w - rel) : rel;
      const slot = escSlotOf.get(i) || 0;
      return p.x + os.x * (Math.max(14, edge + 14) + sidePhase(n.src.id) + slot * SLOT_STEP);
    };
    const xs = idxs.map(i => (pinPos(normed[i].src.id, normed[i].src.pin) || {}).x).filter(x => x != null);
    const meanX = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : bb.left + BB.width / 2;
    const targetX = single ? (escXOf(idxs[0]) ?? meanX) : meanX;
    // C5 列距（可读性）：同电路多条列之间至少隔 3 空列——每条列有自己的左右走廊，
    // 横段不再扫过邻列的孔行（用户样本："组和组过于局促紧挨"）。仅声明 routing 时启用；
    // 无满足列时退回无间距约束的最近列。
    const gapOK = (c) => [...usedCols].every(u => Math.abs(u - c) >= 3);   // 族间距 ≥3 列（无条件；用户标定 GND/3.3V 相邻列太挤）
    const cands = [];
    for (let c = 8; c <= 22; c++) {
      if (usedCols.has(c)) continue;
      if (!gapOK(c)) continue;   // 无条件：族间距（用户标定 GND/3.3V 相邻列太挤）
      cands.push({ c, dd: Math.abs(holeXOf(c) - targetX) });
    }
    if (!cands.length) {
      for (let c = 8; c <= 22; c++) {
        if (!usedCols.has(c)) cands.push({ c, dd: Math.abs(holeXOf(c) - targetX) });
      }
    }
    cands.sort((a, b) => a.dd - b.dd);
    const busD = Math.min(...idxs.map(i => distOf[normed[i].src.id] || 1));
    const validCol = (c) => {
      // 列 x 不得落在更低行模块的 x 带内：落孔竖段会从该模块本体穿过
      // （实测 rfid3:3.3V→21b.h 在 mux 的 x 带内下钻 152px 穿件）。
      const cx0 = holeXOf(c);
      for (const m of mods) {
        if ((distOf[m.id] || 1) >= busD) continue;
        const mp = pos[m.id];
        if (!mp) continue;
        if (cx0 > mp.left - 14 && cx0 < mp.left + m.w + 14) return false;
      }
      return idxs.every(i => {
        const ex = escXOf(i);
        // 多消费者：列离离体 x ≥15（防意外贴近产生 <12px 碎弯）。
        // 单列即网：**故意**把列对准消费者的离体 x（纯竖直落孔，用户黄金样本形态），
        // 只需 ≥2px 防完全共线。
        return ex == null || Math.abs(ex - holeXOf(c)) >= (single ? 2 : 15);
      });
    };
    let col = null, usedBlock = null;
    if (readability) {
      // C9 轨组分块：每个 net 独占一块（分隔列 7/13/19/25 永久空置 → 组间自动分离）
      // 列序实验：netBlockPref 指定的块优先，失败退回就近分配
      const prefG = netBlockPref(fam);
      // 等距列位（用户 2026-11-10）：单行包裹序下，列固定取**块内同一相对位**（默认居中），
      // 组间因此严格等距（57.6px = 6 列）。此前取"最贴近目标的列"→ 间隔 57/39/57 不均。
      if (readability && maxDist === 1 && prefG != null && process.env.V2_WRAP !== "0") {
        const bcF = blockCols(prefG);
        if (!bcF.some(c => usedCols.has(c))) {
          const okF = bcF.filter(c => validCol(c));
          if (okF.length) {
            const bpF = (process.env.V2_BLOCKPOS || 'C').toUpperCase();
            const wantF = bpF === 'L' ? bcF[0] : bpF === 'R' ? bcF[bcF.length - 1] : bcF[2];
            col = okF.includes(wantF) ? wantF : okF[0];
            usedBlock = prefG;
          }
        }
      }
      let bpick = col != null ? null : (prefG != null ? blockPick(targetX, validCol, usedCols, prefG) : null);
      if (col == null && !bpick) bpick = blockPick(targetX, validCol, usedCols);
      if (col == null && bpick) { col = bpick.col; usedBlock = bpick.g; }
      // B 簇分配（贪心）：在候选块里按"本网走线总长 + 60×与已画网竖落的交叉"取最优。
      // 已画的竖落 = 已占用列（每列一根竖落）。就近成簇 + 避开已画组（用户画线顺序的规则化）。
      // 包裹序优先（用户 2026-11-10）：pref 块可用时直接采纳，跳过贪心——
      // 外缘包裹内缘是形态要求，不是最优问题（贪心会把它覆盖掉）。
      if (readability && col != null && usedBlock == null && prefG != null) {
        const bcP = blockCols(prefG);
        const okP = bcP.filter(c => validCol(c));
        if (!bcP.some(c => usedCols.has(c)) && okP.length) {
          const bpP = (process.env.V2_BLOCKPOS || 'C').toUpperCase();
          const wantP = bpP === 'L' ? bcP[0] : bpP === 'R' ? bcP[bcP.length - 1] : bcP[2];
          col = okP.includes(wantP) ? wantP : okP[0];
          usedBlock = prefG;
        }
      }
      if (readability && col != null && prefG == null && maxDist === 1 && process.env.V2_WRAP !== "0") {   // 包裹序只对单行布局生效
        const costOf = (c) => {
          const cx = holeXOf(c);
          let len = 0, cross = 0;
          for (const i of idxs) {
            const p = pinPos(normed[i].src.id, normed[i].src.pin);
            if (!p) continue;
            len += Math.abs(p.x - cx) + 0.5 * Math.abs(p.y - bb.top);
            for (const u of usedCols) {
              const ux = holeXOf(u);
              if (ux > Math.min(p.x, cx) + 6 && ux < Math.max(p.x, cx) - 6) cross++;
            }
          }
          return len + 60 * cross;
        };
        const candsB = [];
        for (let g = 1; g <= BLOCK_G; g++) {
          const cols = blockCols(g);
          if (cols.some(c => usedCols.has(c))) continue;
          const ok = cols.filter(c => validCol(c));
          if (!ok.length) continue;
          const cc = ok.reduce((a, b) => Math.abs(holeXOf(b) - targetX) < Math.abs(holeXOf(a) - targetX) ? b : a);
          candsB.push({ g, c: cc, cost: costOf(cc) });
        }
        if (candsB.length) {
          candsB.sort((a, b) => a.cost - b.cost);
          const g0 = candsB[0].g;
          const bc0 = blockCols(g0);
          const bp0 = (process.env.V2_BLOCKPOS || 'C').toUpperCase();
          const want0 = bp0 === 'L' ? bc0[0] : bp0 === 'R' ? bc0[bc0.length - 1] : bc0[2];
          col = validCol(want0) ? want0 : candsB[0].c;
          usedBlock = g0;
        }
      }
    }
    // 兜底（隔离模式实测：分组数 > 5 个块时块池耗尽 → cands 为空会崩）：
    // 退化为"任意空闲列，且与已用列 ≥3 列距离"；仍无则共用 30 列并告警。
    if (!cands.length) {
      for (let c2 = 1; c2 <= 30; c2++) {
        if (usedCols.has(c2)) continue;
        if ([...usedCols].some(u => Math.abs(u - c2) < 3)) continue;
        if (typeof validCol === "function" && !validCol(c2)) continue;
        cands.push({ c: c2, ok: true });
      }
      if (!cands.length) { console.log("[WARN] 列位耗尽：该族退回共用 30 列"); cands.push({ c: 30, ok: true }); }
    }
    if (col == null) col = (cands.find(x => x.ok) || cands[0] || { c: 30 }).c;
    usedCols.add(col);
    if (usedBlock != null) blockCols(usedBlock).forEach(c => usedCols.add(c));   // 整块占用（块间有分隔列）
    if (usedBlock != null) console.log(`[INFO] 轨道分组: ${fam} → 块 ${usedBlock}（列 ${col}，分隔列 ${blockSepCol(usedBlock)} 空置）`);
    idxs.sort((i, j) => {
      const pi = pinPos(normed[i].src.id, normed[i].src.pin) || { y: 0 };
      const pj = pinPos(normed[j].src.id, normed[j].src.pin) || { y: 0 };
      return pj.y - pi.y;                                  // 下面的引脚 → 下面的孔
    });
    // 列半区跟目标轨走：下缘轨(tn/tp, rot180 后在板下方) → t 半区（贴轨，跳线短）；
    // 上缘轨(bp, 在板上方) → b 半区（f-j 孔）。单列即网固定 t 半区（贴板侧，馈电从下方进）。
    // hub 布局 + 5V 已直连（tp 空闲）→ 3.3V 用 tp：t 半区列 + 单根轨跳线，免同极双轨桥。
    const rail0 = (process.env.V2_HUB_PART && fam === '3.3V' && hubDirectFams.has('5V')) ? 'tp' : railOf(fam);
    const railAtBottom = single ? true : railY(rail0) > bb.top + BB.height / 2;
    const half = railAtBottom ? 't' : 'b';
    const LO = railAtBottom ? ['a', 'b', 'c', 'd', 'e'] : ['f', 'g', 'h', 'i', 'j'];
    if (single) {
      // 单消费者电源直连（用户手画标定 2026-11-10）：该网只有一个消费者（如 mux 的 5V）时，
      // 不必占面包板列/轨——板脚直接直角连到元件引脚。hub 布局下启用。
      if (process.env.V2_HUB_PART) {
        console.log(`[INFO] 电源直连: ${fam} 单消费者 → 不走列/轨，板脚直接连元件`);
        continue;
      }
      // 单列即网：消费者占列尾孔（e），馈电占列首孔（a）——同列内部连通，免轨免跳线。
      const i0 = idxs[0];
      const hp = holePosOf(col, 't', 'e');
      busHoleOf.set(i0, { pin: `bb1:${col}t.e`, x: hp.x, y: hp.y, fam, col, letter: 'e', k: 0 });
      const fp = holePosOf(col, 't', 'a');
      singleColFeed.set(fam, { holePin: `bb1:${col}t.a`, x: fp.x, y: fp.y, col, letter: 'a' });
      console.log(`[INFO] 单列即网: ${fam} → 列 ${col}t（馈电 a + 消费者 e，免轨免跳线）`);
      continue;
    }
    // 跳线孔必须**预留**：下缘轨列保留最靠近轨的 LO[0]（t 半区的 a，屏幕最低），
    // 上缘轨列保留最靠近轨的 LO 末位（b 半区的 j）。消费者只分其余孔——
    // 此前跳线与消费者都从 a 开始分配，出现"元件线和轨跳线插同一个孔"（物理不可能）。
    const jumpLetter = railAtBottom ? LO[0] : LO[LO.length - 1];
    const free = railAtBottom ? LO.slice(1) : LO.slice(0, -1);
    const onBus = idxs.slice(0, free.length);
    // C2 孔序（可读性）：按进入侧分组（左起低孔/右起高孔/中间留缓冲），否则按引脚 y 降序。
    const letterMap = readability
      ? assignLetters(onBus, col, free)
      : new Map(onBus.map((i, k) => [i, free[k]]));
    onBus.forEach((i) => {
      const lt = letterMap.get(i) || free[0];
      const hp = holePosOf(col, half, lt);
      busHoleOf.set(i, {
        pin: `bb1:${col}${half}.${lt}`, x: hp.x, y: hp.y,
        fam, col, letter: lt, k: free.indexOf(lt) >= 0 ? free.indexOf(lt) : 0,
      });
    });
    idxs.slice(free.length).forEach(i => { normed[i].busExtra = true; });
    const rail = rail0;
    const jp = holePosOf(col, half, jumpLetter);
    // 选轨位：**最近的轨位**（允许孔列左侧 ≤4px）——轨位 x ≈ 列 x → 跳线几乎是纯竖线
    // （用户黄金样本标定：bp.17(425.6)≈21b 列(423.4)、tn.18(416)≈22t 列(413.8)，跳线仅 29px）。
    // 旧规则"必须右移 ≥20"会把轨位推到 30px 外，跳线被迫绕横段；馈电在轨端部(n=25)，
    // 与近列轨位不冲突。
    let n = null, best = Infinity, fallback = null, fbest = Infinity;
    for (let nn = 1; nn <= geo.rail.maxPosition; nn++) {
      if (railNUsed.has(nn)) continue;
      const rx = railX(nn);
      if (blockedBelow(rx, 1)) continue;
      const dd = Math.abs(rx - jp.x) + (rx < jp.x - 4 ? 500 : 0);   // 左侧仅容 4px 微差
      if (dd < fbest) { fbest = dd; fallback = nn; }
      if (rx > jp.x + 20 && Math.abs(rx - jp.x) < best) { best = Math.abs(rx - jp.x); n = nn; }
    }
    if (n == null || fbest < best) n = fallback != null ? fallback : pickRailClear(rail, jp.x, 1);
    railUsed[rail].add(n); railNUsed.add(n);
    busJumpers.push({
      fam, rail, n, railAtBottom,
      holePin: `bb1:${col}${half}.${jumpLetter}`, hole: jp,
      railX: railX(n), railY: railY(rail),
    });
  }
  // ── 信号中继列（routing.relays 声明的非电源网，Z5）：列=稀缺脚的虚拟引脚 ──
  // 电源网已有列总线机制；这里处理声明的信号扇出（如 I2C SDA/SCL 一脚挂多元件）：
  // 源（板脚）合成馈电线 → 列首孔 a；消费者改接同列 b-e 孔 → 走既有 bus 机制（直落/车道/柱）。
  // 不经轨（Z2）。每列 t 半区 5 孔 = 1 馈电 + 最多 4 消费者。
  if (intent.routing && Array.isArray(intent.routing.relays)) {
    let sigN = 0;   // 信号中继序号 → 入口 y 错位（跨网同字母孔防共线）
    for (const r of intent.routing.relays) {
      if (!r || !r.source || !Array.isArray(r.consumers) || r.consumers.length < 2
        || r.consumers.length > 4) continue;
      const srcRef = String(r.source);
      const idxs = [];
      normed.forEach((n, i) => {
        const ends = [`${n.src.id}:${n.src.pin}`, `${n.dst.id}:${n.dst.pin}`];
        if (!ends.includes(srcRef)) return;
        const other = ends.find(e => e !== srcRef);
        if ((r.consumers || []).includes(other) && !famOfConn(n)) idxs.push(i);
      });
      if (idxs.length < 2) continue;
      // 选列：空闲列中离消费者引脚均值 x 最近；列 x 不落在更低行模块带内
      const xs2 = idxs.map(i => (pinPos(normed[i].src.id, normed[i].src.pin) || {}).x).filter(x => x != null);
      const meanX2 = xs2.length ? xs2.reduce((a, b) => a + b, 0) / xs2.length : bb.left + BB.width / 2;
      const busD2 = Math.min(...idxs.map(i => distOf[normed[i].src.id] || 1));
      const ok = (c) => {
        const cx0 = holeXOf(c);
        for (const m of mods) {
          if ((distOf[m.id] || 1) >= busD2) continue;
          const mp = pos[m.id];
          if (mp && cx0 > mp.left - 14 && cx0 < mp.left + m.w + 14) return false;
        }
        return true;
      };
      // C9 轨组分块（readability）：net 独占一块；否则列距 ≥3 的最近列
      const cand = [];
      if (readability) {
        const okB = (c) => {
          const cx0 = holeXOf(c);
          for (const m of mods) {
            if ((distOf[m.id] || 1) >= busD2) continue;
            const mp = pos[m.id];
            if (mp && cx0 > mp.left - 14 && cx0 < mp.left + m.w + 14) return false;
          }
          return true;
        };
        const prefG2 = netBlockPref(r.net);
        let bpick = prefG2 != null ? (() => {
          const cols = blockCols(prefG2);
          if (cols.some(c => usedCols.has(c))) return null;
          const ok = cols.filter(c => okB(c));
          if (!ok.length) return null;
          const cc = ok.reduce((a, b) => Math.abs(holeXOf(b) - meanX2) < Math.abs(holeXOf(a) - meanX2) ? b : a);
          return { g: prefG2, c: cc, dd: 0 };
        })() : null;
        for (let g = 1; g <= BLOCK_G && !bpick; g++) {
          const cols = blockCols(g);
          if (cols.some(c => usedCols.has(c))) continue;
          const ok = cols.filter(c => okB(c));
          if (!ok.length) continue;
          const cc = ok.reduce((a, b) => Math.abs(holeXOf(b) - meanX2) < Math.abs(holeXOf(a) - meanX2) ? b : a);
          const dd = Math.abs(holeXOf(cc) - meanX2);
          if (!bpick || dd < bpick.dd) bpick = { g, c: cc, dd };
        }
        if (bpick) {
          const bc2 = blockCols(bpick.g);
          const bp2 = (process.env.V2_BLOCKPOS || 'C').toUpperCase();
          const want2 = bp2 === 'L' ? bc2[0] : bp2 === 'R' ? bc2[bc2.length - 1] : bc2[2];
          if (okB(want2)) bpick.c = want2;
          blockCols(bpick.g).forEach(c => usedCols.add(c));
          cand.push({ c: bpick.c, dd: 0 });
          console.log(`[INFO] 轨道分组: ${r.net} → 块 ${bpick.g}（列 ${bpick.c}，分隔列 ${blockSepCol(bpick.g)} 空置）`);
        }
      }
      if (!cand.length) {
        for (let c = 8; c <= 22; c++) {
          if (usedCols.has(c) || !ok(c)) continue;
          if (readability && ![...usedCols].every(u => Math.abs(u - c) >= 3)) continue;
          cand.push({ c, dd: Math.abs(holeXOf(c) - meanX2) });
        }
      }
      if (!cand.length) {
        for (let c = 8; c <= 22; c++) if (!usedCols.has(c) && ok(c)) cand.push({ c, dd: Math.abs(holeXOf(c) - meanX2) });
      }
      if (!cand.length) { console.log(`[INFO] 信号中继 ${r.net}: 无空闲列，跳过（保持直连）`); continue; }
      cand.sort((a, b) => a.dd - b.dd);
      const col2 = cand[0].c;
      usedCols.add(col2);
      // C2 孔序（可读性）：按进入侧分组；否则按引脚 y 降序（下面的引脚 → 下面的孔）
      idxs.sort((i, j) => {
        const pi = pinPos(normed[i].src.id, normed[i].src.pin) || { y: 0 };
        const pj = pinPos(normed[j].src.id, normed[j].src.pin) || { y: 0 };
        return pj.y - pi.y;
      });
      const SIG_LETTERS = ['b', 'c', 'd', 'e'];
      const yOff = r1(sigN * 2.4);
      const sigMap = readability
        ? assignLetters(idxs, col2, SIG_LETTERS)
        : new Map(idxs.map((i, k) => [i, SIG_LETTERS[k]]));
      idxs.forEach((i) => {
        const lt = sigMap.get(i) || SIG_LETTERS[0];
        const hp = holePosOf(col2, 't', lt);
        busHoleOf.set(i, { pin: `bb1:${col2}t.${lt}`, x: hp.x, y: hp.y, fam: null, col: col2, letter: lt, k: SIG_LETTERS.indexOf(lt), yOff });
      });
      sigN++;
      const [sid, spin] = srcRef.split(':');
      sigFeeds.push({ id: sid, pin: spin, color: r.color || normed[idxs[0]].color || 'green', col: col2, net: r.net });
      console.log(`[INFO] 信号中继列: ${r.net} → 列 ${col2}t（源 ${srcRef} → a，消费者 ${idxs.length} → b-${SIG_LETTERS[idxs.length - 1]}）`);
    }
  }
}

// 同一条板脚上多条线（如 mux:S0/S1/S2 → uno:GND.2）汇合时，进脚前的横段由 regHorizY 逐条错开。
// 同列总线消费者数：转角柱按整梯预留
const busColCount = {};
for (const [, h] of busHoleOf) busColCount[h.col] = (busColCount[h.col] || 0) + 1;

// （partRects / segHitsRect 已在第 4 节定义，供转角柱与直落式共用）

// ── 6 预-2：通道规划（转角柱全局预分配）──────────────────────
// 顺序即优先级：绕板柱（上面已分配，贴板）→ 进脚柱（贴目标件）→ 离体槽（贴源件）
// → 落孔柱（在板与面包板之间自由挑位，最后分配、避让已有柱子）。
// 逐线走线阶段只查表，不再现场抢 x —— 1-2px 碎间距的根因就是"谁先算谁占位"。
const escPlan = new Map();     // idx → { x, w, baseX, key, dy }
const escEst = new Map();      // idx → 离体槽预估（窗口/槽序），等柱位定完再落位
const appPlan = new Map();     // idx → { x, w }
const busPlan = new Map();     // idx → { x, entryY }

for (const [i, n] of normed.entries()) {
  const { src, dst } = n;
  const a = pinPos(src.id, src.pin), b = pinPos(dst.id, dst.pin);
  if (!a || !b) continue;
  // ① 进脚柱：贴在目标元件开放侧外，按引脚序等距
  if (dst.id !== 'bb1' && dst.id !== boardId) {
    const mT = mods.find(m => m.id === dst.id) || plugs.find(m => m.id === dst.id);
    const oT = openSideRef(dst.id, dst.pin);
    if (mT && pos[dst.id] && oT.x !== 0) {
      const rel = b.x - pos[dst.id].left;
      const edge = oT.x > 0 ? (mT.w - rel) : rel;
      const slot = appSlotOf.get(i) || 0;
      const dir = oT.x;
      const key = `app:${dst.id}:${dir}`;
      const cnt = Math.max(appGroupCount[key] || 1, slot + 1);
      const base = Math.max(14, edge + 14) + sidePhase(dst.id);   // slot 0 的离体距离
      const lo = dir > 0 ? pos[dst.id].left + mT.w + 6 : -Infinity;
      const hi = dir > 0 ? Infinity : pos[dst.id].left - 6;
      let x = turnPost(key, slot, {
        prefer: r1(b.x + dir * base), dir, step: POST_STEP, count: cnt, lo, hi,
        y1: b.y - 340, y2: b.y + 40,
      });
      // 柱竖段不得穿本体（T3：板与 mux 同排，板带会吞掉梯子下半段）——
      // turnPost 只查柱/轨占用，不查本体；撞带则**双向**找带外空柱（保持 14 网格；
      // 单向搜会掉进"左边还是板带"的死角——实测 rfid1:SDA 柱 266 往左 14 步全在带内）。
      if (segHitsRect(x, b.y - 340, b.y + 40, null)) {
        outer:
        for (let k = 1; k <= 16; k++) {
          for (const s of [k, -k]) {
            const c = r1(x + s * POST_STEP);
            if (!segHitsRect(c, b.y - 340, b.y + 40, null)
              && !postXs.some(u => Math.abs(u - c) < POST_CLEAR)) {
              x = takePost(c, b.y - 340, b.y + 40);
              break outer;
            }
          }
        }
      }
      appPlan.set(i, { x, w: `h${r1(-(x - b.x))}` });
    } else if (mT && pos[dst.id] && oT.y !== 0) {
      appPlan.set(i, { dy: r1(oT.y * 14), w: `v${r1(-oT.y * 14)}` });
    }
  }
  // ② 离体槽：先只估"离体后的 x"（供落孔柱判遮挡），等柱位定完再落槽
  const mSrc = mods.find(m => m.id === src.id) || plugs.find(m => m.id === src.id);
  const osS = openSideRef(src.id, src.pin);
  if (mSrc && pos[src.id] && osS.x !== 0) {
    const rel = a.x - pos[src.id].left;
    const edge = osS.x > 0 ? (mSrc.w - rel) : rel;
    const slot = escSlotOf.get(i) || 0;
    let dir = osS.x;
    // 出线侧覆盖（实验开关，用户 2026-11-12 提议）：V2_SIDE="rtc1:1,mpu1:-1"
    // 动机：RTC 引脚固定在左缘 → 只能挤进 mpu↔rtc 那条缝，而 rtc↔oled 缝完全空着。
    // 让它先左出、再绕到右侧，就能用上那条空缝（物理特例的人工解法）。
    {
      const ov = String(process.env.V2_SIDE || "").split(",").map(s => s.trim()).filter(Boolean);
      for (const kv of ov) {
        const mm = /^(.+):([-+]1)$/.exec(kv);
        if (mm && mm[1] === src.id) dir = +mm[2];
      }
    }
    const a0x = a.x;
    const key = `${src.id}:${dir}`;
    const cnt = Math.max(srcGroupCount[key] || 1, slot + 1);
    const base = Math.max(14, edge + 14) + sidePhase(src.id);
    // 可用窗口上限 = 同排邻件边缘外 8px。撞到邻件时整梯压缩（绝不塌成同一 x）。
    let maxDist = Infinity;
    for (const m of mods) {
      if (m.id === src.id) continue;
      const mp = pos[m.id];
      if (!mp) continue;
      if (!(a.y >= mp.top - 2 && a.y <= mp.top + m.h + 2)) continue;
      const l = mp.left - 8, r = mp.left + m.w + 8;
      if (dir > 0 && a0x + base + (cnt - 1) * SLOT_STEP > l && a0x < r) maxDist = Math.min(maxDist, l - a0x);
      if (dir < 0 && a0x - base - (cnt - 1) * SLOT_STEP < r && a0x > l) maxDist = Math.min(maxDist, a0x - r);
    }
    maxDist = Math.max(6, maxDist);
    escEst.set(i, { a0x, dir, base, maxDist, cnt, slot, key, y1: Math.min(a.y, b.y) - 40, y2: Math.max(a.y, b.y) + 40 });
    T(i, { escRule: "escEst", dir, key, slot, base: r1(base) });
  } else if (mSrc && osS.y < 0) {
    escPlan.set(i, { dy: -14, w: 'v-14', key: `${src.id}:0` });
  }
} 
// 直落式入孔的孔面横扫上限：只限**左源**（ax < 孔 x）——它的横扫会穿过柱走廊
// （实测 rfid1 在孔行 y 上扫会撞柱梯）。右源的横扫段在孔右侧、那里没有别的竖段，
// 不限（实测把 rfid3 赶进车道/柱体系反而制造 12 处反向嵌套交叉：53→58）。
// 单行电路（U1/N1 型）完全不限，保持旧行为（实测收紧误伤：U1 转弯 2.00→2.42）。
const faceRunLimit = maxDist >= 2 ? 120 : Infinity;
// ③ 落孔柱（全局柱梯）：只有"被挡住或距离超限、走 5 段"的电源消费者才需要柱。
// 【全局一根梯】按"源离体 x 升序"排座：左源 → 左柱 + 深车道，右源 → 右柱 + 浅车道
// （嵌套扇入，ref2 的阶梯形态；per-family 分梯会出现"左源右柱"的反向嵌套 → 自相交叉，
// 且柱位必须与 emit 分支的直落判定同口径，否则柱落不到梯上、被兜底推到孔边）。
{
  const needs = [];
  for (const [i, n] of normed.entries()) {
    if (!busHoleOf.has(i)) continue;
    const src = n.src;
    const a0 = pinPos(src.id, src.pin);
    if (!a0) continue;
    const ep = escEst.get(i);
    // 用**含 slot 的实际离体估算**排序（slot 越深 → 离体越靠外 → 柱越靠左 = 深车道↔左柱，
    // 用户黄金样本标定：GND 深车道 275 ↔ 柱 278.4，3.3V 浅车道 259 ↔ 柱 294，单调）。
    // 之前用 slot0 估值 → 同源两线 ax 相同、按列号 tie-break → 深车道拿到右柱 → 自相交叉。
    const ax = ep ? r1(ep.a0x + ep.dir * (ep.base + (ep.slot || 0) * SLOT_STEP)) : a0.x;
    const dSrc = distOf[src.id] || 1;
    const hole = busHoleOf.get(i);
    if (!blockedBelow(ax, dSrc) && (ax > hole.x || Math.abs(ax - hole.x) <= faceRunLimit)) continue;   // 会走直落 → 不占柱
    const fam = n.fam;
    needs.push({
      i, ax, dSrc, hole, fam,
      entryY: r1(hole.y + (fam === 'GND' ? -0.6 : fam === '5V' ? 0.6 : -1.6)),
    });
  }
  needs.sort((p, q) => p.ax - q.ax || p.hole.col - q.hole.col);
  const boardR = boardLeft + boardSize.width;
  // 总线柱的空位判定：柱↔柱 6px、不穿本体（本体带额外 4px 余量——贴边柱的竖段
  // 在裁判的 2px 口径下仍算穿件，实测柱 392 贴 mux 右缘 394 被记 122px 穿件）；轨道桩只做 0.5px 级避让。
  const busPostFree = (x, y1, y2) => !postXs.some(u => Math.abs(u - x) < POST_CLEAR)
    && !hasVert(x)
    && !partRects.some(p => x > p.l - 4 && x < p.r + 4 && Math.min(y2, p.b) - Math.max(y1, p.t) > 0.5);
  let baseX = Math.round((boardR + 20) / POST_STEP) * POST_STEP;   // 柱梯基点：板右走廊
  for (const nd of needs) {
    let x = null;
    for (let k = 0; k <= 12 && x == null; k++) {                    // 沿开放方向找空柱（整梯步进 14）
      const cand = r1(baseX + (nd.ax <= nd.hole.x ? k * POST_STEP : -k * POST_STEP));
      if (cand <= boardR + 8 || cand >= nd.hole.x - 10) continue;
      if (busPostFree(cand, laneBase(nd.dSrc) - 20, nd.entryY + 20)) x = cand;
    }
    if (x == null) x = regVert(r1(nd.hole.x - 16), -1);
    takePost(x, laneBase(nd.dSrc) - 20, nd.entryY + 20);
    busPlan.set(nd.i, { x, entryY: nd.entryY });
  }
}
// ④ 离体槽落位（最后分配：柱子已定，槽位避让现有柱，整梯微移但保持等距）
for (const [i, ep] of escEst) {
  const x = escPost(ep.key, ep.slot, ep.a0x, ep.dir, ep.base, ep.maxDist, ep.cnt, ep.y1, ep.y2);
  escPlan.set(i, { x, w: `h${r1(x - ep.a0x)}`, baseX: r1(ep.a0x + ep.dir * ep.base), key: ep.key });
}

// 顶开放引脚的"横移出带"槽序统一用 topOpenRank（§8 前构建：同源按引脚 x 降序，
// 右引脚浅槽、左引脚深槽——左线长横段从右线离体竖段上方跨过）；此处不再重复建表。
// ── 画线顺序（用户标定：一类一类画——先电源类，再信号类；同类内按引脚 y 从上到下）──
// 顺序决定车道/横段层的分配次序：同类线连续占层 → 每类横段落在自己的连续带里（整齐）。
const netGroupRank = (i) => {
  const n = normed[i];
  if (n.fam === 'GND') return 0;
  if (n.fam === '5V') return 1;
  if (n.fam === '3.3V') return 2;
  const ends = [`${n.src.id}:${n.src.pin}`, `${n.dst.id}:${n.dst.pin}`];
  const rIdx = (intent.routing && Array.isArray(intent.routing.relays) ? intent.routing.relays : [])
    .findIndex(r => r && (ends.includes(String(r.source)) || (r.consumers || []).some(cu => ends.includes(String(cu)))));
  return rIdx >= 0 ? 3 + rIdx : 90;
};
// 落段排梳序（用户标定 2026-11-10）：按**离列距离**降序——最远的源拿最外侧（最左）落段，
// 最近的源贴列。此前按引脚 y 处理序排，导致远源落在近源内侧（DS 的拐角把 MPU 包进去）。
const sideRankOf = new Map();   // idx → { k, n }
{
  const groups = {};
  for (const [q, hole] of busHoleOf) {
    const n0 = normed[q];
    const pp = pinPos(n0.src.id, n0.src.pin);
    if (!pp) continue;
    // 只按列分组：侧由图内计划循环的"离体后 x"决定，预计算只有引脚 x，两者可能不同侧
    // （实测 rtc1:GND 引脚在列右、离体后走列左）。
    const key = String(hole.col);
    (groups[key] = groups[key] || []).push({ q, d: Math.abs(pp.x - hole.x) });
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((u, v) => v.d - u.d);          // 最远在前
    groups[key].forEach((e, k) => sideRankOf.set(e.q, { k, n: groups[key].length }));
  }
  if (process.env.V2_DBG4) console.log('[dbg4] busHoleOf', busHoleOf.size, 'sideRankOf', sideRankOf.size,
    '| groups', JSON.stringify(Object.fromEntries(Object.entries(groups).map(([kk2, v]) => [kk2, v.map(e => e.q + '@' + Math.round(e.d))]))));
}
const planOrder = connList.map((c, i) => i).sort((a, b) => {
  const ga = netGroupRank(a), gb = netGroupRank(b);
  if (ga !== gb) return ga - gb;
  const pa = pinPos(normed[a].src.id, normed[a].src.pin) || { y: 0 };
  const pb = pinPos(normed[b].src.id, normed[b].src.pin) || { y: 0 };
  return pa.y - pb.y;                                   // 上面引脚先画
});
for (const idx of planOrder) {
  const c = connList[idx];
  const n0 = normed[idx];
  const { fRef, tRef, swap, src, dst } = n0;
  const a = pinPos(src.id, src.pin), b = pinPos(dst.id, dst.pin);
  if (!a || !b) { console.log(`  [跳过] ${fRef} → ${tRef}：引脚坐标缺失`); continue; }
  const srcId = swap ? tRef : fRef;
  const dSrc = distOf[src.id] || 1;
  const pinY0 = a.y;
  const pinX0 = a.x;              // 原始引脚 x（离体前，供"并段"判定）

  // ── 离体/进脚：坐标与槽位来自上面的通道规划（转角柱全局预分配）──
  let escW = null, escW2 = null, appW = null, escBaseX = null, escGroup = null;
  {
    const ep = escPlan.get(idx);
    if (ep) {
      if (ep.dy != null) {
        escW = ep.w; a.y = r1(a.y + ep.dy);
        // 【顶开放引脚的长下钻】离体向上后，下钻竖段仍在原引脚 x 上 → 穿过自身本体
        // （实测 mpu6050 顶边引脚：离体 14px 后竖降 475px 穿本体 61px）。侧开放引脚
        // 的离体 x 天然在体外、从不触发。修法：离体后横移到本体 x 带外再下钻，
        // 同源多线按 14px 槽错开（竖段防共线）。
        if (busHoleOf.has(idx)) {
          const mS = mods.find(m => m.id === src.id) || plugs.find(m => m.id === src.id);
          if (mS && pos[src.id]) {
            // 出线侧**按元件统一**（不是按引脚各自半边）——否则同一元件的线会左右分家
            // （用户标定：oled 的 4 根线应该走同一侧，形成一条束）。
            // 出线侧按「元件 × 目标类别」分束（用户 2026-11-10：rfid→mux 一束、rfid→bb 一束）：
            // 同一元件如果所有线走同一侧，电源线会横穿信号束的竖线（实测 hub19 rfid→mux × rfid→bb 12 处）。
            // 规则：bb 目标（孔/轨/列）→ 朝**目标一侧**离体；模块/板脚目标 → 按引脚均值侧（成束）。
            // 出线侧 = **朝目标**（用户 2026-11-12 提出 + trace 实测）：
            // 旧规则按"引脚均值靠左/右"定侧 → oled（引脚在右缘、目标孔全在左边）被送到右侧，
            // 白绕一大圈且把 mpu↔rtc 那条缝挤满（8 根）、rtc↔oled 那条空着（0 根）。
            // 新规则：比较"目标 x 均值"与"引脚 x 均值"，朝目标一侧出线。
            // 出线侧按元件统一（用户标定：oled 的 4 根线走同一侧成束）。
            // 【实测 2026-11-12】改成"朝目标出线"（oled→左、用 rtc↔oled 空缝）会更差：
            // 交叉 38→48 —— 外侧绕行虽长但完全不碰内部束；内侧会与 rtc/mpu 相互切割。
            // 故保留"按引脚均值定侧"，并在 layout-analysis 记录该反例。
            const sideOfMod = (mId) => {
              if (modSideOf[mId] != null) return modSideOf[mId];
              const ms = mods.find(x => x.id === mId) || plugs.find(x => x.id === mId);
              const ps = normed.filter(n => n.src.id === mId && pinPos(mId, n.src.pin))
                .map(n => pinPos(mId, n.src.pin).x - pos[mId].left);
              const meanRel = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : ms.w / 2;
              modSideOf[mId] = meanRel > ms.w / 2 ? 1 : -1;
              return modSideOf[mId];
            };
            // 电源/接地类目标（bb 孔，或板脚电源脚）→ 朝目标侧离体（与信号束分开）
            const dir2 = sideOfMod(src.id);
            T(idx, { escRule: "topOpen", dir2 });
            const k2 = topOpenRank.get(idx) || 0;
            // 离体 x 要避让已有竖段（不同元件的离体会巧合落到 0.3px 内 → 共线，实测 201px）
            const sideX = regVert(r1(dir2 > 0 ? pos[src.id].left + mS.w + 12 + k2 * POST_STEP
                                            : pos[src.id].left - 12 - k2 * POST_STEP), dir2);
            const dyStep = r1(10 + k2 * 12);   // 顶部引脚出线分层：10+12k——基础抬高 10px，避免与侧出线元件的引脚 y 横段共线（实测 mpu 15.8 vs rtc 16.0 只差 0.2px，视觉上是同一条线）                 // 逐线错层（同 y 共线 + 交叉双防）
            a.y = r1(a.y - dyStep);
            escW = `v${r1(-(14 + dyStep))}`;
            escW2 = `h${r1(sideX - a.x)}`;
            a.x = sideX;
          }
        }
      } else { escW = ep.w; a.x = ep.x; escBaseX = ep.baseX; }
      escGroup = ep.key;
    }
    const ap = appPlan.get(idx);
    if (ap) {
      if (ap.dy != null) { appW = ap.w; b.y = r1(b.y + ap.dy); }
      else { appW = ap.w; b.x = ap.x; }
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
    escW, escW2, appW, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, dSrc,
  };

  const srcRun = (pool, x1, x2, meta, target, cls) => mkRun(pool, x1, x2, meta, {
    group: plan.srcGroup, pinY: plan.pinY, cls,
    sortLeft: plan.escBaseX != null ? Math.min(plan.escBaseX, x2) : Math.min(x1, x2),
  });

  if (busHoleOf.has(idx)) {
    // 电源消费者 → 列孔。
    const hole = busHoleOf.get(idx);
    // 【直落式入孔】竖向落孔路径无遮挡即直落（3 段 / 2 转角）；仅左源受 faceRunLimit
    // 约束（右源横扫段不穿走廊，实测不限更好——见 faceRunLimit 注释）。
    // 另：孔行横段不得穿本体（T3 里板/mux 与孔同 y 带，左源的横扫会穿过它们）。
    // 信号中继（fam null）：入口 y 按网错位（hole.yOff）——同字母孔的跨网入口横段不同 y，防共线。
    // C3（可读性）：长横段抬到**孔行之间**（离开所有孔行），再竖直落孔——
    // 用户样本标定：横段压在孔行上会与同列/邻列端点"看起来连在一起"（§6.12）。
    // 落孔 x 按孔字母微错位（1.6 + li*0.9），防相邻孔的落孔竖段端点接触。
    const liOf = (h) => (h && h.letter ? h.letter.charCodeAt(0) - 98 : 0);   // b→0 … e→3
    // 同列多线的落孔竖段必须**分得清**（用户标定：0.9px 微错位在图上就是一条粗线）。
    // 规则：按来线侧扇出，间距 12px —— 左侧来线落 col-6-12k，右侧落 col+6+12k；
    // 末段横进孔（6-42px，各在自己的孔行上，互不重叠）。
    const dropSide = a.x < hole.x ? -1 : 1;
    // 落段排梳序（用户标定 2026-11-10）：按**离列距离**降序——最远的源拿最外侧（最左/最右）落段，
    // 最近的源贴列。此前按处理序（引脚 y）排，远源会落在近源内侧 → DS 的拐角把 MPU 包进去。
    const sr = sideRankOf.get(idx) || { k: 0, n: 1 };
    const kk = sr.k;                                   // 0 = 最远
    if (process.env.V2_DBG2) console.log('[dbg2]', idx, connList[idx][0], 'col', hole.col, 'side', dropSide, 'rank', kk, '/', sr.n);
    const dropX = readability ? r1(hole.x + dropSide * (4.8 + (sr.n - 1 - kk) * 9.6)) : null;
    const dropX0 = dropX != null ? dropX : hole.x;
    // 同带下行（用户 2026-11-10 标定）：消费者本身已在 bb 带内（如 mux 在 bb 同排）且目标孔在其下方
    // → **直接向下**取一条行间道，不要抬到 bb 上方再绕回来（否则每根线多 2 个转角 + 长竖段）。
    const sameBandDown = readability && a.y > bb.top - 8 && hole.y > a.y + 19.2;
    const stageY = readability
      ? (sameBandDown ? r1(hole.y - 9.6) : betweenRowY(r1(hole.y), a.x, dropX0))
      : null;
    const entryOff = fam === 'GND' ? -3 : fam === '5V' ? 3 : (fam ? -6 : (-6 + (hole.yOff || 0)));
    const entryY0 = r1(hole.y + 6 + entryOff);
    if (!blockedBelow(a.x, dSrc) && (a.x > hole.x || Math.abs(a.x - hole.x) <= faceRunLimit)
      && !segHitsRect(a.x, stageY != null ? stageY : entryY0, hole.x, stageY != null ? stageY : entryY0, null)) {
      plan.kind = 'busDirect';
      T(idx, { kind: "busDirect", stageY, sameBandDown, hole: hole.pin, dropX });
      plan.hole = hole;
      plan.target = hole.pin;
      plan.color = fam ? famColor(fam) : (normed[idx].color || 'green');   // 信号中继消费者保留网表线色
      plan.entryY = stageY != null ? stageY : entryY0;
      plan.holeXAdj = stageY != null ? dropX : r1(hole.x - 0.6);
      // 可读性：落孔竖段停在孔行上方 dy=5.7*|dx|（约 10°），末段**微斜**收进孔——
      // 不做 Z 形台阶（用户标定：台阶太碎），同列多线仍各自分开。
      plan.dropY = stageY != null ? r1(hole.y) : null;   // 横进孔（bb 孔允许横向进线，用户标定）   // 微斜收尾（横进孔实验无收益，已回退）
    } else if (readability && stageY != null
      && !segHitsRect(a.x, stageY, dropX0, stageY, new Set([src.id, dst.id]))
      && !segHitsRect(dropX0, stageY, dropX0, hole.y, new Set([src.id, dst.id]))) {
      // 可读性 + 多行布局（如 U2 的 rfid 行 + mux 行）：直落条件被 blockedBelow 否掉时，
      // 仍用"面外横段 + 在 dropX 直落"的同一形态——只要横段与落段都不穿件。
      // （此前落到五段绕行会把 stage 段叠加成同 x 上下往返的自重叠，实测穿板 201px。）
      plan.kind = 'busDirect';
      plan.hole = hole;
      plan.target = hole.pin;
      plan.color = fam ? famColor(fam) : (normed[idx].color || 'green');
      plan.entryY = stageY;
      plan.holeXAdj = dropX;
      plan.dropY = r1(hole.y);
    } else {
    plan.kind = 'bus';
    plan.hole = hole;
    plan.target = hole.pin;
    plan.color = fam ? famColor(fam) : (normed[idx].color || 'green');     // 同上
    // 转角柱来自通道规划（同一列共用一组等距柱）。
    const bp = busPlan.get(idx);
    const famOff = fam === 'GND' ? -0.6 : fam === '5V' ? 0.6 : (fam ? -1.6 : ((hole.yOff || 0) - 1.6));
    plan.dx0 = bp ? bp.x : regVert(r1(a.x < hole.x ? hole.x - 16 : hole.x + 16), a.x < hole.x ? 1 : -1);
    plan.entryY = bp ? bp.entryY : r1(hole.y + famOff);
    if (stageY != null) {                      // C3：面外横段 + 微斜收进孔（同 busDirect）
      plan.entryY = stageY;
      plan.holeXAdj = dropX;
      plan.dropY = r1(hole.y);   // 同 busDirect：横进孔   // 微斜收尾
    }
    plan.runA = srcRun(`P:${dSrc}`, a.x, plan.dx0, `${srcId}→${hole.pin}`, hole.pin, 'pwr');
    }
  } else if (fam && dst.id === boardId && !hubDirectFams.has(fam)) {
    // 电源网（含「任一端」判定，如 mux:S0→uno:GND.2）：单消费者/总线溢出 → 直连轨。
    // 不得回退成「直连板脚」——实测 S0-S2 直连 GND.2 会绕出 457px 的下探怪线。
    const rail = (process.env.V2_HUB_PART && fam === '3.3V' && hubDirectFams.has('5V')) ? 'tp' : railOf(fam);
    const n = pickRailClear(rail, a.x, dSrc);
    const rp = { x: railX(n), y: railY(rail) };
    plan.kind = 'power';
    plan.rp = rp;
    plan.rail = rail;
    plan.target = `bb1:${rail}.${n}`;
    plan.color = famColor(fam);
    // 轨位与离体 x 只差几个像素且同向时，把离体横段并进"横到轨位"那一段：
    // 否则会先冲出去再折回（mux S0 实测 +54 再 -3.6 的 180° 回勾 = 多 1 转角）。
    if (Math.abs(a.x - rp.x) < 8 && Math.sign(rp.x - pinX0) === Math.sign(a.x - pinX0)) {
      plan.escW = null;
      plan.a = { x: pinX0, y: a.y };
    }
    plan.runA = srcRun(`P:${dSrc}`, a.x, rp.x, `${srcId}→${rail}`, plan.target, 'pwr');
  } else if (dst.id === boardId && pinIsBottom(dst.pin)) {
    // 底边板脚。两种形态：
    //   ① 直落（3 转角）：离体后的 x 已在板带之外 → 直接竖降到板底下方，横到脚 x，再上抬进脚。
    //      这是"一拐到位"的形态；只要竖段不穿板/不穿件就优先用它。
    //   ② 绕板（4 转角）：离体 x 在板正上方 → 必须先横到板侧再下，否则竖段穿板 190px。
    const underY0 = regHorizY(Math.max(b.y + 14, boardTop + boardSize.height + 4), 1);
    // 横段不得与任何孔行同 y（实测 U2：板下走廊 870.5 恰等于 16t.b 孔行 → 与落孔末段共线 40px）
    const holeRows = ['a', 'b', 'c', 'd', 'e'].map(lt => { const hp = holePosOf(1, 't', lt); return hp ? hp.y : null; }).filter(v => v != null);
    let underY = underY0;
    // 仅在可读性模式启用孔行避让（U2/U2a 基线路径保持原样，避免回退）
    if (readability) {
      // 横段落在两排孔行之间时取**中点**（孔行距 9.6 → 各留 4.8px，避免压孔）；
      // 此前只查 1 列 a-e 行，列/半区不对就漏判（实测压在 16t.b 孔行 2px）。
      const usedHoleYs = [...new Set([...busHoleOf.values()].map(hh => hh.y)
        .concat(holeRows).filter(v => typeof v === 'number' && isFinite(v)))].sort((u, v) => u - v);
      if (usedHoleYs.length) {
        let lo = null, hi = null;
        for (const y of usedHoleYs) { if (y <= underY + 0.5) lo = y; if (y >= underY - 0.5 && hi == null) hi = y; }
        if (lo != null && hi != null && hi - lo > 1) {
          const mid = r1((lo + hi) / 2);
          // 下界：不得高于板/元件的下缘（实测取中点落到 862.5 → 横穿板底边 113px）
          const floorY = r1(boardTop + boardSize.height + 6);
          const pickY = Math.max(mid, floorY);
          if (Math.abs(pickY - underY) > 0.5) underY = regHorizY(pickY, 1);
        } else if (lo != null) {
          // 压在孔行上：移到它下方 4.8px，但**不得高于板下缘**（漏此下界 → 走廊落 806.9 在板内）
          underY = regHorizY(r1(Math.max(lo + 4.8, boardTop + boardSize.height + 6)), 1);
        }
      }
    }
    // 统一分配器：板下横段也注册跨度，并与其它横段保持 >=9.6 间距（仅可读性路径）
    if (readability) underY = allocHorizDown(underY, Math.min(a.x, b.x), Math.max(a.x, b.x));
    const skip = new Set([src.id, dst.id]);
    const canDrop = !segHitsRect(a.x, a.y, a.x, underY, skip)
      && !segHitsRect(a.x, underY, b.x, underY, skip);
    if (canDrop) {
      plan.kind = 'bottomDrop';
      plan.underY = underY;
      plan.color = fam ? famColor(fam) : (c.color || 'blue');
      plan.target = `${boardId}:${dst.pin}`;
    } else {
      const side = aroundSideOf(b.x);
      const dx0 = turnPost(`around:${side}`, bottomRank.get(idx) || 0, {
        prefer: side === 'L' ? boardLeft - 8 : boardLeft + boardSize.width + 8,
        dir: side === 'L' ? -1 : 1, step: POST_STEP, count: aroundCount[side],
        lo: side === 'R' ? boardLeft + boardSize.width + 6 : boardLeft - 6 - 40 * POST_STEP,
        hi: side === 'L' ? boardLeft - 6 : boardLeft + boardSize.width + 6 + 40 * POST_STEP,
        y1: laneBase(dSrc) - 30, y2: underY + 30,
      });
      plan.kind = 'bottom';
      plan.dx0 = dx0;
      plan.underY = underY;
      plan.color = fam ? famColor(fam) : (c.color || 'blue');
      plan.target = `${boardId}:${dst.pin}`;
      plan.runA = srcRun(`A:${dSrc}`, a.x, dx0, `${srcId}→${boardId}:${dst.pin}`, plan.target, 'brd');
    }
  } else if (dst.id === boardId) {
    // 顶边板脚（数字脚）：从上方进
    plan.kind = 'top';
    plan.color = fam ? famColor(fam) : (c.color || 'green');
    plan.target = `${boardId}:${dst.pin}`;
    plan.runA = srcRun(`A:${dSrc}`, a.x, b.x, `${srcId}→${boardId}:${dst.pin}`, plan.target, 'brd');
  } else {
    // 模块 → 模块：先看能否"直落 + 横进"（2 转角）：离体竖段与进脚横段都不穿本体时成立。
    // 不然回到车道式（4 转角）——车道是为避免横段穿排内邻件而设的。
    const dx = b.x - a.x;
    const bundled = plan.srcGroup && srcGroupCount[plan.srcGroup] > 1;
    plan.target = swap ? `${boardId}:${dst.pin}` : tRef;
    const skip = new Set([src.id, dst.id]);
    const pinX = b.x, pinY = b.y;
    const oTx = openSideRef(dst.id, dst.pin).x;
    // 进脚方向：引脚开放侧是"朝外那一侧"，线必须从那一侧横进来（从右来 = 向左走 = -1）
    const directOK = oTx !== 0 && Math.sign(pinX - a.x) === -oTx
      && !segHitsRect(a.x, a.y, a.x, pinY, skip)
      && !segHitsRect(a.x, pinY, pinX, pinY, skip);
    if (directOK && Math.abs(dx) > 4) {
      plan.kind = 'modDrop';
      plan.color = c.color || 'green';
      plan.b = { x: pinX, y: pinY };          // 直接横进引脚：不走进脚槽
      plan.appW = null;
    } else if (Math.abs(dx) <= 12 && !bundled) plan.kind = 'modDirect';
    else {
      plan.kind = 'mod';
      plan.color = c.color || 'green';
      plan.runA = srcRun(`A:${dSrc}`, a.x, b.x, `${srcId}→${tRef}`, plan.target, 'sig');
    }
  }
  plans.push(plan);
}

if (process.env.V2_DEBUG) {
  for (const p of plans) {
    console.log(`[PLAN] #${p.idx} ${p.srcId} → ${p.target} kind=${p.kind} a=(${p.a.x},${p.a.y}) b=(${p.b.x},${p.b.y})`
      + ` esc=${p.escW || '-'} dx0=${p.dx0 != null ? p.dx0 : '-'} hole=${p.hole ? p.hole.pin : '-'}`
      + ` laneY=${p.runA ? p.runA.pool + '@' + (p.runA.y || 0) : '-'}`);
  }
}

// ── 6b. 列总线 → 长轨：每族一根短跳线（下缘轨向下、上缘轨向上，横进轨）──
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

// ── 6c. 板 → 轨馈电（每族一根）：下缘轨可"向下再向下"直进；上缘轨改由列跳线供电 ──
{
  const FEED = { tn: 'GND.2', tp: '5V', bp: '3.3V' };
  const famOfRail = { tn: 'GND', tp: '5V', bp: '3.3V' };
  const FEED_PIN = { GND: 'GND.2', '5V': '5V', '3.3V': '3.3V' };
  // 馈电道序（用户 2026-11-10）：按板脚 x 升序——最左脚拿最深的一条道（外缘包裹内缘），
  // 道距 24px，深于轨/孔后从下方兜回目标（懒计算：singleColFeed / sigFeeds 在规划期才齐）。
  let feedRanks = null;
  // 车道 = 规则（按板脚 x 排名，越左越深）+ 障碍避让（allocHorizDown）+ 兜底（null）。
  // 为什么不能定死：布局一变（行距压缩），固定 y 会落进 bb/板本体——实测行距 150 时
  // 车道 442.7 落在 bb 内部 → 穿板 2 处。所以这里必须走"避让 + 不可用就退回旧形态"。
  const feedLaneY = (pin, lo, hi) => {
    if (!feedRanks) {
      feedRanks = new Map();
      const xs = [];
      for (const fam2 of Object.keys(FEED_PIN)) {
        const pn2 = FEED_PIN[fam2];
        const usedPin = connList.some(c2 => {
          const e0 = Array.isArray(c2) ? c2[0] : c2.from;
          const e1 = Array.isArray(c2) ? c2[1] : c2.to;
          const want = boardId + ":" + pn2;
          return String(e0) === want || String(e1) === want;
        });
        if (!usedPin) continue;
        const pp2 = pn2 && pinPos(boardId, pn2);
        if (pp2) xs.push({ pin: pn2, x: pp2.x });
      }
      for (const sg of sigFeeds) {
        const pp2 = pinPos(sg.id, sg.pin);
        if (pp2) xs.push({ pin: sg.pin, x: pp2.x });
      }
      const seen = new Set();
      const uniq = xs.filter(e => (seen.has(e.pin) ? false : (seen.add(e.pin), true)));
      uniq.sort((u, v) => u.x - v.x);
      uniq.forEach((e, k) => feedRanks.set(e.pin, k));
    }
    const rk = feedRanks.get(pin);
    if (rk == null) return null;
    const want = r1(Math.max(railY("tp"), railY("tn")) + 40 - rk * 24);
    const l = lo == null ? 0 : Math.min(lo, hi == null ? lo : hi);
    const h2 = hi == null ? 0 : Math.max(lo == null ? hi : lo, hi);
    // 先试规则位置（避让障碍 + 统一横段表），仍穿件则放弃 → 调用方退回旧形态
    const got = allocHorizDown(want, l, h2, { tries: 8 });
    if (segHitsRect(l, got, h2, got, null)) return null;
    return got;
  };
  // 单列即网的馈电：板脚 → 竖落到孔行 → 横进列首孔（1 转角，无 180° 回勾）。
  // 多族时每族占不同的列首孔字母（a/b/c…，孔行 y 相差 9.6px）→ 横段不共线，且仍是 1 转角。
  // 旧做法：两族都进 a 孔、横段同 y，只能错开走板底带（2 转角 + 17px 回勾）。
  {
    let feedK = 0;
    const FEED_LETTERS = ['a', 'b', 'c'];
    // 按板脚 x 升序发字母：x 最小的馈电拿最低的孔行(a)——它的横段最长，
    // 放最低就不会横穿另一族馈电的竖段（否则 N1 实测交叉 3→4）。
    const feeds = [...singleColFeed.entries()].map(([fam, sf]) => {
      const pin = boardPins[FEED_PIN[fam]] ? FEED_PIN[fam] : FEED_PIN[fam].split('.')[0];
      return { fam, sf, pin, pp: pinPos(boardId, pin), color: null };
    }).filter(f => f.pp);
    // 信号中继的板脚馈电（Z5）：与电源馈电共用同一字母 stagger（a/b/c… 按板脚 x 序，孔行 y 错开防共线）
    for (const sg of sigFeeds) {
      const pp = pinPos(sg.id, sg.pin);
      if (pp) feeds.push({ fam: null, sf: { col: sg.col }, pin: sg.pin, pp, color: sg.color, sigNet: sg.net });
    }
    feeds.sort((a, b) => a.pp.x - b.pp.x);
    let sigK = 0;   // 信号馈电逐条 y 错位计数（a 孔行与电源馈电同 y → 各自下移错开防共线）
    for (const f of feeds) {
      const isSig = !!f.sigNet;
      // 电源馈电：字母 a/b/c stagger（消费者在 e，无冲突）；信号馈电：固定 a（消费者占 b-e）
      const letter = isSig ? 'a' : FEED_LETTERS[feedK++ % FEED_LETTERS.length];
      const hp = holePosOf(f.sf.col, 't', letter);
      const yOff = isSig ? 2.4 : 0;   // （非可读性路径用；可读性分支自行管理 sigK）
      const holePin = `bb1:${f.sf.col}t.${letter}`;
      // 馈电竖进段的 x 错到列 x+0.9：与消费者竖进段（x-0.6+k）不共线（同列防共线）
      const fx = r1(hp.x + 0.9);
      const wc = f.color || famColor(f.fam);
      const tag = isSig ? `信号中继 ${f.sigNet}` : '单列即网';
      // C3（可读性）+ 嵌套序（用户标定 2026-11-09）：控制板出线回环 = 正极最外 → GND → 信号。
      // 信号馈电横段走 **b 行与 a 行之间的夹缝**（t.b 与 t.a 孔行之间）——唯一无交叉走廊：
      // 上方避开所有终于 b 行的落段竖线，下方避开跳线竖段（a 行起）。
      if (readability) {
        if (isSig) {
          // 嵌套序（左→深）：x 最小的信号馈电走**最深（轨馈外侧）**——它的竖段在最左，
          // 横段从最深道上向右走时不会穿过右侧馈电的竖段（反之会交叉）。
          // 其余条走 b/a 行夹缝（距两端孔行 4.8px：无交叉、无端点擦碰）。
          const gapY = r1(hp.y - 4.8);
          const outerY = r1(railY('tn') + 4.4 + Math.max(0, sigK - 1) * 4);
          // 信号馈电也走统一横段分配器（此前绕过它 → 与 5V 馈电只差 5px、重叠 189px）
          // 与轨馈电共用 rank 车道（用户 2026-11-10 手调标定：四根馈电严格嵌套，
          // 5V 最深 → GND → A4 → A5；A5 更深后从下方进孔）。
          const laneY = (readability && maxDist === 1) ? feedLaneY(f.pin, f.pp.x, hp.x) : null;
          const baseY = laneY != null ? laneY : (sigK === 0 ? outerY : gapY);
          const stage = laneY != null ? laneY : allocHorizUp(baseY, r1(f.pp.x), r1(hp.x + 1.2), { step: 14, skipRects: true });
          sigK++;
          const dx = r1(hp.x + 1.2);
          conns.push([`${boardId}:${f.pin}`, holePin, wc,
            [`v${r1(stage - f.pp.y)}`, `h${r1(dx - f.pp.x)}`, `v${r1(hp.y - stage)}`]]);
          console.log(`[INFO] 馈电: ${boardId}:${f.pin} → ${holePin}（${tag}，${stage === gapY ? 'b/a 夹缝' : '轨馈外侧（最深）'}横走）`);
          continue;
        }
        let stage = feedRowY(f.pp.y, hp.y, f.pp.x, r1(hp.x + 1.2));
        const dx = r1(hp.x + 1.2);
        // 绕板兜底（bb-band 布局实测）：横段 y 落在板的 y 带内（且目标在板右缘外）
        // → 必穿板（引脚本身在板内，不能用 segHitsRect+skip 判）——改走"板底之下 → 右 → 上进孔"。
        if (dx > boardLeft + boardSize.width && stage > boardTop + 2 && stage < boardTop + boardSize.height - 2) {
          const under = r1(boardTop + boardSize.height + 4.8);
          conns.push([`${boardId}:${f.pin}`, holePin, wc,
            [`v${r1(under - f.pp.y)}`, `h${r1(dx - f.pp.x)}`, `v${r1(hp.y - under)}`]]);
          console.log(`[INFO] 馈电: ${boardId}:${f.pin} → ${holePin}（${tag}，绕板底→上进孔）`);
          continue;
        }
        conns.push([`${boardId}:${f.pin}`, holePin, wc,
          [`v${r1(stage - f.pp.y)}`, `h${r1(dx - f.pp.x)}`, `v${r1(hp.y - stage)}`]]);
        feedK++;
        console.log(`[INFO] 馈电: ${boardId}:${f.pin} → ${holePin}（${tag}，孔行之间横走+竖直落孔）`);
        continue;
      }
      // T3（孔在板右侧、同 y 带）：直横段会穿板 → 改走下方走廊（v 下 → h 右 → v 上进孔）
      if (segHitsRect(f.pp.x, hp.y + yOff, fx, hp.y + yOff, null)) {
        const cy = regHorizY(underCorridorY(), 1);
        conns.push([`${boardId}:${f.pin}`, holePin, wc,
          [`v${r1(cy - f.pp.y)}`, `h${r1(fx - f.pp.x)}`, `v${r1(hp.y + yOff - cy)}`, `h-0.9`, `v${r1(-yOff)}`]]);
        console.log(`[INFO] 馈电: ${boardId}:${f.pin} → ${holePin}（${tag}，板下走廊进列首孔）`);
        continue;
      }
      conns.push([`${boardId}:${f.pin}`, holePin, wc,
        isSig
          ? [`v${r1(hp.y + yOff - f.pp.y)}`, `h${r1(fx - f.pp.x)}`, 'h-0.9', `v${r1(-yOff)}`]
          : [`v${r1(hp.y + yOff - f.pp.y)}`, `h${r1(fx - f.pp.x)}`]]);
      console.log(`[INFO] 馈电: ${boardId}:${f.pin} → ${holePin}（${tag}，直落进列首孔）`);
    }
  }
  for (const rail of ['tn', 'tp', 'bp']) {
    if (!railUsed[rail].size && !busJumpers.some(b => b.fam === famOfRail[rail] || b.fam === ((rail === 'tp' && process.env.V2_HUB_PART && hubDirectFams.has('5V')) ? '3.3V' : ''))) continue;
    // 轨道归属：hub 布局且 5V 已直连 → tp 归 3.3V（否则 tp 归 5V、bp 归 3.3V）
    const hubTp33 = !!process.env.V2_HUB_PART && hubDirectFams.has('5V') && busJumpers.some(b => b.fam === '3.3V');
    const fam = (rail === 'tp' && hubTp33) ? '3.3V' : famOfRail[rail];
    const jumpered = busJumpers.some(b => b.fam === fam);   // 有该族跳线接到的轨必须馈电
    if (rail === "bp" && hubTp33) { console.log("[INFO] 跳过 bp 馈电：3.3V 已改走 tp"); continue; }
    // hub 直连族（单消费者电源，如 mux 的 5V）：板脚已直连元件，不再给轨馈电
    if (hubDirectFams.has(fam)) { console.log(`[INFO] 跳过轨馈电: ${fam}（已直连元件）`); continue; }
    let pin = boardPins[FEED[rail]] ? FEED[rail] : FEED[rail].split('.')[0];
    if (rail === 'tp' && hubTp33) pin = '3.3V';
    const pp = pinPos(boardId, pin);
    if (!pp) continue;
    const bj = busJumpers.find(b => b.fam === fam);
    const railAtBottom = railY(rail) > bb.top + BB.height / 2;
    // 上缘轨(bp)：R-同极双轨一张网——tp 空闲（5V 走了单列）时，经 tp 馈电 + 末端桥
    // tp↔bp（同为正轨，同网桥接合法；跨电源网互桥才短路）。tp 被占则退回绕边馈电。
    if (!railAtBottom) {
      if (rail === 'bp' && railUsed.tp.size === 0) {
        let nf = geo.rail.maxPosition;
        while (nf > 0 && (railUsed.tp.has(nf) || railNUsed.has(nf) || blockedBelow(railX(nf), 1))) nf--;
        if (nf > 0) {
          railUsed.tp.add(nf); railNUsed.add(nf);
          const rpF = { x: railX(nf), y: railY('tp') };
          plans.push({
            kind: 'feedRail', srcId: `${boardId}:${pin}`, target: `bb1:tp.${nf}`,
            color: famColor(fam), a: { x: pp.x, y: pp.y }, b: { x: rpF.x, y: rpF.y },
            rp: rpF, rail: 'tp', railAtBottom: true,
          });
          let nb = 1;
          while (nb <= geo.rail.maxPosition && (railUsed.tp.has(nb) || railUsed.bp.has(nb) || railNUsed.has(nb))) nb++;
          if (nb <= geo.rail.maxPosition) {
            railUsed.tp.add(nb); railUsed.bp.add(nb); railNUsed.add(nb);
            plans.push({
              kind: 'endBridge', srcId: `bb1:tp.${nb}`, target: `bb1:bp.${nb}`,
              color: famColor(fam), a: { x: railX(nb), y: railY('tp') }, b: { x: railX(nb), y: railY('bp') },
            });
            console.log(`[INFO] 馈电: ${boardId}:${pin} → bb1:tp.${nf}（端部）+ 末端桥 tp.${nb}→bp.${nb}（同极双轨一张网）`);
            continue;
          }
        }
      }
      // 绕边馈电（tp 被占时的兜底）：板底带 → bb 右缘外 → 板上方 → 从上方进轨。
      let n = null, best = Infinity;
      for (let nn = 1; nn <= geo.rail.maxPosition; nn++) {
        if (railUsed[rail].has(nn) || railNUsed.has(nn)) continue;
        const dd = Math.abs(railX(nn) - (bj ? bj.hole.x : pp.x));
        if (dd < best) { best = dd; n = nn; }
      }
      if (n == null) n = pickRailClear(rail, pp.x, 1);
      else { railUsed[rail].add(n); railNUsed.add(n); }
      const rp0 = { x: railX(n), y: railY(rail) };
      const belowY0 = belowBase + 100;
      const upX = bb.left + BB.width + 12;
      const aboveY = bb.top - 12;
      conns.push([`${boardId}:${pin}`, `bb1:${rail}.${n}`, famColor(fam),
        [`v${r1(belowY0 - pp.y)}`, `h${r1(upX - pp.x)}`, `v${r1(aboveY - belowY0)}`,
         `h${r1(rp0.x - upX)}`, `v${r1(rp0.y - aboveY)}`]]);
      console.log(`[INFO] 馈电: ${boardId}:${pin} → bb1:${rail}.${n}（绕边：板底带→bb右缘外→板上方进轨）`);
      continue;
    }
    // 下缘轨：R-端部馈电——轨位优先取端部（n=25，靠板一侧），中段留给列跳线/消费者。
    let n = null;
    // 包裹序（单行可读性）：馈电按板脚 x 升序处理，先到者（最左脚）敲轨**最右端**（n 最小），
    // 依次向内——外缘包裹内缘（多行/基线保持「端部 n=25」旧规则）。
    const wrapFeed = readability && maxDist === 1;
    if (wrapFeed) {
      let wn = null;
      for (let nn = 1; nn <= geo.rail.maxPosition; nn++) {
        if (railNUsed.has(nn)) continue;
        if (blockedBelow(railX(nn), 1)) continue;
        if (bj && railX(nn) > bj.hole.x - 20) continue;
        wn = nn; break;
      }
      if (wn != null) n = wn;
    }
    if (n == null && !railNUsed.has(geo.rail.maxPosition) && !blockedBelow(railX(geo.rail.maxPosition), 1)) {
      n = geo.rail.maxPosition;
    } else {
      let best = -Infinity, fallback = null, fbest = Infinity;
      for (let nn = 1; nn <= geo.rail.maxPosition; nn++) {
        if (railNUsed.has(nn)) continue;
        const rx = railX(nn);
        if (blockedBelow(rx, 1)) continue;
        if (bj && rx > bj.hole.x - 20) continue;
        if (rx > best) { best = rx; n = nn; }
        const dd = Math.abs(rx - pp.x);
        if (dd < fbest) { fbest = dd; fallback = nn; }
      }
      if (n == null) n = fallback != null ? fallback : pickRailClear(rail, pp.x, 1);
    }
    railUsed[rail].add(n); railNUsed.add(n);
    const rp = { x: railX(n), y: railY(rail) };
    plans.push({
      kind: 'feedRail', srcId: `${boardId}:${pin}`, target: `bb1:${rail}.${n}`,
      laneY: (readability && maxDist === 1) ? feedLaneY(pin, Math.min(pp.x, rp.x), Math.max(pp.x, rp.x)) : null,
      color: famColor(fam),
      a: { x: pp.x, y: pp.y }, b: { x: rp.x, y: rp.y }, rp, rail, railAtBottom,
    });
    console.log(`[INFO] 馈电: ${boardId}:${pin} → bb1:${rail}.${n}（下缘轨直进）`);
  }
}

// ── 6c. 第二遍：分带 + left-edge 通道分配（先定 y，再生成 waypoints）──
// 【任务 C：束间分带】同一层的水平段按"去向类别"分成三条带，带间不侵占：
//   sig（模块→模块，走最上）/ brd（模块→板脚，贴板，走中间）/ pwr（电源，独立带，走最下）
// 带内仍用 left-edge + 同源束引脚序；带间 y 区间互不重叠 → 跨带穿越只在竖直段发生。
// 之前所有类别混在一个池里由 left-edge 随机排，板脚线和模块线互相穿。
{
  const byPool = new Map();
  for (const run of runs) {
    const k = `${run.pool}|${run.cls || 'sig'}`;
    if (!byPool.has(k)) byPool.set(k, []);
    byPool.get(k).push(run);
  }
  const laneCount = {};
  const CLS_RANK = { sig: 0, brd: 1, pwr: 2 };
  const poolOrder = [...byPool.keys()].sort((a, b) => {
    const [pa, ca] = a.split('|'), [pb, cb] = b.split('|');
    const da = pa === 'B' ? -1 : +pa.slice(2), db = pb === 'B' ? -1 : +pb.slice(2);
    if (da !== db) return da - db;
    return (CLS_RANK[ca] ?? 0) - (CLS_RANK[cb] ?? 0);
  });
  const laneUsed = {};                                    // `${d}` → 已占用车道数
  let prevKey = null;
  for (const pool of poolOrder) {
    const [poolName, cls] = pool.split('|');
    const list = byPool.get(pool);
    let base;
    if (poolName === 'B') base = belowBase;
    else {
      const d = +poolName.slice(2);
      const used = laneUsed[d] || 0;
      const gap = (prevKey != null && prevKey.endsWith('|pwr') === false && cls === 'pwr') ? 40 : 0;
      base = laneBase(d) + used * LANE_STEP + gap;
    }
    const lanes = [];                                     // 每条车道只记 lastRight
    // 同源平行束：同一 (源元件, 开放侧) 的 run 连续处理，且按引脚 y 降序——
    // 下面的引脚先处理拿最近车道，上面的引脚随后落到更深车道；组间按最左端排序。
    const keyOf = (r) => (r.pinY != null ? r.group : `~${r.meta}`);
    const groupMin = {};
    for (const r of list) {
      const g = keyOf(r);
      groupMin[g] = Math.min(groupMin[g] != null ? groupMin[g] : Infinity, r.sortLeft);
    }
    // 电源扇入（P 池，多行电路）：组序反转——**左源 → 深车道**（嵌套扇入，ref2 阶梯形态）。
    // 左源的车道横段最长、要穿过所有邻源的离体竖段，必须放在它们终点之下；
    // 浅车道（先处理）留给右源。信号池（A）方向相反（目标在板侧），保持默认。
    const fanIn = poolName.startsWith('P:') && maxDist >= 2;
    const gRank = new Map(Object.keys(groupMin)
      .sort((a, b) => (fanIn ? groupMin[b] - groupMin[a] : groupMin[a] - groupMin[b]))
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
    laneCount[pool] = lanes.length;
    const dKey = poolName === 'B' ? 'B' : poolName.slice(2);
    laneUsed[dKey] = (laneUsed[dKey] || 0) + lanes.length;
    prevKey = pool;
  }
}

// ── 6d. 生成 waypoints：y 已在上一遍定好，不再"补段再补偿" ──────
{
  const emit = (plan) => {
    const w = [];
    if (plan.escW) w.push(plan.escW);
    if (plan.escW2) w.push(plan.escW2);   // 顶开放引脚的横移出带段（本体带外再下钻）
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
      // 直落进轨：在引脚 y 上直接横到轨位 x，再竖落进轨（1 转角，省掉"车道→转弯"两段）。
      // 原来先下降到车道再横 3.6px 再落 → 无意义的 3 转角 + 4px 碎横段。
      pushH(plan.rp.x); pushV(plan.rp.y);
    } else if (plan.kind === 'bottom') {
      pushV(plan.runA.y); pushH(plan.dx0); pushV(plan.underY);
      pushH(b.x); pushV(b.y);
    } else if (plan.kind === 'bottomDrop') {
      // 直落：竖降到板底下方（不穿板）→ 横到脚 x → 上抬进脚（2 转角）
      pushV(plan.underY); pushH(b.x); pushV(b.y);
    } else if (plan.kind === 'modDrop') {
      // 直落：在离体 x 上竖降到目标引脚 y → 横进引脚（2 转角）
      pushV(b.y); pushH(b.x);
    } else if (plan.kind === 'busDirect') {
      // 直落式入孔：竖降到孔上方 6px，横到孔 x-0.6，末段微斜入孔（3 段 / 2 转角）。
      // C3（可读性）：横段抬到孔行之间（entryY=stageY），再竖直落孔（dropY）。
      pushV(plan.entryY); pushH(plan.holeXAdj);
      if (plan.dropY != null) pushV(plan.dropY);
    } else if (plan.kind === 'bus') {
      // 进孔竖段的 x 按孔序错位 ~1px：同列多条走廊竖进段不共线（bench 共线 <0.5px）。
      const entryX = plan.dropY != null ? plan.holeXAdj : r1(plan.hole.x - 0.6 + (plan.hole.k || 0));
      const cy0 = underCorridorY();
      if (!segHitsRect(plan.a.x, plan.a.y, plan.a.x, cy0, null)) {
        // 离体点正下方无本体（T3 板行侧边的源）：直落下方走廊 → 横到列 → 竖进孔（3 转角）
        const cy = regHorizY(cy0, 1);
        pushV(cy); pushH(entryX); pushV(plan.entryY);
        if (plan.dropY != null) pushV(plan.dropY);
      } else {
        // 离体点在板/枢纽正上方（T3）：车道 → 柱 →（孔行横段穿体则）下方走廊 → 竖进孔
        pushV(plan.runA.y); pushH(plan.dx0);
        if (segHitsRect(plan.dx0, plan.entryY, plan.hole.x, plan.entryY, null)) {
          const cy = regHorizY(cy0, 1);
          pushV(cy); pushH(entryX); pushV(plan.entryY);
        } else {
          pushV(plan.entryY); pushH(entryX);
        }
        if (plan.dropY != null) pushV(plan.dropY);
      }
    } else if (plan.kind === 'busJumper') {
      const bj = plan.bj;
      if (bj.railAtBottom) { pushV(r1(bj.railY - 0.6)); pushH(bj.railX); }
      else { pushV(r1(bj.railY + 0.6)); pushH(bj.railX); }
    } else if (plan.kind === 'endBridge') {
      pushV(b.y);
    } else if (plan.kind === 'feedRail') {
      // 深道（单行可读性）：先下到本脚的车道，再横到轨位，最后从下方兜进轨——
      // 外缘包裹内缘（最左脚最深），实测间距违规 -3、馈电交叉 0。
      if (plan.laneY != null) {
        pushV(plan.laneY); pushH(plan.rp.x); pushV(r1(plan.rp.y - 0.6));
      } else if (plan.railAtBottom && segHitsRect(plan.a.x, plan.rp.y, plan.rp.x, plan.rp.y, null)) {
        const cy = regHorizY(underCorridorY(), 1);
        pushV(cy); pushH(plan.rp.x); pushV(r1(plan.rp.y - 0.6));
      } else if (plan.railAtBottom) {
        const hy = regHorizY(r1(plan.rp.y - 0.6), 1);
        pushV(hy); pushH(plan.rp.x); pushV(r1(plan.rp.y - 0.6));
      } else { pushV(r1(plan.rp.y + 0.6)); pushH(plan.rp.x); }
    } else if (plan.kind === 'top') {
      pushV(plan.runA.y); pushH(b.x); pushV(b.y);
    } else if (plan.kind === 'mod') {
      pushV(plan.runA.y); pushH(b.x); pushV(b.y);
    } else if (plan.kind === 'modDirect') {
      pushV(b.y);
    }
    if (plan.appW) w.push(plan.appW);
    conns.push([plan.srcId, plan.target, plan.color, w]);
  };
  plans.forEach(emit);
}

// ── 6.9 routing.zones 分区声明（草案：只读入 + 审计，不改变走线行为）──────
// 语义见 intent-format.md「routing.zones」与 layout-rules.md「分区纪律」Z1-Z4。
// 引擎现状：按表审计——轨区目标必须属于电源族（Z2）；其余目标只做分布统计。
if (intent.routing && Array.isArray(intent.routing.zones) && intent.routing.zones.length) {
  const RAIL_RE = /^bb1:(t[np]|b[np])\.\d+$/;
  const HOLE_RE = /^bb1:\d+[tb]\.[a-j]$/;
  const zoneOf = (target) => {
    if (RAIL_RE.test(target)) return 'rails';
    if (HOLE_RE.test(target) || /^bb1:/.test(target)) return 'middle';
    if (String(target).split(':')[0] === boardId) return 'board-pins';
    return 'part';
  };
  // 连接 → 网族：按**原始 intent 连接**判（任一端是电源脚 → 两端引脚都属于该族），
  // 而不是最终线两端——S0/S1/S2 这类"地址脚接地"的成员在最终线上看不到电源脚名。
  const partTypeOf = (id) => id === 'bb1' ? bb.type
    : id === boardId ? boardType
    : ((intent.parts.find(p => p.id === id) || {}).type);
  const famOfPin = (end) => {
    const [id, pin] = String(end).split(':');
    const t = partTypeOf(id);
    if (!t || String(t).includes('breadboard')) return null;
    if (!Array.isArray((pins[t] || {})[pin]) || !POWER_RE.test(pin)) return null;
    return /GND/i.test(pin) ? 'GND' : /5V/i.test(pin) ? '5V' : /3\.3/i.test(pin) ? '3.3V' : null;
  };
  const pinFam = new Map();
  for (const c of (intent.connections || [])) {
    const fam = famOfPin(c.from) || famOfPin(c.to);
    if (fam) { pinFam.set(String(c.from), fam); pinFam.set(String(c.to), fam); }
  }
  const famOfWire = (c) => famOfPin(c[0]) || famOfPin(c[1]) || pinFam.get(String(c[0])) || pinFam.get(String(c[1])) || null;
  const byZone = {};
  let violations = 0;
  for (const c of conns) {
    const z = zoneOf(c[1]);
    byZone[z] = (byZone[z] || 0) + 1;
    if (z !== 'rails') continue;
    const bothBb = /^bb1:/.test(String(c[0])) && /^bb1:/.test(String(c[1]));
    if (bothBb) continue;                       // Z2 允许：bb 内部跳线 / 轨桥
    if (famOfWire(c)) continue;                 // Z2 允许：电源族成员（含地址脚接地的馈电）
    violations++;
    console.log(`[ZONE] 违例(Z2 信号不走轨): ${c[0]} → ${c[1]}`);
  }
  console.log(`[ZONE] 分区审计（声明 ${intent.routing.zones.length} 区）: ${Object.entries(byZone).map(([k, v]) => `${k}=${v}`).join(' ')}｜违例 ${violations}`);
}

// 中继对账（routing.relays，intent-format.md 草案）：声明的一脚多用 vs 引擎实际形态。
// 只读 conns 对账，不改变走线行为。
if (intent.routing && Array.isArray(intent.routing.relays) && intent.routing.relays.length) {
  const otherEnd = (ep) => {
    const c = conns.find(x => x[0] === ep || x[1] === ep);
    return c ? (c[0] === ep ? String(c[1]) : String(c[0])) : null;
  };
  const colOf = (t) => { const m = /^bb1:(\d+)([tb])\./.exec(t); return m ? m[1] + m[2] : null; };
  const isRail = (t) => /^bb1:[tb][np]\.\d+$/.test(t);
  for (const r of intent.routing.relays) {
    const srcEnd = otherEnd(r.source);
    if (!srcEnd) { console.log(`[RELAY] ${r.net}: ✗ 源 ${r.source} 无连线`); continue; }
    const cols = new Set();
    let direct = 0; const missing = [];
    for (const cu of (r.consumers || [])) {
      const end = otherEnd(cu);
      if (end == null) { missing.push(cu); continue; }
      const col = colOf(end);
      if (col) cols.add(col); else direct++;
    }
    const srcCol = colOf(srcEnd);
    const only = [...cols][0];
    const form = direct === 0 && cols.size === 1
      ? (srcCol === only ? '单列即网' : isRail(srcEnd) ? '列总线(轨馈+跳线)' : '列总线')
      : direct > 0 ? `直连×${direct}` : `散列×${cols.size}`;
    const ok = direct === 0 && cols.size === 1 && (srcCol === only || isRail(srcEnd));
    console.log(`[RELAY] ${r.net}(${r.role || 'fanout'}): 源→${srcEnd}｜消费者 ${(r.consumers || []).length} 落列 ${[...cols].join('/') || '无'}｜形态 ${form} ${ok ? '✓' : '✗'}`);
    if (missing.length) console.log(`[RELAY]   ✗ 未连线消费者: ${missing.join(', ')}`);
  }
}
// 连线底座保留字检查（parts[].mount:"bb"——元件插入面包板，引脚即孔；引擎尚未实现）
for (const p of (intent.parts || [])) {
  if (p && p.mount === 'bb') console.log(`[RELAY] ⚠ ${p.id} mount:"bb"（连线底座）为保留字，引擎尚未实现——当前按独立放置+飞线处理`);
}

// ── 7. 输出 ───────────────────────────────────────────────
const partsOut = [
  { type: bb.type, id: 'bb1', top: bb.top, left: bb.left, rotate: bb.rotate, attrs: {} },
  { type: boardType, id: boardId, top: Math.round(boardTop), left: Math.round(boardLeft), attrs: {} },
  ...mods.map(m => ({ type: m.type, id: m.id, top: pos[m.id].top, left: pos[m.id].left, attrs: {} })),
];
fs.mkdirSync(outDir, { recursive: true });
if (TRACE) {
  const rows = [...traceOf.entries()].map(([i, r]) => ({ i, ...r }));
  console.log("[TRACE] wire,escRule,dir,stageY,kind,hole");
  for (const r of rows) {
    const nm = `${normed[r.i].src.id}:${normed[r.i].src.pin}->${normed[r.i].dst.id}:${normed[r.i].dst.pin}`;
    console.log(`[TRACE] ${nm} | ${r.escRule || "-"} | dir=${r.dir != null ? r.dir : (r.dir2 != null ? r.dir2 : "-")} | stageY=${r.stageY != null ? Math.round(r.stageY) : "-"} | ${r.kind || "-"} | ${r.hole || "-"}`);
  }
}
fs.writeFileSync(path.join(outDir, 'diagram.json'), JSON.stringify({ version: 1, author: 'layout-v2', editor: 'wokwi', parts: partsOut, connections: conns }, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(outDir, 'sketch.ino'), 'void setup() {}\nvoid loop() {}\n', 'utf8');
// 生成后自动产出台账（跳线语义说明）：说明每个网是电源干道 / 母线中继 / 列隔离。
if (process.env.V2_NO_NOTES !== "1") {
  try {
    require("child_process").execFileSync(process.execPath, [path.join(__dirname, "wiring-notes.js"), outDir], { stdio: "ignore" });
  } catch (e) { console.log("[WARN] 台账生成失败（不影响 diagram.json）:", e.message); }
}
console.log(`[OK] v2 骨架 ${tpl.name}(${Math.round(tpl.w)}×${Math.round(tpl.h)}, 宽高比 ${tpl.aspect.toFixed(2)})｜模块 ${mods.length}｜连接 ${conns.length}｜输出 ${path.join(outDir, 'diagram.json')}`);
