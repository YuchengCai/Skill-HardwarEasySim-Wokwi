#!/usr/bin/env node
/**
 * flash-arduino.js — 本地编译/烧录封装（序列4/文档47；零依赖）
 *
 * 设计：
 *  - 只封装「用户已委托」的本地动作；纯绘图/选型不调用。
 *  - 不自动安装 CLI、不猜板型：找不到 CLI 时打印三选项；设备列表保留逐端口证据。
 *  - --upload 必须同时给 --confirm（写入授权），否则退出码 3，调用次数为 0。
 *  - --simulate 不调用 arduino-cli、不访问设备，只打印阶段与命令计划（用于回归/纯绘图证明 0 次调用）。
 *
 * 用法：
 *   node flash-arduino.js --detect
 *   node flash-arduino.js --list
 *   node flash-arduino.js --board uno --compile <dir>
 *   node flash-arduino.js --board uno --port COM5 --dir <dir> --upload --confirm
 *   node flash-arduino.js --simulate --board esp32 --dir <dir> --upload
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ARGS = process.argv.slice(2);
const SIM = ARGS.includes('--simulate');
const JSON_OUT = ARGS.includes('--json');

function argVal(name) {
  const i = ARGS.indexOf(name);
  return i >= 0 ? ARGS[i + 1] : null;
}
function flag(name) { return ARGS.includes(name); }

const BOARDS = {
  uno: { fqbn: 'arduino:avr:uno', core: 'arduino:avr', artifact: '.hex', label: '经典 Uno' },
  nano: { fqbn: 'arduino:avr:nano', core: 'arduino:avr', artifact: '.hex', label: '经典 Nano', options: '如需旧引导程序，追加 --fqbn arduino:avr:nano:cpu=atmega328old' },
  mega: { fqbn: 'arduino:avr:mega', core: 'arduino:avr', artifact: '.hex', label: 'Mega' },
  esp32: { fqbn: 'esp32:esp32:esp32', core: 'esp32:esp32', artifact: '.bin', label: '经典 ESP32 DevKit V1' }
};

const actions = [];   // 计划/实际执行的阶段记录（--json 输出）
function phase(name, detail) {
  actions.push({ phase: name, detail });
  if (!JSON_OUT) console.log(`[PHASE] ${name}: ${detail}`);
}

/** 沙箱兼容：子进程输出走文件句柄，不用管道 */
function run(cmd, cmdArgs) {
  const log = path.join(os.tmpdir(), `flash-${process.pid}-${Date.now()}.log`);
  const fd = fs.openSync(log, 'w');
  let r;
  try { r = spawnSync(cmd, cmdArgs, { stdio: ['ignore', fd, fd], shell: false }); }
  finally { fs.closeSync(fd); }
  let out = '';
  try { out = fs.readFileSync(log, 'utf8'); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(log); } catch (e) { /* ignore */ }
  return { status: r.status == null ? -1 : r.status, out, error: r.error };
}

