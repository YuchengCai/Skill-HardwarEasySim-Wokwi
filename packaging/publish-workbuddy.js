#!/usr/bin/env node
/**
 * publish-workbuddy.js — WorkBuddy 开放平台「技能」包生成器
 * ==============================================================
 * 从开发仓库(wokwi-skill)冻结副本生成符合 WorkBuddy 开放平台格式的技能包:
 *   skills/wokwi-arduino/
 *     SKILL.md      (frontmatter 扩展 + 正文路径改写)
 *     references/   (全量扁平化:不允许二级目录)
 *     scripts/      (平铺复制,排除 __pycache__)
 * 并打包 zip + 输出预检报告。开发仓库本体零改动。
 *
 * 用法:
 *   node publish-workbuddy.js [--source <dir>] [--out <dir>] [--no-wrap] [--skip-zip]
 *     --source   源仓库目录(默认 ./source)
 *     --out      输出目录(默认 ./dist)
 *     --no-wrap  zip/暂存不加 skills/ 顶层目录(平台解析失败时的备用形状)
 *     --skip-zip 只生成目录结构,不打包 zip
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ---------- 配置(上传前需人工确认 author / version) ----------
const SKILL_NAME = 'wokwi-arduino';
const VERSION = '0.6.1';
const AUTHOR = 'YuchengCai'; // 上传前可按需调整(合作方名称)
const DISPLAY_NAME = 'Wokwi Arduino Simulation';
const DESCRIPTION = 'Create, compile, simulate, and upload Arduino projects with Wokwi. Use when the user mentions Arduino, Wokwi, 单片机, 嵌入式, or when .ino / wokwi.toml / diagram.json files are detected.';
const DESCRIPTION_ZH = '创建、编译、仿真并上传 Arduino 项目(Wokwi)。当用户提到 Arduino、Wokwi、单片机、嵌入式,或检测到 .ino / wokwi.toml / diagram.json 文件时使用。';
const DESCRIPTION_EN = 'Create, compile, simulate and upload Arduino projects with Wokwi. Use when the user mentions Arduino, Wokwi, 单片机, 嵌入式, or when .ino / wokwi.toml / diagram.json files are detected.';

// ---------- 参数 ----------
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
const hasFlag = f => args.includes(f);
const SOURCE = getArg('--source', 'source');
const OUT = getArg('--out', 'dist');
const NO_WRAP = hasFlag('--no-wrap');
const SKIP_ZIP = hasFlag('--skip-zip');

// ---------- 文件工具 ----------
function mkdirp(d) { fs.mkdirSync(d, { recursive: true }); }
function rmrf(d) { fs.rmSync(d, { recursive: true, force: true }); }
function copyFile(src, dst) {
  mkdirp(path.dirname(dst));
  fs.copyFileSync(src, dst);
}
/** 递归收集文件(排除 __pycache__),rel 为 POSIX 相对路径 */
function walkFiles(dir, base) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '__pycache__' || ent.name === '.DS_Store') continue;
    const abs = path.join(dir, ent.name);
    const rel = base ? base + '/' + ent.name : ent.name;
    if (ent.isDirectory()) out.push(...walkFiles(abs, rel));
    else out.push({ abs, rel });
  }
  return out;
}
/** 递归收集目录(相对路径),用于预检「不允许二级目录」 */
function walkDirs(dir, base) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '__pycache__' || ent.name === '.DS_Store') continue;
    if (ent.isDirectory()) {
      const rel = base ? base + '/' + ent.name : ent.name;
      out.push(rel);
      out.push(...walkDirs(path.join(dir, ent.name), rel));
    }
  }
  return out;
}

// ---------- zip 写入(纯 node,stored 模式,UTF-8) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosDateTime(d) {
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
}
function writeZip(rootDir, zipPath) {
  const files = walkFiles(rootDir);
  const chunks = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    const crc = crc32(data);
    const nameBuf = Buffer.from(f.rel, 'utf8');
    const { date, time } = dosDateTime(fs.statSync(f.abs).mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    chunks.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...chunks, ...centrals, eocd]));
  return { files: files.length, size: fs.statSync(zipPath).size };
}

