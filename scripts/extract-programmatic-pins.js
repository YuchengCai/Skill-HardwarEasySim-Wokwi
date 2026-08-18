#!/usr/bin/env node
/**
 * extract-programmatic-pins.js — 求值 wokwi-elements 里「程序化」元件的 pinInfo
 *
 * 背景：约 5 个元件的 pinInfo 是 getter + helper 函数 + spread + 循环 + 查表，
 * 正则/简单表达式求值搞不定。本脚本把这些 .ts 源码擦掉 TS 类型后，
 * 在 Node vm 沙箱里实例化类并读取 pinInfo getter，得到 {name, x, y}。
 *
 * 用法：
 *   node extract-programmatic-pins.js <file.ts>          # 单文件，打印 JSON
 *   node extract-programmatic-pins.js --all <dir>        # 目录下全部 *element.ts
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MM_TO_PIX = 96 / 25.4; // 3.779527559055118，对应 wokwi-elements 的 ./utils/units:mmToPix

// ---------- TS → JS 类型擦除 ----------
// 按顶层逗号切分参数（跳过 <> 里的逗号，如 Map<string, unknown>）
function splitTopLevel(params) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of params) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// 用括号匹配擦属性类型标注：name: Type = value  →  name = value
// 能正确处理 Type 含 {} [] <> => 的情况，且不误伤对象解构 { startX: x }
function stripPropTypes(s) {
  let out = '';
  let i = 0;
  const re = /([A-Za-z_$][\w$]*)\s*:/g;
  let m;
  let last = 0;
  while ((m = re.exec(s))) {
    const colonEnd = m.index + m[0].length;
    let depth = 0;
    let j = colonEnd;
    while (j < s.length) {
      const c = s[j];
      if ('{([<'.includes(c)) depth++;
      else if ('})]>'.includes(c)) {
        if (depth === 0) break;
        depth--;
      } else if (c === '=') {
        if (s.startsWith('=>', j)) { j += 2; continue; }      // 跳过 =>
        if (s.startsWith('===', j)) { j += 3; continue; }     // 跳过 ===
        if (s.startsWith('==', j)) { j += 2; continue; }      // 跳过 ==
        if (depth === 0) break;                               // 顶层 = ，类型结束
        j++;
      } else if (depth === 0 && (c === ';' || c === '\n' || c === ',' || c === '}')) {
        break; // 不是属性声明（对象键值 / 解构）
      }
      j++;
    }
    if (j < s.length && s[j] === '=') {
      out += s.slice(last, m.index) + m[1];
      last = j;
      re.lastIndex = j;
    }
  }
  out += s.slice(last);
  return out;
}

function stripTs(src) {
  let s = src;
  // 1. 删注释（块 + 行）
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/\/\/[^\n]*/g, '');
  // 2. 删 import
  s = s.replace(/import\s+[^;]+;\s*/g, '');
  // 3. 删 interface（多行块）与 type 别名（单行）
  s = s.replace(/\b(?:export\s+)?interface\s+\w+[^{]*\{[\s\S]*?\n\}\s*/g, '');
  s = s.replace(/\b(?:export\s+)?type\s+\w+\s*=\s*[^\n]*;\s*/g, '');
  // 4. 删装饰器（@customElement / @property 等）
  s = s.replace(/@\w+(?:\([^)]*\))?\s*/g, '');
  // 5. 擦访问修饰符 / export / abstract / declare
  s = s.replace(/\b(?:export|default|readonly|private|protected|public|abstract|declare)\s+/g, '');
  // 6. class X extends Y  →  class X（Y 是被 import 的基类，vm 里不存在）
  s = s.replace(/\bclass\s+([A-Za-z_$][\w$]*)\s+extends\s+[A-Za-z_$][\w$]*/g, 'class $1');
  // 7. 箭头函数返回类型：(x): Ret =>  →  (x) =>
  s = s.replace(/\)\s*:\s*[^()]+?=>/g, ') =>');
  // 7b. 箭头函数参数类型：(x: number) =>  →  (x) =>
  s = s.replace(/\(([^()]*)\)\s*=>/g, (m, params) => {
    const cleaned = splitTopLevel(params).map(p => p.replace(/:\s*.*$/, '').trim()).join(', ');
    return '(' + cleaned + ') =>';
  });
  // 8. 方法参数 + 返回类型：name(params): Ret {  →  name(params) {
  s = s.replace(/\b([A-Za-z_$][\w$]*)\s*\(([^()]*)\)(\s*:\s*[^{\n]+?)?\s*\{/g, (m, name, params) => {
    const cleaned = splitTopLevel(params).map(p => p.replace(/:\s*.*$/, '').trim()).join(', ');
    return name + '(' + cleaned + ') {';
  });
  // 9. 属性类型标注（括号匹配）
  s = stripPropTypes(s);
  // 10. 类型断言 as Type（含 as unknown as [...] 多行数组）
  s = s.replace(/\s+as\s+unknown\s+as\s*\[[\s\S]*?\]/g, '');
  s = s.replace(/\s+as\s+[A-Za-z_$][\w$]*\s*(?=[,;)\n]|$)/g, '');
  return s;
}

