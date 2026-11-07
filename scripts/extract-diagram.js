#!/usr/bin/env node
/**
 * extract-diagram.js — 从浏览器里的 Wokwi 编辑器**读回**当前 diagram.json
 * （wokwi-cdp.js 的逆操作：用户在图形界面改线后，Monaco 模型里就是最新 JSON）
 *
 * 用法：node extract-diagram.js <输出目录> [--port 9333]
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const OUT = args[0];
let PORT = 9333;
let i = 0;
while (i < args.length) { if (args[i] === '--port') PORT = +args[++i]; i++; }
if (!OUT) { console.error('用法: node extract-diagram.js <输出目录> [--port 9333]'); process.exit(1); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // 附着既有浏览器（不新启——要读的是用户正在编辑的页面）
  let target = null;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !target) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      target = list.find(t => t.type === 'page' && (t.url || '').includes('wokwi.com'));
    } catch (e) { /* 等口就绪 */ }
    if (!target) await sleep(500);
  }
  if (!target || !target.webSocketDebuggerUrl) { console.error('[ERROR] 未找到 wokwi.com 页签（浏览器开着吗？端口对吗？）'); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  };
  const send = (method, params = {}, timeoutMs = 15000) => new Promise((res, rej) => {
    const id = ++msgId; pending.set(id, { res, rej });
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`CDP ${method} 超时`)); } }, timeoutMs);
    const entry = pending.get(id);
    pending.set(id, { res: (v) => { clearTimeout(timer); entry.res(v); }, rej: (e) => { clearTimeout(timer); entry.rej(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (fn, ...fnArgs) => {
    const r = await send('Runtime.evaluate', {
      expression: `(${fn})(${fnArgs.map(a => JSON.stringify(a)).join(',')})`,
      awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate 失败');
    return r.result ? r.result.value : undefined;
  };

  // 先点开 diagram.json 标签（若未开），再从可见 JSON 编辑器读模型全文
  const text = await evaluate(() => {
    const grab = () => {
      if (typeof monaco === 'undefined' || !monaco.editor) return null;
      for (const ed of monaco.editor.getEditors()) {
        let el = ed.getDomNode(), visible = true;
        while (el && el !== document.body) {
          if (getComputedStyle(el).display === 'none') { visible = false; break; }
          el = el.parentElement;
        }
        if (visible && ed.getModel() && ed.getModel().getLanguageId() === 'json') {
          return ed.getModel().getValue();
        }
      }
      return null;
    };
    let t = grab();
    if (t) return t;
    const els = [...document.querySelectorAll('button, [role="tab"], .tab')];
    const btn = els.find(b => (b.textContent || '').trim().includes('diagram.json'));
    if (btn) btn.click();
    const start = Date.now();
    return new Promise((resolve) => {
      const iv = setInterval(() => {
        const v = grab();
        if (v != null || Date.now() - start > 10000) { clearInterval(iv); resolve(v); }
      }, 200);
    });
  });
  if (!text) { console.error('[ERROR] 未读到 diagram.json 编辑器（请确认 diagram.json 标签页存在）'); process.exit(2); }

  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, 'diagram.json');
  fs.writeFileSync(p, text.endsWith('\n') ? text : text + '\n', 'utf8');
  let nConn = '?', nParts = '?';
  try { const d = JSON.parse(text); nConn = (d.connections || []).length; nParts = (d.parts || []).length; } catch (e) { /* 保留原文 */ }
  console.log(`[OK] 已读回 ${p}（元件 ${nParts} / 连接 ${nConn}）`);
  process.exit(0);
})().catch(e => { console.error(`[ERROR] ${e.message}`); process.exit(1); });