// ---------- SKILL.md 改写 ----------
function buildSkillMd(srcPath) {
  let md = fs.readFileSync(srcPath, 'utf8');

  // 1. frontmatter 扩展(平台必填:description/description_zh/description_en/version/author)
  const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!fmMatch) throw new Error('SKILL.md 缺少 YAML frontmatter');
  const getFm = k => {
    const m = fmMatch[1].match(new RegExp('^' + k + ':\\s*(.+)$', 'm'));
    return m ? m[1].trim() : '';
  };
  const newFm = [
    '---',
    'name: ' + getFm('name'),
    'display_name: ' + DISPLAY_NAME,
    'description: ' + DESCRIPTION,
    'description_zh: ' + DESCRIPTION_ZH,
    'description_en: ' + DESCRIPTION_EN,
    'version: ' + VERSION,
    'author: ' + AUTHOR,
    '---',
    '',
  ].join('\n');
  md = md.replace(fmMatch[0], newFm);

  // 2. 标题与导语已是产品化文案(0.6.0 适配器),无需替换

  // 3. 简写路径补齐(正文里不带 references/ 前缀的提及)
  md = md.replace(/→ `components\.md` → `detail\/<type>\.json`/g, '→ `references/arduino-components.md` → `references/arduino-detail-<type>.json`');
  md = md.replace(/→ components\.md → detail\//g, '→ references/arduino-components.md → references/arduino-detail-<type>.json');
  md = md.replace(/（index\.json 查不到）/g, '（references/arduino-index.json 查不到）');

  // 4. 嵌套路径 → 扁平路径(顺序敏感:先 detail 后 arduino,先 layout-cards 后 common)
  const RULES = [
    // 目录级提及(斜杠后无文件名)→ 指向索引文件
    [/references\/common\/layout-cards\/(?![A-Za-z0-9._-])/g, 'references/common-layout-cards-index.md'],
    [/references\/arduino\/detail\/([A-Za-z0-9._-]+)/g, 'references/arduino-detail-$1'],
    [/references\/common\/layout-cards\/([A-Za-z0-9._-]+)/g, 'references/common-layout-cards-$1'],
    [/references\/arduino\/([A-Za-z0-9._-]+)/g, 'references/arduino-$1'],
    [/references\/common\/([A-Za-z0-9._-]+)/g, 'references/common-$1'],
    [/references\/esp32\/([A-Za-z0-9._-]+)/g, 'references/esp32-$1'],
    // 顶层文件的裸提及 → 完整路径
    [/(?<!references\/)monaco-steps\.md/g, 'references/monaco-steps.md'],
    // 0.6.0 新增文档的裸提及 → 扁平完整路径(防 partial 匹配)
    [/(?<![-\w/])(layout-analysis|wiring-profiles|metrics-policy|env-switches)\.md/g, 'references/common-$1.md'],
  ];
  for (const [re, to] of RULES) md = md.replace(re, to);

  // 5. 散文行加平台引用语法 @references/(代码块内保持纯路径,供自愈 bash 使用)
  const lines = md.split('\n');
  let inFence = false;
  const outLines = lines.map(line => {
    if (/^```/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    return line.replace(/(^|[^@\w])references\//g, '$1@references/');
  });
  md = outLines.join('\n');
  // 修复两处语义上不应带 @ 的目录级提及
  md = md.replace(/`scripts\/` \+ `@references\/`/g, '`scripts/` + `references/`');
  md = md.replace(/scripts\/ 和 @references\/ 缺失/g, 'scripts/ 和 references/ 缺失');

  return md;
}

// ---------- 主流程 ----------
const report = { ok: [], warn: [], err: [] };
function check(cond, msg, level) { report[level || (cond ? 'ok' : 'err')].push((cond ? '' : '') + msg); }

// 0. 源校验
if (!fs.existsSync(path.join(SOURCE, 'adapters', 'workbuddy', 'SKILL.md'))) {
  console.error('[FAIL] 源目录无效:', SOURCE, '(需要 adapters/workbuddy/SKILL.md)');
  process.exit(1);
}

// 1. 暂存目录
rmrf(OUT);
const pkgRoot = NO_WRAP
  ? path.join(OUT, SKILL_NAME)
  : path.join(OUT, 'skills', SKILL_NAME);
mkdirp(pkgRoot);

// 2. references 扁平化(排除开发期文档)
const EXCLUDE_REFS = new Set(['handoff-layout-v2.md', 'routing-philosophy.md']);
const refSrc = path.join(SOURCE, 'references');
const refDst = path.join(pkgRoot, 'references');
mkdirp(refDst);
const refFiles = walkFiles(refSrc).filter(f => !EXCLUDE_REFS.has(path.basename(f.rel)));
const flatNames = [];
for (const f of refFiles) {
  const flat = f.rel.split('/').join('-');
  flatNames.push(flat);
  copyFile(f.abs, path.join(refDst, flat));
}
if (new Set(flatNames).size !== flatNames.length) {
  console.error('[FAIL] references 扁平化出现重名冲突');
  process.exit(1);
}
check(refFiles.length > 0, `references 扁平化:${refFiles.length} 个文件`, 'ok');
check(walkDirs(refDst).length === 0, 'references/ 内无子目录(平台约束)', 'ok');

// 3. scripts 复制(排除开发期脚本)
const EXCLUDE_SCRIPTS = new Set(['run-tests.js', 'extract-components.py', 'fill-zh.py', 'extract-geometry.py',
  'extract-programmatic-pins.js', 'calibrate-sizes.js', 'measure-parts.js', 'analyze-demand.js',
  'compose-skeleton.js', 'iterate-layout.js']);
const scriptSrc = path.join(SOURCE, 'scripts');
const scriptDst = path.join(pkgRoot, 'scripts');
mkdirp(scriptDst);
const scriptFiles = walkFiles(scriptSrc).filter(f => !EXCLUDE_SCRIPTS.has(f.rel));
for (const f of scriptFiles) copyFile(f.abs, path.join(scriptDst, f.rel));
check(scriptFiles.length > 0, `scripts 复制:${scriptFiles.length} 个文件(已排除 __pycache__)`, 'ok');
check(walkDirs(scriptDst).length === 0, 'scripts/ 内无子目录(平台约束)', 'ok');

// 4. SKILL.md
const md = buildSkillMd(path.join(SOURCE, 'adapters', 'workbuddy', 'SKILL.md'));
fs.writeFileSync(path.join(pkgRoot, 'SKILL.md'), md);

// 5. 预检
for (const k of ['description:', 'description_zh:', 'description_en:', 'version:', 'author:']) {
  check(new RegExp('^' + k.replace(':', '\\:') + '\\s+\\S', 'm').test(md.slice(0, 1200)), 'frontmatter 必填字段 ' + k.replace(':', ''), 'ok');
}
const refTokens = [...md.matchAll(/@references\/([A-Za-z0-9._<>\-]+)/g)].map(m => m[1]);
const missingRefs = [...new Set(refTokens)].filter(t => {
  if (t.includes('<')) {
    // 占位符 token(如 arduino-detail-<type>.json)→ 通配匹配
    const re = new RegExp(
      '^' + t.split(/(<[^>]+>)/).map(part =>
        part.startsWith('<') ? '[A-Za-z0-9._-]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      ).join('') + '$'
    );
    return !flatNames.some(n => re.test(n));
  }
  return !fs.existsSync(path.join(refDst, t));
});
check(missingRefs.length === 0, missingRefs.length ? '失效引用: ' + missingRefs.join(', ') : `@references 引用 ${new Set(refTokens).size} 个全部可解析`, missingRefs.length ? 'err' : 'ok');
const scriptTokens = [...md.matchAll(/scripts\/([A-Za-z0-9._-]+)/g)].map(m => m[1]);
const missingScripts = [...new Set(scriptTokens)].filter(t => !fs.existsSync(path.join(scriptDst, t)));
check(missingScripts.length === 0, missingScripts.length ? '失效脚本: ' + missingScripts.join(', ') : `scripts/ 提及 ${new Set(scriptTokens).size} 个全部可解析`, missingScripts.length ? 'err' : 'ok');
const leftoverNested = md.match(/references\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/g) || [];
check(leftoverNested.length === 0, leftoverNested.length ? '残留嵌套路径: ' + leftoverNested.join(', ') : '无残留嵌套路径', leftoverNested.length ? 'err' : 'ok');

// 6. zip(zipRoot = OUT:wrap 时条目为 skills/wokwi-arduino/...,no-wrap 时为 wokwi-arduino/...)
let zipInfo = null;
let zipPath = null;
if (!SKIP_ZIP) {
  zipPath = path.join(OUT, SKILL_NAME + '-v' + VERSION + '-workbuddy.zip');
  zipInfo = writeZip(OUT, zipPath);
}

// 7. 报告
const topLevel = fs.readdirSync(pkgRoot).sort();
const reportLines = [
  '===== WorkBuddy 开放平台技能包预检报告 =====',
  '生成时间: ' + new Date().toISOString(),
  '源仓库: ' + path.resolve(SOURCE) + '(只读,未改动)',
  '输出: ' + path.resolve(OUT),
  '包形状: ' + (NO_WRAP ? SKILL_NAME + '/' : 'skills/' + SKILL_NAME + '/'),
  '顶层条目: ' + topLevel.join(', '),
  'references 文件数: ' + refFiles.length + ' | scripts 文件数: ' + scriptFiles.length,
  '',
  '[OK] ' + report.ok.length + ' 项:',
  ...report.ok.map(s => '  ✔ ' + s),
  '[WARN] ' + report.warn.length + ' 项:',
  ...report.warn.map(s => '  ⚠ ' + s),
  '[ERR] ' + report.err.length + ' 项:',
  ...report.err.map(s => '  ✘ ' + s),
  '',
  zipInfo ? `zip: ${path.basename(zipPath)}(${zipInfo.files} 个条目, ${(zipInfo.size / 1024).toFixed(1)} KB) — 顶层:${NO_WRAP ? 'wokwi-arduino/' : 'skills/'}(W1: 解析失败时加 --no-wrap 重生成)` : 'zip: 跳过(--skip-zip)',
  '',
  '上传前人工确认项: author=' + AUTHOR + '(TODO)、version=' + VERSION + '、category 未填(W2)',
].join('\n');
fs.writeFileSync(path.join(OUT, 'precheck-report.txt'), reportLines);
console.log(reportLines);
process.exit(report.err.length ? 1 : 0);
