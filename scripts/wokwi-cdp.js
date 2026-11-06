#!/usr/bin/env node
/**
 * wokwi-cdp.js — 零依赖浏览器注入(Wokwi CDP 回退层,P1-C)
 *
 * 定位:wokwi-automate.js 的零依赖回退——不装 playwright,用系统 Edge/Chrome
 * 的 CDP 远程调试口(Node 18+ 内置 WebSocket + fetch)完成同样的事:
 * 打开 wokwi.com → 点 diagram.json 标签 → executeEdits 注入 → F(Fit) → 截图存档。
 * 浏览器进程独立(detached),脚本退出后窗口保留供用户查看/操作。
 *
 * 用法: node scripts/wokwi-cdp.js <project-dir> [--port 9222] [--edge <浏览器路径>]
 *   <project-dir> 需含 diagram.json(可选 sketch.ino:存在则一并注入)
 *
 * 设计依据:zcode 交接文档 D1-D3 实测(executeEdits 管线/F 键适配视口/零依赖 CDP)
 * 与 monaco-steps.md 注入序列同源(单一事实源:可见编辑器判定+executeEdits)。
 * 注入后验证状态:工程可视化由用户在浏览器确认(N10:视觉验证只能由 Wokwi 本体满足)。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
// 默认端口不用 9222:该端口是 DevTools 默认口,被安全软件/Chromium 防护定点拦截
// (实测 Windows 上 Edge 带 --remote-debugging-port=9222 启动即 STATUS_BREAKPOINT 崩溃)
let PORT = 9333, EDGE = null, DIR = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') PORT = parseInt(args[i + 1], 10);
  else if (args[i] === '--edge') EDGE = args[i + 1];
  else DIR = args[i];
}
if (!DIR) { console.error('用法: node scripts/wokwi-cdp.js <project-dir> [--port 9222] [--edge <path>]'); process.exit(1); }
DIR = path.resolve(DIR);
const diagramPath = path.join(DIR, 'diagram.json');
if (!fs.existsSync(diagramPath)) { console.error(`[ERROR] 未找到 ${diagramPath}`); process.exit(1); }
const diagramText = fs.readFileSync(diagramPath, 'utf8');
const sketchPath = path.join(DIR, 'sketch.ino');
const sketchText = fs.existsSync(sketchPath) ? fs.readFileSync(sketchPath, 'utf8') : null;

function findBrowser() {
  if (EDGE) return EDGE;
  const cands = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ---- 附着优先:先试连已存在的浏览器(用户侧守护进程/上次启动的实例) ----
  // 背景:沙箱内启动 Edge 会触发 msedge.dll 防护崩溃(STATUS_BREAKPOINT);
  // 沙箱内 HTTP/WebSocket 连接 127.0.0.1 正常。故「启动」留给用户侧,「连接」随处可做。
  async function tryAttach() {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      let page = list.find(t => t.type === 'page' && (t.url || '').includes('wokwi.com'));
      if (!page) {
        // 浏览器在但无 wokwi 页签 → 浏览器级 WebSocket 开新标签
        const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
        const bws = new WebSocket(v.webSocketDebuggerUrl);
        await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej; });
        await new Promise((res, rej) => {
          const id = 1; bws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) m.error ? rej(new Error(m.error.message)) : res(); };
          bws.send(JSON.stringify({ id, method: 'Target.createTarget', params: { url: 'https://wokwi.com/projects/new' } }));
        });
        await sleep(1500);
        const list2 = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        page = list2.find(t => t.type === 'page' && (t.url || '').includes('wokwi.com'));
      }
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (e) { /* 无守护进程,走启动路径 */ }
    return null;
  }
  let target = await tryAttach();
  let attached = !!target;

  if (!target) {
    const browser = findBrowser();
    if (!browser) { console.error('[ERROR] 无可附着的浏览器,且未找到 Edge/Chrome(用 --edge <路径> 指定)'); process.exit(1); }
    console.log(`[INFO] 启动浏览器: ${browser}`);
    // 启动(detached,stdio ignore——沙箱安全;每次全新 profile:复用旧 profile 会因
    // 残留会话锁/恢复对话框挡住新标签页——实测教训;--no-sandbox:受限进程环境(如 DSH
    // 沙箱)下 Chromium 自身沙箱会启动崩溃,标准解药;仅一次性自动化 profile,风险可接受
    const profileDir = path.join(DIR, `.cdp-profile-${Date.now()}`);
    fs.mkdirSync(profileDir, { recursive: true });
    const child = spawn(browser, [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      '--no-sandbox', '--disable-gpu',
      '--no-first-run', '--no-default-browser-check', '--disable-first-run-ui',
      '--window-size=1600,900',
      '--new-window', 'https://wokwi.com/projects/new',
    ], { stdio: 'ignore', detached: true });
    child.unref();
    console.log(`[INFO] 已启动(pid ${child.pid}),profile=${profileDir}`);
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const list = await r.json();
        const page = list.find(t => t.type === 'page' && (t.url || '').includes('wokwi.com'));
        if (page && page.webSocketDebuggerUrl) { target = page; break; }
      } catch (e) { /* 口未就绪,继续等 */ }
      await sleep(500);
    }
    if (!target) throw new Error('45s 内未等到 wokwi.com 页签的 CDP 目标');
  }
  console.log(`[INFO] CDP 已连(${attached ? '附着已存在的浏览器' : '新启动'}): ${target.url.substring(0, 60)}…`);

  // 极简 CDP 客户端
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  };
  ws.onclose = () => { for (const p of pending.values()) p.rej(new Error('WebSocket 已关闭(页面可能导航/关闭)')); pending.clear(); };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++msgId; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (fn, ...fnArgs) => {
    const r = await send('Runtime.evaluate', {
      expression: `(${fn})(${fnArgs.map(a => JSON.stringify(a)).join(',')})`,
      awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error('页面执行异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result && r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');

  // 等 monaco 就绪
  for (let i = 0; i < 60; i++) {
    const ok = await evaluate(() => !!(window.monaco && monaco.editor && monaco.editor.getEditors().length > 0));
    if (ok) break;
    if (i === 59) throw new Error('30s 内 monaco 未就绪');
    await sleep(500);
  }
  console.log('[INFO] monaco 就绪');

  // (可选)注入 sketch.ino
  if (sketchText) {
    const r1 = await evaluate((text) => {
      const editors = monaco.editor.getEditors();
      const editor = editors[0];
      if (!editor) return 'no-editor';
      const model = editor.getModel();
      editor.pushUndoStop();
      editor.executeEdits('wokwi-inject', [{ range: model.getFullModelRange(), text, forceMoveMarkers: true }]);
      editor.pushUndoStop();
      return 'ok';
    }, sketchText);
    console.log(`[INFO] sketch.ino 注入: ${r1}`);
  }

  // 点 diagram.json 标签 → 等可见 json 编辑器 → executeEdits 注入(与 monaco-steps.md 同源)
  const injectDiagram = async (text) => {
    const clicked = (() => {
      const els = [...document.querySelectorAll('button, [role="tab"], .tab')];
      const btn = els.find(b => (b.textContent || '').trim().includes('diagram.json'));
      if (btn) { btn.click(); return true; }
      return false;
    })();
    const jsonReady = () => new Promise((resolve) => {
      const start = Date.now();
      const t = setInterval(() => {
        for (const ed of monaco.editor.getEditors()) {
          let el = ed.getDomNode(), visible = true;
          while (el && el !== document.body) {
            if (getComputedStyle(el).display === 'none') { visible = false; break; }
            el = el.parentElement;
          }
          if (visible && ed.getModel() && ed.getModel().getLanguageId() === 'json') {
            clearInterval(t); resolve(ed); return;
          }
        }
        if (Date.now() - start > 15000) { clearInterval(t); resolve(null); }
      }, 200);
    });
    const ed = await jsonReady();
    if (!ed) return { tabClicked: clicked, editor: false };
    const model = ed.getModel();
    ed.pushUndoStop();
    ed.executeEdits('wokwi-inject', [{ range: model.getFullModelRange(), text, forceMoveMarkers: true }]);
    ed.pushUndoStop();
    return { tabClicked: clicked, editor: true };
  };
  const r2 = await evaluate(injectDiagram, diagramText);
  if (!r2 || !r2.editor) { console.error('[ERROR] diagram.json 注入失败:', JSON.stringify(r2)); process.exit(2); }
  console.log(`[INFO] diagram.json 注入成功(标签点击=${r2.tabClicked})`);

  // F(Fit) 适配视口(失败仅 WARN——用户可手按 F)
  try {
    await evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 });
    console.log('[INFO] 已派发 F(Fit)');
  } catch (e) { console.warn(`[WARN] Fit 派发失败(${e.message}),请在浏览器按 F`); }

  // 截图存档(10s 超时兜底,防 ws 悬死)
  try {
    const shot = await Promise.race([
      send('Page.captureScreenshot', { format: 'png' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('截图超时')), 10000)),
    ]);
    const out = path.join(DIR, 'wokwi-cdp-screenshot.png');
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`[INFO] 截图已存: ${out}`);
  } catch (e) { console.warn(`[WARN] 截图失败: ${e.message}`); }

  console.log('[OK] 注入完成——浏览器窗口已保留,请查看。可视化验证状态: UNVERIFIED(以你在浏览器中看到的为准,符合 N10 验证门)');
  process.exit(0);
})().catch(e => { console.error(`[ERROR] ${e.message}`); process.exit(1); });
