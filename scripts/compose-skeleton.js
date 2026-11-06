#!/usr/bin/env node
/**
 * compose-skeleton.js — 布局引擎 v2 第 1 阶段：构图骨架（band 模型）
 *
 * 不摆任何元件、不画任何线——只回答「空间怎么分层、每层给多少」。
 * 这是 v2 重构的第一步：先定骨架，再由骨架推导元件坐标与走线方法，
 * 而不是在旧引擎的写死坐标（board 400/310、bb 0/100）上挪位置。
 *
 * 输出 skeleton.json：
 *   bands:  模块行 / 过渡通道 / 面包板 / UNO 各自的 {x0,x1,y0,y1}
 *   anchors: 面包板原点、UNO 原点、模块行起点
 *   strategy: 该骨架下推荐的走线方法（直落 / 阶梯 / 列总线 / 接力）
 *
 * 用法：node compose-skeleton.js <layout-intent.json> [--json]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sizes = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/sizes.json'), 'utf8')).sizes;
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/pins.json'), 'utf8'));

const BB = { half: { w: 328.8, h: 207.9 }, full: { w: 690.0, h: 207.9 } };
const BOARD_GAP = 60;      // 面包板底 → UNO 顶
const MOD_GAP = 40;        // 模块行 → 面包板顶
const MOD_SPACING = 40;    // 模块之间
const POWER_RE = /^(GND|5V|3V3|3\.3V|VIN|VCC|VDD|VBUS|VBAT)/i;

const file = process.argv[2];
if (!file) { console.error('用法: node compose-skeleton.js <layout-intent.json> [--json]'); process.exit(1); }
const intent = JSON.parse(fs.readFileSync(file, 'utf8'));
const asJson = process.argv.includes('--json');

const sizeOf = t => sizes[t] || { width: 20, height: 20 };
const typeOf = {}; intent.parts.forEach(p => { typeOf[p.id] = p.type; });

// ── 分类：模块 vs 可插接 ─────────────────────────────────
const mods = [], plugs = [];
for (const p of intent.parts || []) {
  const s = sizeOf(p.type);
  const small = s.width * s.height < 3600;
  if ((p.placement || 'bb') === 'bb' && small) plugs.push({ ...p, w: s.width, h: s.height });
  else mods.push({ ...p, w: s.width, h: s.height });
}

// ── 模块排序：按「其连接的板脚平均 x」升序（连左边脚的放左边）────
const boardPart = (intent.parts || []).find(p => /arduino|esp32|rp2040|franzininho/i.test(p.type));
const boardId = boardPart ? boardPart.id : 'uno';
const boardSize = sizeOf(boardPart ? boardPart.type : 'wokwi-arduino-uno');
const pinXOf = (id) => {
  const xs = [];
  for (const c of intent.connections || []) {
    const [a, b] = [String(c.from), String(c.to)];
    if (!a.startsWith(id + ':') && !b.startsWith(id + ':')) continue;
    const other = a.startsWith(id + ':') ? b : a;
    const [oid, opin] = other.split(':');
    if (oid !== boardId) continue;
    const pd = (pins[boardPart ? boardPart.type : 'wokwi-arduino-uno'] || {})[opin];
    if (Array.isArray(pd)) xs.push(pd[0]);
  }
  return xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 1e9;
};
mods.sort((a, b) => pinXOf(a.id) - pinXOf(b.id));

// ── band 堆叠（纵向三层 + 过渡通道）────────────────────────
const H_mod = mods.length ? Math.max(...mods.map(m => m.h)) : 0;
const W_mod = mods.reduce((a, m) => a + m.w + MOD_SPACING, 0) - (mods.length ? MOD_SPACING : 0);
const bbType = (intent.breadboard === 'wokwi-breadboard' || intent.breadboard === 'wokwi-breadboard-full')
  ? 'full' : 'half';
const bbSize = BB[bbType];
// ── 模板候选：纵向三层 vs L 形（手绘 ref1 形态），按「接近 1.3 宽高比」择优 ──
const TARGET_ASPECT = 1.3;
const templates = [];
// T1 纵向三层：模块 / 过渡 / 面包板 / UNO 自上而下
{
  const h = H_mod + 20 + MOD_GAP + bbSize.h + BOARD_GAP + boardSize.height;
  const w = Math.max(W_mod, bbSize.w, boardSize.width);
  templates.push({ name: 'T1 纵向三层', w, h });
}
// T2 L 形：UNO 左、面包板右、模块行在上（两者共用顶部）
{
  const w = boardSize.width + 40 + Math.max(bbSize.w, W_mod - boardSize.width - 40);
  const h = Math.max(H_mod + MOD_GAP + Math.max(bbSize.h, boardSize.height), boardSize.height + 40);
  templates.push({ name: 'T2 L形(板左右包板)', w, h });
}
templates.forEach(t => { t.aspect = t.w / t.h; t.score = Math.abs(t.aspect - TARGET_ASPECT); });
templates.sort((a, b) => a.score - b.score);
const chosen = templates[0];



const y0_mod = 0;
const y1_mod = y0_mod + H_mod;
const y0_corridor = y1_mod + 20;
const y1_corridor = y0_corridor + MOD_GAP;
const y0_bb = y1_corridor;
const y1_bb = y0_bb + bbSize.h;
const y0_board = y1_bb + BOARD_GAP;
const y1_board = y0_board + boardSize.height;

// 宽度：以「模块行」与「面包板」的较大者为画布宽，二者居中对齐
const W = Math.max(W_mod, bbSize.w, boardSize.width);
const cx = W / 2;
const bands = {
  moduleRow: { x0: Math.max(0, Math.round(cx - W_mod / 2)), x1: Math.round(cx + W_mod / 2), y0: y0_mod, y1: y1_mod },
  corridor: { x0: 0, x1: Math.round(W), y0: y0_corridor, y1: y1_corridor },
  breadboard: { x0: Math.round(cx - bbSize.w / 2), x1: Math.round(cx + bbSize.w / 2), y0: y0_bb, y1: y1_bb },
  board: { x0: Math.round(cx - boardSize.width / 2), x1: Math.round(cx + boardSize.width / 2), y0: y0_board, y1: y1_board },
};

// ── 走线策略（由骨架几何直接推出）──────────────────────────
const modPinsDown = mods.length > 0;                       // 模块引脚朝下正对面包板
const strategy = {
  moduleToBoard: (modPinsDown && bands.moduleRow.y1 + MOD_GAP >= bands.breadboard.y0)
    ? '直落：模块引脚 → 面包板列孔（短垂直），再由板脚 → 同列另一孔'
    : '阶梯 + 直落',
  power: '单点喂轨 + 末端桥接（板 → 一侧轨一次，桥接通另一侧）',
  busNets: '同网络 ≥3 消费者 → 一网一列（列总线）',
  longSignal: '跨越 >600 且中间有板 → 孔行接力（两段短垂直 + 板内连通）',
  note: mods.length === 0
    ? '无可插接至板外的模块：全部元件在面包板上，走线以列带为主'
    : '模块在 band0、面包板在 band2：模块引脚与板脚都正对同一列带',
};

const out = {
  schema: 'wokwi-layout-skeleton/1',
  input: file,
  canvas: { width: Math.round(W), height: Math.round(y1_board) },
  bands,
  anchors: {
    breadboard: { left: bands.breadboard.x0, top: bands.breadboard.y0, type: bbType },
    board: { left: bands.board.x0, top: bands.board.y0, type: boardPart ? boardPart.type : 'wokwi-arduino-uno' },
    moduleRow: { left: bands.moduleRow.x0, top: bands.moduleRow.y0, ids: mods.map(m => m.id) },
  },
  counts: { modules: mods.length, pluggable: plugs.length },
  strategy,
};

if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
console.log(`=== 构图骨架: ${path.basename(file)} ===`);
console.log(`画布 ${out.canvas.width} × ${out.canvas.height}（宽高比 ${(out.canvas.width / out.canvas.height).toFixed(2)}）`);
console.log(`模块 ${mods.length} 个 → band0 y ${bands.moduleRow.y0}..${bands.moduleRow.y1}（行宽 ${Math.round(W_mod)}）`);
console.log(`过渡通道       y ${bands.corridor.y0}..${bands.corridor.y1}`);
console.log(`面包板(${bbType}) y ${bands.breadboard.y0}..${bands.breadboard.y1}  x ${bands.breadboard.x0}..${bands.breadboard.x1}`);
console.log(`UNO            y ${bands.board.y0}..${bands.board.y1}  x ${bands.board.x0}..${bands.board.x1}`);
console.log(`模块顺序: ${mods.map(m => `${m.id}(${Math.round(pinXOf(m.id))})`).join(' → ') || '(无)'}`);
console.log(`走线策略: ${strategy.moduleToBoard}`);
console.log(`  ${strategy.note}`);
