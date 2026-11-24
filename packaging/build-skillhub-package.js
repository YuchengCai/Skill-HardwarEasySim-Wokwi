#!/usr/bin/env node
/**
 * build-skillhub-package.js — 生成 SkillHub（WorkBuddy 市场）发布目录
 *
 * 与 publish-skillhub.sh 同源逻辑：WorkBuddy 适配器 SKILL.md + 根 scripts/references，
 * 排除开发期文档/脚本与平台不收的 .wasm/.c/.h；注入 SkillHub frontmatter。
 * 只生成目录，不上传。
 *
 * 用法：node packaging/build-skillhub-package.js [--out dist/skillhub-<ver>]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8')).version;
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const OUT = path.resolve(oi >= 0 ? args[oi + 1] : path.join(ROOT, 'dist', `skillhub-${version}`));

const EXCLUDE_SCRIPTS = new Set(['run-tests.js', 'extract-components.py', 'fill-zh.py', 'extract-geometry.py',
  'extract-programmatic-pins.js', 'calibrate-sizes.js', 'measure-parts.js', 'analyze-demand.js',
  'compose-skeleton.js', 'iterate-layout.js', '__pycache__',
  'placeholder-chip.wasm', 'placeholder-chip.c', 'wokwi-api.h']);
const EXCLUDE_REFS = new Set(['handoff-layout-v2.md', 'routing-philosophy.md']);
const DESC_ZH = '创建、编译、仿真并上传 Arduino 项目(Wokwi)：锁定接点/必需网络对账、连线反馈、离体近贴检查、本地烧录。当用户提到 Arduino、Wokwi、单片机、嵌入式,或检测到 .ino / wokwi.toml / diagram.json 文件时使用。';
const META = {
  slug: 'workbuddy-hardwareasysim-wokwi',
  version,
  displayName: 'Wokwi Arduino Simulation',
  summary: '用自然语言创建、编译、仿真并上传 Arduino(Wokwi)项目，自动生成电路图与走线；v0.6.1 新增锁定接点对账、连线反馈、多宿主插件包与本地烧录',
  license: 'MIT',
  homepage: 'https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi',
  tags: '[arduino, wokwi, embedded, simulation, hardware]'
};

function copyDir(src, dst, exclude) {
  let n = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyDir(s, d, exclude);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 1. SKILL.md（WorkBuddy 适配器为目标市场文案源）
let c = fs.readFileSync(path.join(ROOT, 'adapters', 'workbuddy', 'SKILL.md'), 'utf8');
if (!/^description:/m.test(c)) throw new Error('适配器 SKILL.md 缺 description');
c = c.split('\n').map(l => l.startsWith('description:') ? 'description: ' + DESC_ZH : l).join('\n');
const first = c.indexOf('---');
const second = c.indexOf('---', first + 3);
const extra = Object.entries(META).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';
c = c.slice(0, second) + extra + c.slice(second);
fs.writeFileSync(path.join(OUT, 'SKILL.md'), c);

// 2. scripts / references（跳过平台不收的类型与开发期文件）
const nScripts = copyDir(path.join(ROOT, 'scripts'), path.join(OUT, 'scripts'), EXCLUDE_SCRIPTS);
const nRefs = copyDir(path.join(ROOT, 'references'), path.join(OUT, 'references'), EXCLUDE_REFS);

console.log(`[OK] SkillHub 包已生成: ${OUT}`);
console.log(`     version=${version} ｜ scripts ${nScripts} 文件 ｜ references ${nRefs} 文件`);
console.log('     未上传；上传用：skillhub publish <dir> --version ' + version + ' --changelog "..."');
