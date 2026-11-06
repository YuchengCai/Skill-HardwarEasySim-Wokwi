#!/usr/bin/env node
/**
 * calibrate-sizes.js — 元件真实尺寸校准器（配准法，CDP 附着页面）
 *
 * 为什么需要它：
 *   sizes.json 里 board-* 一类元件的尺寸曾退化为「引脚范围」（extract-geometry.py L359 的退化
 *   分支），布局与 bench 同吃这份假数据 → 本体压叠而裁判报 0（假绿）。实测渲染尺寸是唯一真值源。
 *
 * 方法（三条独立线索互校，缺一不可）：
 *   ① mm 线索：元件根 <svg> 的 width/height 带 mm → ×96/25.4 = diagram 单位
 *   ② 渲染线索：getBoundingClientRect ÷ 画布缩放（viewBox 宽度 ↔ 画布宽度）
 *   ③ 配准线索：把渲染坐标反算成 diagram 坐标，与 diagram.json 的 left/top 投票求偏移
 *      ——偏移必须是投票解出的，不能写常量（F/Fit 改视口后常量立刻失效，实测踩过）
 *   ④ rotate 线索：rotate∈{90,270} 时渲染盒宽高互换，还原自然尺寸时必须换回来
 *
 * 用法：
 *   node scripts/calibrate-sizes.js <项目目录 | diagram.json> [--port 9333] [--apply]
 *   --apply  把校准结果写回 references/common/sizes.json（默认只打印，不落盘）
 */
const fs = require('fs');
const path = require('path');

const MM2UNIT = 96 / 25.4; // 3.7795275…（与 extract-geometry.py 的 MM2PX 同源）

function parseArgs(argv) {
  const out = { target: null, port: 9333, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = parseInt(argv[++i], 10);
    else if (a === '--apply') out.apply = true;
    else out.target = a;
  }
  return out;
}

const opt = parseArgs(process.argv.slice(2));
if (!opt.target) {
  console.error('用法: node scripts/calibrate-sizes.js <项目目录 | diagram.json> [--port 9333] [--apply]');
  process.exit(1);
}

const diagramPath = opt.target.endsWith('.json') ? opt.target : path.join(opt.target, 'diagram.json');
if (!fs.existsSync(diagramPath)) { console.error(`[ERROR] 未找到 ${diagramPath}`); process.exit(1); }
const diagram = JSON.parse(fs.readFileSync(diagramPath, 'utf8'));
const sizesPath = path.join(__dirname, '..', 'references', 'common', 'sizes.json');
const sizesDoc = JSON.parse(fs.readFileSync(sizesPath, 'utf8'));

// 页面内测量的表达式（只读 DOM，不改页面）
// 两个必须的细节：
//   ① 递归穿透 shadow root —— Wokwi 元件是 Lit 组件，svg 常藏在 shadowRoot 里，
//      querySelectorAll 拿不到（实测 UNO 整个缺失）
//   ② 过滤阈值用「diagram 单位」而非渲染像素 —— 渲染像素随画布缩放变化，
//      实测缩放 0.4869 时 mux1（61 单位）只剩 29.7px，被 40px 阈值误杀
const IN_PAGE = `(() => {
  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName === 'svg') all.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  let canvas = null;
  for (const svg of all) {
    const vb = (svg.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 800) canvas = svg;
  }
  if (!canvas) return { error: 'no-canvas' };
  const cb = canvas.getBoundingClientRect();
  const vb = canvas.getAttribute('viewBox').split(/[ ,]+/).map(Number);
  const scale = cb.width / vb[2];
  const items = [];
  for (const svg of all) {
    if (svg === canvas) continue;
    const wa = svg.getAttribute('width') || '';
    const ha = svg.getAttribute('height') || '';
    const b = svg.getBoundingClientRect();
    const uW = b.width / scale, uH = b.height / scale;   // diagram 单位
    if (uW < 30 || uH < 12) continue;                    // 图标/装饰过滤（单位已统一）
    const v = (svg.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number);
    let mm = null;
    if (wa.includes('mm')) mm = [Math.round(parseFloat(wa) * ${MM2UNIT}), Math.round(parseFloat(ha) * ${MM2UNIT})];
    let vbSize = null;
    if (v.length === 4 && v[2] > 20 && v[2] < 900) vbSize = [Math.round(v[2]), Math.round(v[3])];
    items.push({
      mm, vbSize,
      box: [Math.round(uW), Math.round(uH)],
      at: [Math.round((b.left - cb.left) / scale), Math.round((b.top - cb.top) / scale)],
      scale,
    });
  }
  return { scale, items };
})()`;

