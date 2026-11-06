#!/usr/bin/env node
/**
 * measure-parts.js — 元件真实渲染尺寸实测/校准器（CDP 附着页面，读 Wokwi 自己的 DOM）
 *
 * 原理：Wokwi 每个元件的根 <svg> 自带 width/height（多为 mm），且画布缩放可从父级
 * transform matrix 读到。1mm = 96/25.4 = 3.7795 个 diagram 单位（与 RFID 反算结果吻合）。
 * 因此「渲染包围盒 ÷ 缩放」与「mm × 3.7795」互为校验，两者一致才采信。
 *
 * 用法：浏览器开到目标项目（默认 9333 口）→ node scripts/measure-parts.js [--port 9333]
 * 目的：校准 references/common/sizes.json 里 board-* 的估计值（估计值偏小会让布局压叠、
 *      而 bench 因用同一份数据报「无重叠」= 假阴性）。
 */
const PORT = (() => { const i = process.argv.indexOf('--port'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 9333; })();
const MM2UNIT = 96 / 25.4;

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page' && (t.url || '').includes('wokwi.com'));
  if (!page) throw new Error('没有 wokwi.com 页签，请先打开目标项目');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const r = await new Promise((res, rej) => {
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id === 1) (m.error ? rej(new Error(m.error.message)) : res(m.result)); };
    ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate', params: {
        returnByValue: true,
        expression: `(() => {
          const out = [];
          for (const svg of document.querySelectorAll('svg')) {
            const wa = svg.getAttribute('width') || '';
            if (!wa.includes('mm')) continue;              // 只认元件根 svg（画布/图标没有 mm）
            const r = svg.getBoundingClientRect();
            let s = 1, el = svg;
            while (el && s === 1) {                        // 往上找最近的缩放 matrix
              const m = getComputedStyle(el).transform;
              if (m && m !== 'none') { const a = parseFloat(m.slice(7).split(',')[0]); if (a > 0.05 && a < 20) s = a; }
              el = el.parentElement;
            }
            const text = (svg.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30);
            out.push({ mmW: parseFloat(wa), mmH: parseFloat(svg.getAttribute('height') || '0'),
                       pxW: Math.round(r.width * 10) / 10, pxH: Math.round(r.height * 10) / 10, scale: s, text });
          }
          return out;
        })()`,
      },
    }));
  });
  ws.close();
  const rows = r.result.value;
  const seen = new Map();
  for (const v of rows) {
    const uW = Math.round(v.mmW * MM2UNIT * 10) / 10, uH = Math.round(v.mmH * MM2UNIT * 10) / 10;
    const fromPx = (v.scale !== 1) ? `${Math.round(v.pxW / v.scale)}×${Math.round(v.pxH / v.scale)}` : 'n/a';
    const key = `${uW}x${uH}`;
    if (!seen.has(key)) seen.set(key, { ...v, uW, uH, fromPx, n: 0 });
    seen.get(key).n++;
  }
  console.log('mm→unit(×3.7795)      渲染÷缩放        个数  画面文字');
  for (const v of seen.values()) {
    console.log(`${(v.uW + ' × ' + v.uH).padEnd(18)} ${v.fromPx.padEnd(14)} ${String(v.n).padStart(3)}   ${v.text}`);
  }
  console.log('\n提示：两列应基本一致（差 >2% 说明该 svg 含外边距，取 mm 列并注明）。');
})().catch(e => { console.error('[ERROR] ' + e.message); process.exit(1); });
