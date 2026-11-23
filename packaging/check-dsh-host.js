#!/usr/bin/env node
/**
 * check-dsh-host.js — DSH 宿主自动化验证（序列2/文档43）
 *
 * 模拟 DSH 在「无历史的新工程 + 含空格路径」中加载可移植包，从正常入口执行
 * 一次基础绘图：包内 layout-generator → check-required → optimize-wiring。
 *
 * 说明：本脚本验证「宿主可发现包、资源可从包位置解析、脚本可执行、产出落在用户工程」；
 * 自然语言 → 意图 的那一步属于模型行为，不在脚本内自动断言（记录为未覆盖）。
 *
 * 用法：node packaging/check-dsh-host.js [--json] [--keep]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PLUGIN = path.join(ROOT, 'dist', 'plugin');
const SKILL = path.join(PLUGIN, 'skills', 'wokwi-arduino');
const JSON_OUT = process.argv.includes('--json');
const KEEP = process.argv.includes('--keep');

const report = { ok: false, checks: [], commands: [], project: null, hardConflicts: null };
const add = (name, pass, detail) => {
  report.checks.push({ name, pass, detail });
  if (!JSON_OUT) console.log(`  ${pass ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
};

function run(args, cwd, logName, tmp) {
  const log = path.join(tmp, logName);
  const fd = fs.openSync(log, 'w');
  let r;
  try { r = spawnSync(process.execPath, args, { cwd, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  let out = '';
  try { out = fs.readFileSync(log, 'utf8'); } catch (e) { /* ignore */ }
  return { status: r.status, out };
}

// 1. 组装包（构建脚本非零则失败）
const build = spawnSync(process.execPath, [path.join(ROOT, 'packaging', 'build-plugin.js')], { stdio: 'inherit' });
add('组装可移植包', build.status === 0, 'node packaging/build-plugin.js');

// 2. 包根清单与规范入口
add('plugin.json 存在', fs.existsSync(path.join(PLUGIN, 'plugin.json')));
add('mcp.json 存在', fs.existsSync(path.join(PLUGIN, 'mcp.json')));
add('skills/wokwi-arduino/SKILL.md 存在', fs.existsSync(path.join(SKILL, 'SKILL.md')));
add('包内 scripts/references 可解析', fs.existsSync(path.join(SKILL, 'scripts', 'layout-generator.js')) && fs.existsSync(path.join(SKILL, 'references', 'common', 'pins.json')));

// 3. 新工程（含空格路径）
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'DSH Host Test '));
const project = path.join(base, 'proj one');
fs.mkdirSync(project, { recursive: true });
report.project = project;
const fixture = path.join(ROOT, 'tests', 'intake', 'photo-a0.json');
fs.copyFileSync(fixture, path.join(project, 'layout-intent.json'));
fs.writeFileSync(path.join(project, 'sketch.ino'), 'void setup(){ Serial.begin(9600); }\nvoid loop(){ Serial.println(analogRead(A0)); }\n');
add('新工程（含空格路径）已创建', true, project);

// 4. 从包内正常入口执行
const gen = run([path.join(SKILL, 'scripts', 'layout-generator.js'), path.join(project, 'layout-intent.json'), project], project, 'gen.log', base);
report.commands.push({ cmd: 'layout-generator', exit: gen.status });
add('layout-generator 退出码 0', gen.status === 0, `exit ${gen.status}`);
add('diagram.json 落在用户工程', fs.existsSync(path.join(project, 'diagram.json')));
add('wiring-notes.md 落在用户工程', fs.existsSync(path.join(project, 'wiring-notes.md')));
add('未写入 skill 目录', !fs.existsSync(path.join(SKILL, 'diagram.json')));

const chk = run([path.join(SKILL, 'scripts', 'check-required.js'), path.join(project, 'layout-intent.json'), '--dir', project], project, 'check.log', base);
report.commands.push({ cmd: 'check-required', exit: chk.status });
add('check-required 通过（0/3 语义）', chk.status === 0, `exit ${chk.status}；${(chk.out.match(/需求对账[^\n]*/) || [''])[0]}`);

const opt = run([path.join(SKILL, 'scripts', 'optimize-wiring.js'), project, '--dry-run'], project, 'opt.log', base);
const m = opt.out.match(/检测到冲突 \d+ 处\(硬 (\d+)/);
report.hardConflicts = m ? +m[1] : null;
add('optimize-wiring 可执行', opt.status === 0 || opt.status === 2, `exit ${opt.status}`);
add('几何硬冲突为 0（软交叉允许）', report.hardConflicts === 0, report.hardConflicts == null ? '未解析到统计' : `硬 ${report.hardConflicts}`);

report.ok = report.checks.every(c => c.pass);
if (!KEEP) fs.rmSync(base, { recursive: true, force: true });

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`\n===== DSH 宿主自动化验证 =====`);
  console.log(`包: ${PLUGIN}`);
  console.log(`工程: ${report.project}${KEEP ? '（保留）' : '（已清理）'}`);
  console.log(report.ok ? '[OK] 宿主入口/资源解析/脚本执行/产出位置 全部通过' : '[FAIL] 存在未通过项');
  console.log('未覆盖：自然语言 → 意图 的模型行为；真实浏览器渲染；宿主自身的安装/授权界面。');
}
process.exit(report.ok ? 0 : 1);
