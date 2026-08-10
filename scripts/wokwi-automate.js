#!/usr/bin/env node
/**
 * wokwi-automate.js — Wokwi 网页自动化仿真脚本 (v0.4.4)
 *
 * 功能：用 Playwright 驱动真实浏览器，自动完成
 *   打开 Wokwi 新项目页 → 填 .ino 代码 → 切 diagram.json 填电路图 → 启动仿真
 *
 * 用法：
 *   node wokwi-automate.js <项目目录>
 *   node wokwi-automate.js <项目目录> --headless
 *
 * 依赖：
 *   npm i playwright        （浏览器库）
 *   - 浏览器自动回退链：系统 Chrome → 系统 Edge → Playwright 自带 Chromium
 *
 * 设计守则（见 SKILL.md）：
 *   - 本脚本只负责"填和点"（机械动作），不生成代码/电路图
 *   - 任何一步失败 → 打印分步错误 → 退出非零码 → agent 降级原生操作
 *
 * 退出码约定：
 *   0  = 全部成功
 *   1  = 参数错误 / 文件缺失
 *   2  = 打开页面失败
 *   3  = Monaco 编辑器未就绪
 *   4  = 填入代码失败
 *   5  = 切换到 diagram.json 失败
 *   6  = 填入电路图失败
 *   7  = 启动仿真失败
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ============================================================
// 参数解析
// ============================================================
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('[FATAL] 用法: node wokwi-automate.js <项目目录> [--headless]');
  process.exit(1);
}

const PROJECT_DIR = path.resolve(args[0]);
const HEADLESS = args.includes('--headless');

// ============================================================
// 读取项目文件
// ============================================================
function loadProject() {
  const dirName = path.basename(PROJECT_DIR);
  const inoPath = path.join(PROJECT_DIR, `${dirName}.ino`);
  const diagramPath = path.join(PROJECT_DIR, 'diagram.json');

  if (!fs.existsSync(inoPath)) {
    console.error(`[FATAL] 未找到 ${dirName}.ino（.ino 必须与目录同名）`);
    process.exit(1);
  }
  if (!fs.existsSync(diagramPath)) {
    console.error(`[FATAL] 未找到 diagram.json`);
    process.exit(1);
  }

  return {
    ino: fs.readFileSync(inoPath, 'utf-8'),
    diagram: JSON.parse(fs.readFileSync(diagramPath, 'utf-8')),
  };
}

// ============================================================
// 浏览器启动（回退链: Chrome → Edge → Chromium）
// ============================================================
async function launchBrowser() {
  const channels = ['chrome', 'msedge', null]; // null = Playwright 自带
  for (const channel of channels) {
    try {
      const opts = { headless: HEADLESS };
      if (channel) opts.channel = channel;
      const browser = await chromium.launch(opts);
      const name = channel ? `系统 ${channel}` : 'Playwright Chromium';
      console.log(`[INFO] 已启动浏览器: ${name}`);
      return browser;
    } catch (e) {
      console.log(`[WARN] ${channel ? channel : 'chromium'} 不可用，尝试下一个...`);
    }
  }
  console.error('[FATAL] 所有浏览器都无法启动，请安装 Chrome/Edge 或运行 npx playwright install chromium');
  process.exit(2);
}

// ============================================================
// Monaco 等待与操作
// ============================================================
async function waitMonaco(page, timeoutMs = 15000) {
  return page.evaluate((timeout) => new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (typeof monaco !== 'undefined' && monaco.editor && monaco.editor.getEditors().length > 0) {
        clearInterval(t);
        resolve(true);
      } else if (Date.now() - start > timeout) {
        clearInterval(t);
        reject(new Error('monaco not ready'));
      }
    }, 200);
  }), timeoutMs);
}

// 获取当前可见的 Monaco 编辑器（跳过 display:none 的隐藏编辑器）
async function getVisibleEditor(page) {
  return page.evaluate(() => {
    const editors = monaco.editor.getEditors();
    for (const ed of editors) {
      const dom = ed.getDomNode();
      let el = dom;
      let visible = true;
      while (el && el !== document.body) {
        if (getComputedStyle(el).display === 'none') { visible = false; break; }
        el = el.parentElement;
      }
      if (visible) return ed;
    }
    return null;
  });
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const project = loadProject();

  console.log(`[1/5] 打开 Wokwi 新项目页...`);
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await page.goto('https://wokwi.com/projects/new/arduino-uno', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    console.log(`[OK]   页面已打开: ${page.url()}`);
  } catch (e) {
    console.error(`[ERR]  打开页面失败: ${e.message}`);
    await browser.close();
    process.exit(2);
  }

  // --- 步骤 2: 等待 Monaco ---
  console.log(`[2/5] 等待 Monaco 编辑器就绪...`);
  try {
    await waitMonaco(page);
    console.log(`[OK]   Monaco 已就绪`);
  } catch (e) {
    console.error(`[ERR]  Monaco 未就绪: ${e.message}`);
    await browser.close();
    process.exit(3);
  }

  // --- 步骤 3: 填入 sketch.ino ---
  console.log(`[3/5] 填入 sketch.ino 代码...`);
  try {
    await page.evaluate((code) => {
      const editors = monaco.editor.getEditors();
      editors[0].setValue(code);
    }, project.ino);
    console.log(`[OK]   代码已填入 (${project.ino.split('\n').length} 行)`);
  } catch (e) {
    console.error(`[ERR]  填入代码失败: ${e.message}`);
    await browser.close();
    process.exit(4);
  }

  // --- 步骤 4: 切换 diagram.json 并填入电路图 ---
  console.log(`[4/5] 切换到 diagram.json 并填入电路图...`);
  try {
    // 点击 diagram.json 标签
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'diagram.json');
      if (!btn) throw new Error('diagram.json tab not found');
      btn.click();
    });

    // 轮询等待可见编辑器语言变为 json
    const jsonReady = await page.evaluate(() => new Promise((resolve) => {
      const start = Date.now();
      const t = setInterval(() => {
        const editors = monaco.editor.getEditors();
        for (const ed of editors) {
          const dom = ed.getDomNode();
          let el = dom, visible = true;
          while (el && el !== document.body) {
            if (getComputedStyle(el).display === 'none') { visible = false; break; }
            el = el.parentElement;
          }
          if (visible && ed.getModel() && ed.getModel().getLanguageId() === 'json') {
            clearInterval(t);
            resolve(ed);
            return;
          }
        }
        if (Date.now() - start > 15000) { clearInterval(t); resolve(null); }
      }, 200);
    }));

    if (!jsonReady) throw new Error('json editor not visible');

    await page.evaluate((diagram) => {
      // 重新获取 json 编辑器（闭包内不能用上面的引用）
      const editors = monaco.editor.getEditors();
      for (const ed of editors) {
        const dom = ed.getDomNode();
        let el = dom, visible = true;
        while (el && el !== document.body) {
          if (getComputedStyle(el).display === 'none') { visible = false; break; }
          el = el.parentElement;
        }
        if (visible && ed.getModel() && ed.getModel().getLanguageId() === 'json') {
          ed.setValue(JSON.stringify(diagram, null, 2));
          break;
        }
      }
    }, project.diagram);
    console.log(`[OK]   电路图已填入`);
  } catch (e) {
    console.error(`[ERR]  填入电路图失败: ${e.message}`);
    await browser.close();
    process.exit(5);
  }

  // --- 步骤 5: 启动仿真 ---
  console.log(`[5/5] 启动仿真...`);
  try {
    await page.getByRole('button', { name: 'Start the simulation' }).click();
    console.log(`[OK]   仿真已启动！`);
    console.log(`[INFO] 请在浏览器窗口中观察 LED 行为，串口输出见页面底部面板`);
  } catch (e) {
    console.error(`[ERR]  启动仿真失败: ${e.message}`);
    await browser.close();
    process.exit(6);
  }

  // 保持浏览器打开供用户观察（不关闭）
  console.log(`[DONE] 浏览器窗口保持打开，由用户观察验证。`);
}

main().catch((e) => {
  console.error(`[FATAL] 未预期错误: ${e.message}`);
  process.exit(1);
});