function extractTypeName(src) {
  const m = src.match(/@customElement\('([^']+)'\)/);
  return m ? m[1] : null;
}

function extractClassName(src) {
  const m = src.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
  return m ? m[1] : null;
}

/**
 * 求值单个 .ts 源文件，返回 { name: [x, y], ... }；失败返回 null。
 */
function evaluatePins(src) {
  const className = extractClassName(src);
  if (!className) return null;
  const stripped = stripTs(src);
  const program = `
    const mmToPix = ${MM_TO_PIX};
    const __stub = () => ({});
    const GND = __stub, VCC = __stub, i2c = __stub, analog = __stub, spi = __stub, uart = __stub, digital = __stub, pwm = __stub;
    ${stripped}
    ;(() => {
      const inst = new ${className}();
      const pins = inst.pinInfo;
      if (!Array.isArray(pins)) return null;
      return pins
        .filter(p => p && typeof p.name === 'string' && typeof p.x === 'number' && typeof p.y === 'number')
        .map(p => [p.name, p.x, p.y]);
    })()
  `;
  try {
    const result = vm.runInNewContext(program, {}, { timeout: 2000 });
    if (!Array.isArray(result)) return null;
    const pins = {};
    for (const [name, x, y] of result) {
      pins[name] = [Number(x.toFixed(2)), Number(y.toFixed(2))];
    }
    return pins;
  } catch (e) {
    process.stderr.write(`  ⚠️ ${className}: 求值失败 ${e.message}\n`);
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--all')) {
    const dir = args[args.indexOf('--all') + 1] || '.';
    const files = fs.readdirSync(dir).filter(f => f.endsWith('-element.ts')).sort();
    const out = {};
    let ok = 0;
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf-8');
      const type = extractTypeName(src);
      const pins = evaluatePins(src);
      if (type && pins && Object.keys(pins).length) {
        out[type] = pins;
        ok++;
        process.stderr.write(`  OK  ${type} (${Object.keys(pins).length} pins)\n`);
      } else if (type && pins) {
        process.stderr.write(`  --  ${type} (0 pins)\n`);
      }
    }
    const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
    const json = JSON.stringify(out, null, 2) + '\n';
    if (outFile) fs.writeFileSync(outFile, json);
    else process.stdout.write(json);
    process.stderr.write(`共 ${ok} 个元件求值出引脚${outFile ? ' → ' + outFile : ''}\n`);
    return;
  }
  // 单文件
  const file = args[0];
  if (!file) {
    process.stderr.write('用法: node extract-programmatic-pins.js <file.ts> | --all <dir>\n');
    process.exit(1);
  }
  const src = fs.readFileSync(file, 'utf-8');
  const type = extractTypeName(src);
  const pins = evaluatePins(src);
  process.stdout.write(JSON.stringify({ type, pins }, null, 2) + '\n');
}

module.exports = { stripTs, evaluatePins, extractTypeName };

if (require.main === module) {
  main();
}
