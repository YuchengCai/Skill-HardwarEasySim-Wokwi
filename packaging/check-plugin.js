#!/usr/bin/env node
/**
 * check-plugin.js — Agent Plugins 包结构检查 + 共享入口可执行冒烟（文档43/序列2）
 *
 * 用法：node packaging/check-plugin.js [--dir dist/plugin]
 * 退出码：0 全通过；1 有错误。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const dIdx = args.indexOf('--dir');
const DIR = path.resolve(dIdx >= 0 ? args[dIdx + 1] : path.join(ROOT, 'dist', 'plugin'));
const SKILL = 'wokwi-arduino';

const errors = [], oks = [], warns = [];
const ok = m => oks.push(m);
const err = m => errors.push(m);
const warn = m => warns.push(m);

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { err(`${p}: JSON 解析失败 ${e.message}`); return null; }
}
function walk(dir, base) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + ent.name : ent.name;
    if (ent.isDirectory()) out.push(...walk(path.join(dir, ent.name), rel));
    else out.push(rel);
  }
  return out;
}

// 0. 顶层结构
const top = fs.existsSync(DIR) ? fs.readdirSync(DIR).sort() : [];
if (!fs.existsSync(DIR)) { console.error(`[ERR] 目录不存在: ${DIR}`); process.exit(1); }
const allowedTop = new Set(['plugin.json', 'mcp.json', 'skills', 'README.md']);
for (const t of top) if (!allowedTop.has(t)) err(`顶层出现非标准条目: ${t}`);
if (!top.includes('plugin.json')) err('缺少 plugin.json');
ok(`顶层条目: ${top.join(', ')}`);

// 1. plugin.json（closed schema 的关键字段）
const mf = readJson(path.join(DIR, 'plugin.json'));
if (mf) {
  if (mf.$schema !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json') err('plugin.json $schema 不是 1.0.0');
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,62})[a-z0-9]$/.test(String(mf.name || ''))) err(`plugin.json name 非法: ${mf.name}`);
  if (String(mf.name).includes('--') || String(mf.name).includes('..')) err('plugin.json name 含 -- 或 ..');
  for (const k of ['version', 'description', 'license', 'homepage', 'repository', 'keywords']) if (k in mf) {
    const t = Array.isArray(mf[k]) ? 'array' : typeof mf[k];
    if (t !== (k === 'keywords' ? 'array' : 'string')) err(`plugin.json ${k} 类型应为 ${k === 'keywords' ? 'array' : 'string'}`);
  }
  if (mf.author && typeof mf.author !== 'object') err('plugin.json author 应为对象');
  ok(`plugin.json: name=${mf.name} version=${mf.version || '-'}`);
}

// 2. mcp.json（可选，closed 格式）
const mj = fs.existsSync(path.join(DIR, 'mcp.json')) ? readJson(path.join(DIR, 'mcp.json')) : null;
if (mj) {
  if (mj.$schema !== 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json') err('mcp.json $schema 不是 1.0.0');
  if (!mj.mcpServers || typeof mj.mcpServers !== 'object') err('mcp.json 缺 mcpServers');
  for (const [name, s] of Object.entries(mj.mcpServers || {})) {
    if (!['stdio', 'streamable-http', 'sse'].includes(s.type)) err(`mcp.json ${name}: type 非法`);
    if (s.type === 'stdio' && !s.command) err(`mcp.json ${name}: stdio 缺 command`);
    if ((s.type === 'streamable-http' || s.type === 'sse') && !/^https?:\/\//.test(String(s.url || ''))) err(`mcp.json ${name}: url 非法`);
  }
  ok(`mcp.json: ${Object.keys(mj.mcpServers || {}).join(', ')}`);
} else warn('未提供 mcp.json（宿主无浏览器能力时依赖用户选择 SVG/文字）');

// 3. skills/<name>/SKILL.md + 资源解析
const skillDir = path.join(DIR, 'skills', SKILL);
const skillMd = path.join(skillDir, 'SKILL.md');
if (!fs.existsSync(skillMd)) err(`缺少 skills/${SKILL}/SKILL.md`);
else {
  const md = fs.readFileSync(skillMd, 'utf8');
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) err('SKILL.md 缺 YAML frontmatter');
  else {
    for (const k of ['name', 'description']) {
      if (!new RegExp('^' + k + ':\\s*\\S', 'm').test(fm[1])) err(`SKILL.md frontmatter 缺 ${k}`);
    }
    ok('SKILL.md frontmatter: name/description 存在');
  }
  const pkgFiles = walk(skillDir, '');
  const refTokens = [...new Set([...md.matchAll(/@references\/([A-Za-z0-9._<>\-]+)/g)].map(m => m[1]))];
  const missingRefs = refTokens.filter(t => {
    if (t.includes('<')) {
      const re = new RegExp('^' + t.split(/(<[^>]+>)/).map(p => p.startsWith('<') ? '[A-Za-z0-9._-]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$');
      return !pkgFiles.some(f => f.startsWith('references/') && re.test(path.basename(f)));
    }
    return !pkgFiles.includes('references/' + t);
  });
  if (missingRefs.length) err(`失效 @references: ${missingRefs.join(', ')}`);
  else ok(`@references 引用 ${refTokens.length} 个全部可解析`);

  const scriptTokens = [...new Set([...md.matchAll(/scripts\/([A-Za-z0-9._-]+)/g)].map(m => m[1]))];
  const missingScripts = scriptTokens.filter(t => !fs.existsSync(path.join(skillDir, 'scripts', t)));
  if (missingScripts.length) err(`失效 scripts: ${missingScripts.join(', ')}`);
  else ok(`scripts 提及 ${scriptTokens.length} 个全部可解析`);
  ok(`包内文件: ${pkgFiles.length} 个`);
}

// 4. 共享入口可执行冒烟：用包内脚本跑一个真实 intent（引用从 __dirname 解析）
const gen = path.join(skillDir, 'scripts', 'layout-generator.js');
const check = path.join(skillDir, 'scripts', 'check-required.js');
const intent = path.join(ROOT, 'tests', 'cases', 'req-bb-locked', 'intent.json');
if (fs.existsSync(gen) && fs.existsSync(check) && fs.existsSync(intent)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wokwi-plugin-'));
  // 沙箱兼容：子进程 stdout 走文件句柄，不用管道（受限环境下管道会 EPERM）
  const run = (argsArr, logName) => {
    const log = path.join(tmp, logName);
    const fd = fs.openSync(log, 'w');
    let res;
    try { res = spawnSync(process.execPath, argsArr, { stdio: ['ignore', fd, fd] }); }
    finally { fs.closeSync(fd); }
    let out = '';
    try { out = fs.readFileSync(log, 'utf8'); } catch (e) { /* ignore */ }
    return { status: res.status, out };
  };
  const r1 = run([gen, intent, tmp], 'gen.log');
  const r2 = run([check, intent, '--dir', tmp], 'check.log');
  if (r1.status !== 0) err(`包内 layout-generator 执行失败(exit ${r1.status}): ${r1.out.slice(-300)}`);
  else if (r2.status !== 0) err(`包内 check-required 执行失败(exit ${r2.status}): ${r2.out.slice(-300)}`);
  else ok('共享入口冒烟: layout-generator + check-required 在包内可执行并通过');
  fs.rmSync(tmp, { recursive: true, force: true });
} else warn('缺少冒烟所需文件（scripts/check-required.js 或测试 intent）');

// 报告
console.log(`===== Agent Plugin 结构检查: ${DIR} =====`);
for (const m of oks) console.log('  ✔ ' + m);
for (const m of warns) console.log('  ⚠ ' + m);
for (const m of errors) console.log('  ✘ ' + m);
console.log(`\n结果: ${oks.length} ok, ${warns.length} warn, ${errors.length} error`);
process.exit(errors.length ? 1 : 0);