function findCli() {
  if (process.env.ARDUINO_CLI && fs.existsSync(process.env.ARDUINO_CLI)) return process.env.ARDUINO_CLI;
  // PATH 优先（where/which 由系统提供）
  const which = run(process.platform === 'win32' ? 'where' : 'which', ['arduino-cli']);
  if (which.status === 0) {
    const first = which.out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  }
  const cands = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Arduino CLI', 'arduino-cli.exe'),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'bin', 'arduino-cli.exe'),
    process.env.HOME && path.join(process.env.HOME, 'bin', 'arduino-cli'),
    '/usr/local/bin/arduino-cli',
    '/usr/bin/arduino-cli'
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

function detect() {
  if (SIM) { phase('detect', '模拟：跳过 arduino-cli version'); return { cli: 'arduino-cli', version: 'simulated' }; }
  const cli = findCli();
  if (!cli) {
    phase('detect', '未找到 arduino-cli');
    console.log('[NEXT] 请选择：1) 安装并继续（说明来源/位置/权限，优先用户范围）；2) 指定已有路径（--cli <path> 或设置 ARDUINO_CLI）；3) 稍后');
    console.log('[KEEP] 工程与接线指导保留；探测阶段未改动 PATH/配置/核心目录');
    return null;
  }
  const v = run(cli, ['version']);
  if (v.status !== 0) { phase('detect', `arduino-cli version 失败: ${v.out.slice(-200)}`); return null; }
  phase('detect', `找到 ${cli}`);
  if (!JSON_OUT) console.log(v.out.trim());
  return { cli, version: v.out.trim() };
}

function coreReady(cli, core) {
  if (SIM) { phase('core-check', `模拟：检查 ${core}`); return true; }
  const r = run(cli, ['core', 'list', '--format', 'json']);
  if (r.status !== 0) { phase('core-check', `core list 失败: ${r.out.slice(-200)}`); return false; }
  try {
    const list = JSON.parse(r.out);
    const arr = Array.isArray(list.platforms) ? list.platforms : (Array.isArray(list) ? list : []);
    const hit = arr.some(p => String(p.id || '').trim() === core);   // 供应商+架构精确匹配，不做前缀/子串
    phase('core-check', hit ? `已安装 ${core}` : `缺少核心 ${core}（按供应商+架构精确检查）`);
    return hit;
  } catch (e) {
    phase('core-check', `core list 输出无法解析: ${e.message}`);
    return false;
  }
}

function listPorts() {
  if (SIM) { phase('list', '模拟：跳过设备枚举'); return; }
  const cli = findCli();
  if (!cli) { phase('list', '未找到 arduino-cli，无法枚举'); process.exit(2); }
  const r = run(cli, ['board', 'list', '--format', 'json']);
  if (r.status !== 0) {
    phase('list', `board list 失败: ${r.out.slice(-300)}`);
    // 降级：文本枚举，仍保留端口关联
    const t = run(cli, ['board', 'list']);
    console.log(t.out);
    process.exit(t.status === 0 ? 0 : 4);
  }
  let list;
  try { list = JSON.parse(r.out); } catch (e) { console.log(r.out); return; }
  const ports = list.ports || list.detected_ports || [];
  if (!ports.length) { phase('list', '零块设备'); console.log('[NEXT] 请接板后复查'); return; }
  for (const p of ports) {
    const b = p.matching_boards || p.boards || [];
    const ident = p.identification_properties || {};
    const line = {
      port: p.port?.address || p.address,
      protocol: p.port?.protocol || p.protocol,
      boards: b.map(x => x.name || x.fqbn).filter(Boolean),
      vid: ident.vid || p.vid,
      pid: ident.pid || p.pid,
      serial: ident.serialNumber || p.serialNumber,
      description: ident.product || p.description
    };
    console.log(JSON.stringify(line));
  }
  phase('list', `${ports.length} 个端口候选（逐端口保留 VID/PID/描述；CH340/CP210x/FTDI 仅作桥线索，不据此定板）`);
}

function main() {
  const boardKey = argVal('--board');
  const fqbnArg = argVal('--fqbn');
  const dir = argVal('--dir') || argVal('--compile');
  const port = argVal('--port');
  const doUpload = flag('--upload') || flag('--flash');
  const confirm = flag('--confirm');

  if (flag('--detect')) {
    const d = detect();
    if (!d) process.exit(2);
    // 仅探测时到此结束；不要继续走板型解析（board 可能为空）
    if (!boardKey && !fqbnArg && !argVal('--dir') && !argVal('--compile') && !doUpload) {
      if (JSON_OUT) console.log(JSON.stringify({ actions }));
      return;
    }
  }
  if (flag('--list')) { listPorts(); if (JSON_OUT) console.log(JSON.stringify({ actions })); return; }
  if (boardKey && !argVal('--dir') && !argVal('--compile') && !doUpload) {
    const b = BOARDS[boardKey];
    if (!b) { console.error('[ERR] 未知板型: ' + boardKey); process.exit(3); }
    console.log(`[MAP] ${b.label} → ${b.fqbn}（核心 ${b.core}，产物 ${b.artifact}）${b.options ? '；' + b.options : ''}`);
    return;
  }

  const board = boardKey ? BOARDS[boardKey] : null;
  if ((boardKey && !board) || (!board && !fqbnArg && !flag('--detect') && !flag('--list'))) {
    console.error('[ERR] 未知板型或缺少参数。可用 --board uno|nano|mega|esp32 或 --fqbn <FQBN>');
    process.exit(3);
  }
  const fqbn = fqbnArg || board.fqbn;
  const core = board ? board.core : fqbn.split(':').slice(0, 2).join(':');

  if (doUpload && !confirm) {
    phase('authorize', '拒绝上传：未提供 --confirm（写入授权）。本次未调用编译/上传');
    console.log('[NEXT] 展示接线图并用合并确认说明：写哪版程序、目标板型、会替换现有程序；用户同意后再执行');
    if (JSON_OUT) console.log(JSON.stringify({ actions, uploads: 0 }));
    process.exit(3);
  }
  if (doUpload && !port && !SIM) {
    phase('device', '缺少 --port：请从逐端口候选中选择（零板则接板后复查）');
    if (JSON_OUT) console.log(JSON.stringify({ actions, uploads: 0 }));
    process.exit(3);
  }
  if (!dir) { console.error('[ERR] 需要 --dir <工程目录>（含 .ino）'); process.exit(3); }
  if (!SIM && !fs.existsSync(dir)) { console.error(`[ERR] 工程目录不存在: ${dir}`); process.exit(3); }

  // 1. CLI 检测（真实模式）；模拟模式跳过
  let cli = 'arduino-cli';
  if (!SIM) {
    const d = detect();
    if (!d) process.exit(2);
    cli = d.cli;
  } else {
    phase('detect', '模拟：跳过 arduino-cli 检测');
  }

  // 2. 核心检查（真实模式）
  if (!SIM) {
    if (!coreReady(cli, core)) {
      phase('core', `缺少核心 ${core}`);
      console.log('[NEXT] 合并说明需补齐的依赖（核心/库），在授权范围内安装后再编译；本次未上传');
      if (JSON_OUT) console.log(JSON.stringify({ actions, uploads: 0 }));
      process.exit(4);
    }
  } else phase('core-check', `模拟：检查 ${core}`);

  // 3. 编译（上传时用一次 compile --upload 让上传器消费同次构建产物）
  const compileCmd = ['compile', '--fqbn', fqbn];
  if (doUpload) compileCmd.push('--upload', '-p', port || 'PORT');
  compileCmd.push(dir);
  phase('compile', `${fqbn}${doUpload ? ' + 同次构建上传' : ''}；产物类型 ${board ? board.artifact : '(按 FQBN 判断，ESP32 为 .bin)'}`);
  if (SIM) {
    phase('cmd', ['arduino-cli', ...compileCmd].join(' '));
  } else {
    const r = run(cli, compileCmd);
    if (r.status !== 0) {
      phase('compile', `失败（上传器调用次数 ${doUpload ? 0 : 0}）: ${r.out.slice(-400)}`);
      console.log('[NEXT] 停在编译阶段，给出具体错误；不重复写入');
      if (JSON_OUT) console.log(JSON.stringify({ actions, uploads: 0 }));
      process.exit(4);
    }
    phase('compile', '成功');
  }

  // 4. 结果状态
  if (doUpload) {
    if (SIM) {
      phase('upload', `模拟：将调用上传器一次（port=${port || '待选'}，fqbn=${fqbn}），本次未执行`);
      console.log('[RESULT] 模拟：上传成功（实际未执行；真机需用户授权与端口）');
    } else {
      phase('upload', `已调用上传器一次（port=${port}，fqbn=${fqbn}）`);
      console.log('[RESULT] 上传成功（以上传器实际调用与返回结果判定）');
    }
  } else if (!JSON_OUT) {
    console.log(`[RESULT] 编译完成（未上传）；产物类型 ${board ? board.artifact : '按 FQBN 判断'}`);
  }
  if (JSON_OUT) console.log(JSON.stringify({ actions, uploads: doUpload ? 1 : 0, fqbn, port: port || null }));
}

main();
