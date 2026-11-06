/**
 * verify-wires.js — 渲染契约验证：Wokwi 画的线端点 vs 我们计算的引脚位置
 * 方法：对每条可见连线，取渲染路径的首/尾坐标（向量），与按 geometry.json v0.2 +
 * pins.json 算出的两端点向量比对。两向量相等 ⇔ 契约成立（全局平移被向量差消除）。
 */
const fs = require('fs');
const path = require('path');

const DIR = process.argv[2];
const PORT = 9333;
const ROOT = path.join(__dirname, '..');

const diagram = JSON.parse(fs.readFileSync(path.join(DIR, 'diagram.json'), 'utf8'));
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/pins.json'), 'utf8'));
const sizes = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/sizes.json'), 'utf8')).sizes;
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/common/geometry.json'), 'utf8')).breadboard;

const normRot = r => { const n = Math.round(r || 0) % 360; return n < 0 ? n + 360 : n; };

function partSize(type) {
  const s = sizes[type];
  return s ? { width: s.width, height: s.height } : { width: 20, height: 20 };
}

// 与 score-diagram.js 同构的 pinPosition（rot0 公式 + rot180 翻转 / rot90 _rot90）
function pinPosition(part, pinName) {
  const x = part.left || 0, y = part.top || 0;
  const type = part.type || '';
  const rot = normRot(part.rotate);
  if (type.includes('breadboard')) {
    let ox = null, oy = null;
    const mHole = String(pinName).match(/^(\d+)([tb])\.([a-j])$/);
    const mRail = String(pinName).match(/^([tb])([pn])\.(\d+)$/);
    if (mHole) {
      const n = parseInt(mHole[1], 10);
      const li = mHole[3].charCodeAt(0) - 97;
      ox = geo.hole.offsetX + (n - 1) * geo.pitch;
      oy = geo.hole.offsetY + li * geo.pitch + (mHole[2] === 'b' ? geo.hole.halfBOffset : 0);
    } else if (mRail) {
      const idx = parseInt(mRail[3], 10) - 1;
      const grp = geo.rail.groupSize;
      ox = geo.rail.xLeftRot0 + (idx + Math.floor(idx / grp)) * geo.pitch;
      const Y = geo.rail.yRot180;
      oy = Y[mRail[1] + mRail[2]];
    }
    if (ox != null) {
      if (rot === 180) return { x: x + geo.width - ox, y: y + geo.height - oy };
      return { x: x + ox, y: y + oy };
    }
    return { x: x + geo.width / 2, y: y + geo.height / 2 };
  }
  const pd = pins[type];
  if (pd) {
    if ((rot === 90 || rot === 270) && pd._rot90 && pd._rot90[pinName]) {
      const o = pd._rot90[pinName];
      return { x: x + o[0], y: y + o[1] };
    }
    const o = pd[pinName];
    if (Array.isArray(o)) {
      if (rot === 0) return { x: x + o[0], y: y + o[1] };
      const s = partSize(type);
      const cx = x + s.width / 2, cy = y + s.height / 2;
      const dx = o[0] - s.width / 2, dy = o[1] - s.height / 2;
      if (rot === 90) return { x: cx - dy, y: cy + dx };
      if (rot === 180) return { x: cx - dx, y: cy - dy };
      if (rot === 270) return { x: cx + dy, y: cy - dx };
    }
  }
  return null;
}

const conns = (diagram.connections || []).filter(c => !(c[3] || []).includes('$bb'));

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page' && (t.url || '').includes('wokwi.com'));
  if (!page) throw new Error('no wokwi tab');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  const r = await withTimeout(new Promise((res, rej) => {
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id === 1) { m.error ? rej(new Error(m.error.message)) : res(m.result); } };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: `(() => {
      const all = [];
      const walk = (root) => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'svg') all.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
      walk(document);
      let canvas = null;
      for (const s of all) { const vb = (s.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number); if (vb.length === 4 && vb[2] > 800) canvas = s; }
      if (!canvas) return { error: 'no-canvas' };
      // 线层 = 大 canvas 里的 path（排除零件内部 svg——那些不在 canvas 里）
      const wires = [];
      for (const p of canvas.querySelectorAll('path')) {
        const d = p.getAttribute('d') || '';
        const nums = d.match(/-?\\d+(\\.\\d+)?/g);
        if (!nums || nums.length < 4) continue;
        const m1 = d.match(/^M\\s*(-?\\d+(?:\\.\\d+)?)[ ,]+(-?\\d+(?:\\.\\d+)?)/);
        const last = d.trim().split(/(?=[MLCZAQ])/).pop().match(/(-?\\d+(?:\\.\\d+)?)[ ,]+(-?\\d+(?:\\.\\d+)?)\\s*$/);
        if (!m1 || !last) continue;
        wires.push({ a: [parseFloat(m1[1]), parseFloat(m1[2])], b: [parseFloat(last[1]), parseFloat(last[2])] });
      }
      return { nWires: wires.length, wires };
    })()` } }));
  }), 15000);
  ws.close();

  const wires = r.result.value.wires;
  console.log(`渲染线: ${wires.length} 条；待核对连接: ${conns.length} 条（$bb 已排除）`);
  let ok = 0, bad = 0, worst = null;
  for (const c of conns) {
    const [from, to] = c;
    const fp = diagram.parts.find(p => p.id === from.split(':')[0]);
    const tp = diagram.parts.find(p => p.id === to.split(':')[0]);
    const A = fp && pinPosition(fp, from.split(':')[1]);
    const B = tp && pinPosition(tp, to.split(':')[1]);
    if (!A || !B) { console.log(`  [skip] ${from} -> ${to}（引脚模型缺失）`); continue; }
    const vx = B.x - A.x, vy = B.y - A.y;
    // 找端点向量最接近的渲染线（不区分方向）
    let bestErr = Infinity, bestWire = null;
    for (const w of wires) {
      const e1 = Math.hypot((w.b[0] - w.a[0]) - vx, (w.b[1] - w.a[1]) - vy);
      const e2 = Math.hypot((w.a[0] - w.b[0]) - vx, (w.a[1] - w.b[1]) - vy);
      const e = Math.min(e1, e2);
      if (e < bestErr) { bestErr = e; bestWire = w; }
    }
    const tag = bestErr <= 1.5 ? 'OK ' : 'BAD';
    if (bestErr <= 1.5) ok++; else { bad++; }
    if (!worst || bestErr > worst.err) worst = { err: bestErr, conn: `${from} -> ${to}` };
    if (bestErr > 1.5) console.log(`  [${tag}] ${from} -> ${to}  端点向量误差=${bestErr.toFixed(2)}（算=${vx.toFixed(1)},${vy.toFixed(1)} 渲=${(bestWire.b[0]-bestWire.a[0]).toFixed(1)},${(bestWire.b[1]-bestWire.a[1]).toFixed(1)}）`);
  }
  console.log(`\n契约核对: ${ok} 条 OK / ${bad} 条超差（阈值 1.5 单位）；最大误差 ${worst ? worst.err.toFixed(2) + ' @ ' + worst.conn : '-'}`);
  process.exit(bad > 0 ? 1 : 0);
})().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