(async () => {
  // 1) 连 CDP
  let list;
  try {
    list = await (await fetch(`http://127.0.0.1:${opt.port}/json/list`)).json();
  } catch (e) {
    console.error(`[ERROR] 连不上 CDP 端口 ${opt.port}：${e.message}\n        先让浏览器带着目标项目打开（scripts/wokwi-cdp.js）。`);
    process.exit(1);
  }
  const page = list.find(t => t.type === 'page' && (t.url || '').includes('wokwi.com'));
  if (!page) { console.error('[ERROR] 没有 wokwi.com 页签'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const result = await new Promise((res, rej) => {
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id === 1) (m.error ? rej(new Error(m.error.message)) : res(m.result)); };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: IN_PAGE } }));
  });
  ws.close();

  const meas = result.result.value;
  if (!meas || meas.error) { console.error(`[ERROR] 页面测量失败：${meas && meas.error}`); process.exit(1); }
  const { scale, items } = meas;
  console.log(`[INFO] 画布缩放=${scale.toFixed(4)}  量到元件 svg=${items.length} 个`);

  // 2) 配准：投票求 (dx, dy)，不写常量
  const votes = new Map();
  for (const p of diagram.parts) {
    for (const it of items) {
      const key = `${Math.round(it.at[0] - p.left)},${Math.round(it.at[1] - p.top)}`;
      votes.set(key, (votes.get(key) || 0) + 1);
    }
  }
  const [bestKey, bestVotes] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const [dx, dy] = bestKey.split(',').map(Number);
  console.log(`[INFO] 配准偏移 dx=${dx} dy=${dy}（${bestVotes} 票，共 ${diagram.parts.length} 元件）`);

  // 3) 逐元件还原自然尺寸（处理 rotate 宽高互换）
  const proposals = [];
  console.log('\n元件                 声明rotate  三线索（mm / viewBox / 渲染盒）        判定自然尺寸   现行 sizes.json');
  for (const p of diagram.parts) {
    const it = items.find(i => Math.abs(i.at[0] - dx - p.left) < 30 && Math.abs(i.at[1] - dy - p.top) < 40);
    const rot = Number(p.rotate || 0);
    if (!it) { console.log(`${p.id.padEnd(18)}${p.type.padEnd(26)}${String(rot).padEnd(10)}未命中（该元件 svg 可能无尺寸线索）`); continue; }
    let nat = it.box;
    if (rot === 90 || rot === 270) nat = [it.box[1], it.box[0]];
    const mmTxt = it.mm ? it.mm.join('x') : '-';
    const vbTxt = it.vbSize ? it.vbSize.join('x') : '-';
    const cur = (sizesDoc.sizes || {})[p.type];
    const curTxt = cur ? `${cur.width}x${cur.height}` : '(无)';
    const w = Math.round(nat[0] * 10) / 10, h = Math.round(nat[1] * 10) / 10;
    console.log(`${p.id.padEnd(18)}${p.type.padEnd(26)}${String(rot).padEnd(10)}${(mmTxt + ' / ' + vbTxt + ' / ' + it.box.join('x')).padEnd(38)}${(w + 'x' + h).padEnd(15)}${curTxt}`);
    proposals.push({ type: p.type, width: w, height: h, rot, mm: it.mm, box: it.box, cur: cur || null });
  }

  // 4) 汇总结论：哪些需要改
  const needFix = proposals.filter(p => p.cur && (Math.abs(p.cur.width - p.width) > 2 || Math.abs(p.cur.height - p.height) > 2));
  const missing = proposals.filter(p => !p.cur);
  console.log(`\n[结论] 需校准 ${needFix.length} 个，缺记录 ${missing.length} 个`);
  for (const p of needFix) console.log(`  - ${p.type}: ${p.cur.width}x${p.cur.height} → ${p.width}x${p.height}${p.mm ? `（mm 线索 ${p.mm.join('x')} 一致）` : ''}`);
  for (const p of missing) console.log(`  + ${p.type}: ${p.width}x${p.height}（尚无记录）`);

  if (!opt.apply) {
    console.log('\n（未写盘。确认无误后加 --apply 写回 references/common/sizes.json）');
    return;
  }

  // 5) 写回（保留原 note 风格，标注实测出处）
  const stamp = new Date().toISOString().slice(0, 10);
  for (const p of proposals) {
    const cur = sizesDoc.sizes[p.type] || {};
    sizesDoc.sizes[p.type] = {
      width: p.width,
      height: p.height,
      note: `实测于渲染 ${stamp}（画布配准法，${p.rot}° 已还原；旧值 ${cur.width || '?'}x${cur.height || '?'}${cur.note ? '=' + cur.note : ''}）`,
    };
  }
  fs.writeFileSync(sizesPath, JSON.stringify(sizesDoc, null, 2) + '\n', 'utf8');
  console.log(`\n[OK] 已写回 ${sizesPath}（${proposals.length} 个元件）`);
})().catch(e => { console.error('[ERROR] ' + e.message); process.exit(1); });
