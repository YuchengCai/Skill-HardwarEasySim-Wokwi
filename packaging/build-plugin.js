#!/usr/bin/env node
/**
 * build-plugin.js — 组装 Agent Plugins 可移植包（文档43/序列2）
 *
 * 输出：dist/plugin/（Agent Plugins 1.0.0 形状）
 *   plugin.json
 *   mcp.json
 *   skills/wokwi-arduino/SKILL.md
 *   skills/wokwi-arduino/scripts/       (运行时脚本，排除开发脚本)
 *   skills/wokwi-arduino/references/    (运行依赖资料，排除开发文档)
 *
 * 单一源：仓库根 plugin.json / mcp.json；SKILL.md 来自 skills/wokwi-arduino/SKILL.md；
 * scripts/references 来自仓库根目录（构建时复制进包，仓库本体不重复存放）。
 * 不用符号链接（跨平台/压缩包不保留），由本脚本复制。
 *
 * 用法：node packaging/build-plugin.js [--out dist/plugin] [--zip]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.join(ROOT, 'dist', 'plugin'));
const WANT_ZIP = args.includes('--zip');

const SKILL = 'wokwi-arduino';
const EXCLUDE_SCRIPTS = new Set([
  'run-tests.js', 'extract-components.py', 'fill-zh.py', 'extract-geometry.py',
  'extract-programmatic-pins.js', 'calibrate-sizes.js', 'measure-parts.js',
  'analyze-demand.js', 'compose-skeleton.js', 'iterate-layout.js', '__pycache__'
]);
const EXCLUDE_REFS = new Set(['handoff-layout-v2.md', 'routing-philosophy.md']);

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function copyTree(src, dst, filter) {
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === '__pycache__' || ent.name === '.DS_Store') continue;
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (filter && filter(ent.name)) continue;
    if (ent.isDirectory()) { n += copyTree(s, d, filter); }
    else { mkdirp(path.dirname(d)); fs.copyFileSync(s, d); n++; }
  }
  return n;
}

rmrf(OUT);
mkdirp(path.join(OUT, 'skills', SKILL));

// 1. manifest + mcp
fs.copyFileSync(path.join(ROOT, 'plugin.json'), path.join(OUT, 'plugin.json'));
fs.copyFileSync(path.join(ROOT, 'mcp.json'), path.join(OUT, 'mcp.json'));

// 2. 共享 SKILL.md（仓库内规范入口；适配器保留为旧入口）
const skillSrc = path.join(ROOT, 'skills', SKILL, 'SKILL.md');
if (!fs.existsSync(skillSrc)) { console.error('[ERR] 缺少规范入口: ' + skillSrc); process.exit(1); }
const skillDst = path.join(OUT, 'skills', SKILL, 'SKILL.md');
fs.copyFileSync(skillSrc, skillDst);

// 3. 运行时脚本 / 参考资料
const scriptCount = copyTree(path.join(ROOT, 'scripts'), path.join(OUT, 'skills', SKILL, 'scripts'), n => EXCLUDE_SCRIPTS.has(n));
const refCount = copyTree(path.join(ROOT, 'references'), path.join(OUT, 'skills', SKILL, 'references'), n => EXCLUDE_REFS.has(n));

// 4. 包内 README（安装与降级说明；不覆盖宿主官方安装文档）
fs.writeFileSync(path.join(OUT, 'README.md'), `# Wokwi Arduino Simulation (Agent Plugin)

Portable Agent Plugins 1.0.0 package generated from the source repo.

- Shared skill: \`skills/${SKILL}/SKILL.md\`
- Runtime scripts: \`skills/${SKILL}/scripts/\`
- Reference data: \`skills/${SKILL}/references/\`
- Optional browser MCP: \`mcp.json\` (Playwright MCP, stdio)

Install/update/authorization follow the host client's own plugin mechanism.
Hosts without a browser still get wiring guidance, text instructions and static SVG fallback.
Firmware flashing requires a local Agent with USB access; cloud preview only shows the diagram.
`);

console.log(`[OK] Agent Plugin 组装完成: ${OUT}`);
console.log(`     skills/${SKILL}/scripts: ${scriptCount} 文件`);
console.log(`     skills/${SKILL}/references: ${refCount} 文件`);

if (WANT_ZIP) {
  const { execFileSync } = require('child_process');
  const zipPath = path.join(ROOT, 'dist', `wokwi-arduino-plugin-v${require(path.join(__dirname, 'plugin.json')).version}.zip`);
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: 'ignore' });
    } else {
      execFileSync('zip', ['-qr', zipPath, '.'], { cwd: OUT, stdio: 'ignore' });
    }
    console.log(`[OK] zip: ${zipPath}`);
  } catch (e) {
    console.log('[WARN] zip 生成失败（可手动压缩 dist/plugin）:', e.message);
  }
}
