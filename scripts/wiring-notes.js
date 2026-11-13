// 跳线台账 v3：电气网络重建（并查集）+ 按网输出形态作用 + 跨电位类短路检查。
// 节点：板/元件引脚、bb 列（同列 5 孔 = 一节点，t/b 半区分开）、bb 轨
// 用法: node scripts/wiring-notes.js <projectDir> [--out file]
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('用法: node scripts/wiring-notes.js <projectDir>'); process.exit(1); }
const argi = process.argv.indexOf('--out');
const outFile = argi > 0 ? process.argv[argi + 1] : path.join(dir, 'wiring-notes.md');
const d = JSON.parse(fs.readFileSync(path.join(dir, 'diagram.json'), 'utf8'));

const nodeOf = (pin) => {
  const s = String(pin);
  let m = /^bb1:(\d+)([tb])\.[a-j]$/.exec(s);
  if (m) return `col:${m[1]}${m[2]}`;
  m = /^bb1:([tb][np])\.(\d+)$/.exec(s);
  if (m) return `rail:${m[1]}`;
  return `pin:${s}`;
};

const parent = new Map();
const find = (x) => { if (!parent.has(x)) parent.set(x, x); let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const nx = parent.get(x); parent.set(x, r); x = nx; } return r; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

const conns = d.connections.map((c, i) => ({ i, from: String(c[0]), to: String(c[1]), nf: nodeOf(c[0]), nt: nodeOf(c[1]) }));
for (const c of conns) union(c.nf, c.nt);

// 电位类：5V 与 VCC 同类；3.3V 单独；GND 单独。跨类被连通 = 疑似短路。
const CLASS_OF = { '5V': 'P5', 'VCC': 'P5', '3.3V': 'P33', 'GND': 'N', 'SDA': 'SDA', 'SCL': 'SCL' };
const NAME_OF = { P5: '5V/VCC', P33: '3.3V', N: 'GND', SDA: 'SDA', SCL: 'SCL' };
const PATTERNS = [
  [/\bGND\b|GND$/i, 'GND'],
  [/3\.3V|3V3/i, '3.3V'],
  [/(^|:)5V$/, '5V'],
  [/SDA/i, 'SDA'],
  [/SCL|SCK/i, 'SCL'],
  [/VCC|VIN/i, 'VCC'],
];
const labelOf = (pin) => { for (const [re, n] of PATTERNS) if (re.test(pin)) return n; return null; };

const compCls = new Map();
const pinsOf = new Map();
for (const c of conns) {
  for (const pin of [c.from, c.to]) {
    const root = find(nodeOf(pin));
    if (!pinsOf.has(root)) pinsOf.set(root, []);
    pinsOf.get(root).push(pin);
    const lab = labelOf(pin);
    if (!lab) continue;
    const cls = CLASS_OF[lab] || lab;
    const prev = compCls.get(root);
    if (prev && prev !== cls) compCls.set(root, `${prev}|${cls}`);
    else compCls.set(root, cls);
  }
}
const netName = (root) => {
  const raw = compCls.get(root);
  return raw ? raw.split('|').map(x => NAME_OF[x] || x).join(' + ') : '未命名';
};

const kindOf = (c) => {
  const f = c.from, t = c.to;
  const isBB = (x) => x.startsWith('bb1:');
  const isRail = (x) => /^bb1:[tb][np]\.\d+$/.test(x);
  const isHole = (x) => /^bb1:\d+[tb]\.[a-j]$/.test(x);
  const isBoard = (x) => x === 'uno' || x.startsWith('uno:');
  if (isRail(f) && isHole(t)) return '轨→列';
  if (isHole(f) && isRail(t)) return '列→轨';
  if (isHole(f) && isHole(t)) return '列↔列';
  if (isBoard(f) && isRail(t)) return '板脚→轨';
  if (isRail(f) && isBoard(t)) return '轨→板脚';
  if (isBoard(f) && isHole(t)) return '板脚→列';
  if (isRail(f) && isHole(t)) return '轨→列';
  if (isHole(f) && isHole(t)) return '列↔列';
  if (!isBB(f) && isHole(t)) return '元件→列';
  if (isHole(f) && !isBB(t)) return '列→元件';
  if (isBoard(f) && !isBB(t)) return '板→元件';
  if (!isBB(f) && isBoard(t)) return '元件→板';
  return '其它';
};

const byNet = new Map();
for (const c of conns) {
  const root = find(c.nf);
  const name = netName(root);
  if (!byNet.has(name)) byNet.set(name, { wires: [], pins: new Set() });
  const g = byNet.get(name);
  g.wires.push({ ...c, kind: kindOf(c) });
  g.pins.add(c.from); g.pins.add(c.to);
}

const PURPOSE = (kinds) => {
  const has = (k) => kinds.includes(k);
  if (has('列↔列') && (has('板脚→列') || has('轨→列'))) return '**母线中继**：入口 → 母线列 → 列↔列分发到各元件列';
  if (has('轨→列') && has('板脚→轨')) return '**列隔离**：板脚一根馈电到轨，每个元件列一根轨跳线';
  if (has('板脚→轨')) return '**电源干道**：板脚一根馈电，整条轨带电';
  if (has('元件→列')) return '元件直接落在 bb 列上（共用列）';
  return '直连（该网未上面包板）';
};

const L = [];
L.push('# 接线说明（自动生成）', '');
L.push(`> 依据 \`${path.basename(dir)}/diagram.json\` 做**电气网络重建**（列/轨/引脚为节点，线为边）后生成。`);
L.push('> 每节 = 一个电气网；「形态作用」说明这组线在结构上扮演什么角色，便于阅读与手改。', '');
const shorts = [];
for (const [name, g] of [...byNet.entries()].sort((a, b) => b[1].wires.length - a[1].wires.length)) {
  const kinds = g.wires.map(w => w.kind);
  if (name.includes('+')) shorts.push(name);
  L.push(`## 网：${name}（${g.wires.length} 根线 / ${g.pins.size} 个端点）`, '');
  L.push(`**形态作用**：${PURPOSE(kinds)}`, '');
  const byKind = {};
  for (const w of g.wires) (byKind[w.kind] = byKind[w.kind] || []).push(w);
  for (const [k, arr] of Object.entries(byKind)) {
    L.push(`- **${k}**：${arr.length} 根`);
    for (const w of arr) L.push(`  - \`${w.from}\` → \`${w.to}\``);
  }
  L.push('');
}
if (shorts.length) {
  L.push('## ⚠ 疑似短路（跨电位类连通）', '');
  for (const n of shorts) L.push(`- \`${n}\``);
  L.push('');
}
L.push('## 形态图例', '', '| 形态 | 含义 |', '|---|---|');
for (const [k, v] of [
  ['板脚→轨', '电源干道入口（一般每网一根）'],
  ['板脚→列', '板侧进入某列（该网在板侧的入口）'],
  ['轨→列', '给该列供电/接地（列隔离）'],
  ['列↔列', 'bb 内部跳线：把网送到另一列（母线中继/分发）'],
  ['元件→列', '元件引脚接入该列'],
]) L.push(`| ${k} | ${v} |`);

fs.writeFileSync(outFile, L.join('\n') + '\n', 'utf8');
console.log(`[OK] ${outFile}（${byNet.size} 个电气网 / ${d.connections.length} 根线${shorts.length ? ` / ⚠ 疑似短路 ${shorts.length}` : ''}）`);
