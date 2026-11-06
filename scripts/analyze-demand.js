#!/usr/bin/env node
/**
 * analyze-demand.js — 布局需求分析（放任何元件之前，从网表推出"要多少板、怎么排"）
 *
 * 为什么需要：现有生成器是"给定元件就直接摆"，面包板数量/朝向/位置是写死的，
 * 遇到大电路（更多元件、全尺寸板、多板拼接）就无从下手。本工具先在"方案层"
 * 算出需求画像，给生成器/模型一个可执行的开局：
 *
 *   元件画像：总数、可插接 vs 模块、总足迹面积、建议包围盒
 *   网络画像：网络数、电源网络扇出、总线网络（≥3 消费者）、最长跳数
 *   面包板需求：需要多少孔位、需要几块板（半/全）、怎么拼（并列/上下）
 *   走线策略：是否需要列总线（电源扇出大）、是否需要孔行接力（信号跨度大）
 *
 * 用法：node analyze-demand.js <layout-intent.json> [--json]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sizes = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/sizes.json'), 'utf8')).sizes;
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/pins.json'), 'utf8'));

const BB_CAP = {
  'wokwi-breadboard-half': { columns: 30, rows: 10, holes: 300, width: 328.8, height: 207.9 },
  'wokwi-breadboard': { columns: 63, rows: 10, holes: 630, width: 690.0, height: 207.9 },
};
const POWER_RE = /^(GND|5V|3V3|3\.3V|VIN|VCC|VDD|VBUS|VBAT)/i;

const file = process.argv[2];
if (!file) { console.error('用法: node analyze-demand.js <layout-intent.json> [--json]'); process.exit(1); }
const intent = JSON.parse(fs.readFileSync(file, 'utf8'));
const asJson = process.argv.includes('--json');

const parts = intent.parts || [];
const conns = intent.connections || [];
const typeOf = {};
parts.forEach(p => { typeOf[p.id] = p.type; });
const pinsOf = id => pins[typeOf[id]] || {};

// ── 元件画像 ──────────────────────────────────────────────
const detail = parts.map(p => {
  const s = sizes[p.type] || { width: 20, height: 20 };
  const pinNames = Object.keys(pins[p.type] || {}).filter(k => !k.startsWith('_'));
  // 可插接 = 声明上板 + 本体足够小（≥60×60 的模块没法插孔，只能走线）
  const small = s.width * s.height < 3600;
  const pluggable = (p.placement || 'bb') === 'bb' && small;
  return { id: p.id, type: p.type, w: s.width, h: s.height, area: s.width * s.height, pins: pinNames.length, pluggable, pinNames };
});
const totalArea = detail.reduce((a, p) => a + p.area, 0);
const plugArea = detail.filter(p => p.pluggable).reduce((a, p) => a + p.area, 0);
const modArea = totalArea - plugArea;
// 建议包围盒：按面积开方（近似正方形），再按元件平均长宽比修正
const avgAspect = detail.length ? detail.reduce((a, p) => a + p.w / p.h, 0) / detail.length : 1;
const boxSide = Math.sqrt(totalArea * 1.6);              // 1.6 = 元件间留白系数
const suggestBox = { w: Math.round(boxSide * Math.sqrt(avgAspect)), h: Math.round(boxSide / Math.sqrt(avgAspect)) };

// ── 网络画像（并查集） ────────────────────────────────────
const parent = {};
const find = x => { parent[x] = parent[x] || x; return parent[x] === x ? x : (parent[x] = find(parent[x])); };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
const refOf = c => (typeof c === 'string' ? c : `${c.from}→${c.to}`);
conns.forEach(c => union(c.from, c.to));
const nets = {};
for (const c of conns) {
  const r = find(c.from);
  (nets[r] = nets[r] || { pins: new Set(), conns: 0 });
  nets[r].pins.add(c.from); nets[r].pins.add(c.to);
  nets[r].conns++;
}
const netList = Object.values(nets).map(n => {
  const pinArr = [...n.pins];
  const fam = pinArr.map(p => {
    const [id, pin] = p.split(':');
    const pd = pinsOf(id);
    return (pd && POWER_RE.test(pin || '')) ? pin : null;
  }).find(Boolean);
  return { pins: pinArr, fanout: pinArr.length, power: !!fam, fam };
});
const powerNets = netList.filter(n => n.power);
const busNets = netList.filter(n => n.fanout >= 3);
// 电源扇出按家族聚合（同一家族可能被拆成多个网络：GND.1/GND.2）
const famFanout = {};
for (const n of powerNets) {
  const fam = (n.fam || '').replace(/\..*$/, '').toUpperCase();
  famFanout[fam] = (famFanout[fam] || 0) + n.fanout;
}

// ── 面包板需求 ────────────────────────────────────────────
const pluggableParts = detail.filter(p => p.pluggable);
const moduleParts = detail.filter(p => !p.pluggable);
// 模块↔板子 的连接数（每条接力要占 2 个孔：元件侧一个、板侧一个）
const isModule = id => moduleParts.some(m => m.id === id);
const boardId = parts.find(p => (pins[p.type] || {}) && /arduino|esp32|rp2040|franzininho/i.test(p.type));
const modToBoard = conns.filter(c => {
  const [fa, fb] = [String(c.from).split(':')[0], String(c.to).split(':')[0]];
  return (isModule(fa) && boardId && fb === boardId.id) || (isModule(fb) && boardId && fa === boardId.id);
}).length;
const plugHoles = pluggableParts.reduce((a, p) => a + Math.max(p.pins, 2), 0);
const holesNeeded = plugHoles + modToBoard * 2;      // 接力孔对
// 长度约束：模块排成一行时的总宽（超单板宽就要拼板）
const moduleRowWidth = moduleParts.reduce((a, p) => a + p.w + 40, 0);
const bbCands = ['wokwi-breadboard-half', 'wokwi-breadboard'];
const plan = bbCands.map(t => {
  const cap = BB_CAP[t];
  const byHoles = Math.ceil(holesNeeded / cap.holes);
  const byWidth = moduleRowWidth > cap.width * 1.15 ? Math.ceil(moduleRowWidth / (cap.width * 0.95)) : 1;
  return { type: t, boards: Math.max(1, byHoles, byWidth), holesPerBoard: cap.holes, width: cap.width, byHoles, byWidth };
}).sort((a, b) => a.boards - b.boards || (a.width - b.width));

// ── 策略判定 ──────────────────────────────────────────────
const maxFanout = Math.max(0, ...Object.values(famFanout));
const needColumnBus = maxFanout >= 3;                    // 电源家族 ≥3 脚 → 一网一列
const needRelay = detail.some(p => !p.pluggable) && conns.length > 8;  // 有模块 + 线多 → 孔行接力
const arrangement = plan[0].boards > 1
  ? (suggestBox.w >= suggestBox.h * 1.2 ? '横向并列（轨间桥接）' : '纵向堆叠（轨间桥接）')
  : '单块居中';
const suggestion = {
  breadboard: plan[0],
  arrangement,
  needColumnBus,
  needRelay,
  reason: {
    columnBus: needColumnBus ? `电源家族最大扇出 ${maxFanout} ≥3，应「一网一列」而非逐脚直连` : '电源扇出小，逐点直连即可',
    relay: needRelay ? `存在不可插接模块且连接 ${conns.length} 条，长信号线宜「孔行接力」切短` : '连接少，直连足够',
    boards: `可插接元件需 ${holesNeeded} 孔，${plan[0].type} 每块 ${plan[0].holesPerBoard} 孔 → ${plan[0].boards} 块`,
  },
};

const out = {
  schema: 'wokwi-layout-demand/1',
  input: file,
  parts: { total: detail.length, pluggable: pluggableParts.length, modules: detail.length - pluggableParts.length, totalArea: Math.round(totalArea), pluginArea: Math.round(plugArea), suggestBox },
  nets: { count: netList.length, powerNets: powerNets.length, busNets: busNets.length, maxFanout, famFanout },
  demand: suggestion,
  partsDetail: detail.map(p => `${p.id}(${p.type}, ${p.pluggable ? '可插' : '模块'}, ${Math.round(p.w)}×${Math.round(p.h)}, ${p.pins}脚)`),
};

if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
console.log(`=== 布局需求分析: ${path.basename(file)} ===`);
console.log(`元件 ${out.parts.total} 个（可插接 ${out.parts.pluggable} / 模块 ${out.parts.modules}），总足迹 ${out.parts.totalArea}，建议包围盒 ${suggestBox.w}×${suggestBox.h}（宽高比 ${(suggestBox.w / suggestBox.h).toFixed(2)}）`);
console.log(`网络 ${out.nets.count} 个（电源 ${out.nets.powerNets} / 总线型≥3 ${out.nets.busNets}），电源家族扇出: ${Object.entries(famFanout).map(([k, v]) => k + '=' + v).join(' ') || '无'}`);
console.log(`面包板: ${plan[0].boards} × ${plan[0].type}（需 ${holesNeeded} 孔 / 每块 ${plan[0].holesPerBoard} 孔），排布建议「${arrangement}」`);
console.log(`策略: 列总线=${needColumnBus ? '需要' : '不需要'}，孔行接力=${needRelay ? '需要' : '不需要'}`);
console.log(`  列总线: ${suggestion.reason.columnBus}`);
console.log(`  接力  : ${suggestion.reason.relay}`);
console.log(`  板数  : ${suggestion.reason.boards}`);
