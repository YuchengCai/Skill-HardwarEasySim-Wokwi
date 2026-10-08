#!/usr/bin/env node
/**
 * layout-generator.js — 布局生成器 (v0.2)
 *
 * 输入：layout-intent.json（模型给的布局意图）
 * 输出：diagram.json 的 parts（带坐标）
 *
 * 约束分层（低级不能违反高级）：
 *   第 1 层（硬）：区域分配（group 必须在分配的 region）
 *   第 2 层（软）：组内靠近（区域内靠紧）
 *   第 3 层（软）：near/avoid（仅同区域时微调，跨区域放弃）
 *   第 4 层（硬底线）：不遮挡板子、元件不重叠（间距≥30）
 *
 * 用法：
 *   node layout-generator.js <layout-intent.json> <output-dir>
 */

const fs = require('fs');
const path = require('path');

// mm→px（96dpi；96/25.4）。占位符 board.json 的尺寸/引脚是 mm，换算成画布 px 用。
const MM2PX = 96 / 25.4;

let MIN_SPACING = 30; // 元件间距（--spacing 可覆盖，迭代骨架用）
const GROUP_SPACING = 80; // 组间距

// 电源拓扑判据常量（T3 改造，见 results/T3/plan.md 常量表）
const POWER_DAISY_WARN_PX = 400;   // N12:菊花链单线告警阈值(可调;分发线豁免——T1 校准实证 golden 分发线天然 855px+)
const POWER_DIRECT_KEEP_PX = 150;  // A2 例外:短线直连更优的跨度上限(可调)
const DISCRETE_TYPES = ['wokwi-resistor', 'wokwi-led', 'wokwi-rgb-led', 'wokwi-pushbutton', 'wokwi-pushbutton-6mm'];
const DEFAULT_POWER_PIN_COUNTS = { GND: 2, '5V': 1, '3.3V': 1, VIN: 1 };  // boards.json 未配置时的兜底(Uno 假设)
// part 引脚名 → 电源家族（A3/A4 判 daisy 用）：GND 家族（bn/tn 负轨）/ 5V 家族（tp 正轨）/
// null = 3.3V/VIN/VBAT/VBUS 等无专属轨家族 → 保持直连不改写
const daisyFamOf = (pin) => {
  if (/^(GND|VSS|V-)$/i.test(pin)) return 'GND';
  if (/^(VCC|VDD|5V|3V3|V\+)$/i.test(pin)) return '5V';
  return null;
};

// 元件尺寸（从 sizes.json 加载）
function loadSizes() {
  const p = path.join(__dirname, '..', 'references', 'common', 'sizes.json');
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return { sizes: {}, default: { width: 20, height: 20 } };
}

// 引脚坐标（从 pins.json 加载，wokwi-elements 源码提取的权威数据）
function loadPins() {
  const p = path.join(__dirname, '..', 'references', 'common', 'pins.json');
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return {};
}

// 面包板几何（单一事实源 geometry.json，与 optimize-wiring.js / breadboard.md 共用）
function loadGeometry() {
  const p = path.join(__dirname, '..', 'references', 'common', 'geometry.json');
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return {};
}

// 板型配置（boards.json：id、引脚分侧阈值、电源脚命名 —— 多板型复用的单一事实源）
function loadBoards() {
  const p = path.join(__dirname, '..', 'references', 'common', 'boards.json');
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return { boards: {} };
}

// 引脚语义（pin-semantics.json：swapPair 可互换对 / terminalPairs 端子对 / 方向规则）
// 数据驱动：新元件加一条数据即自动受益，不加 if 分支
function loadPinSemantics() {
  const p = path.join(__dirname, '..', 'references', 'common', 'pin-semantics.json');
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return { semantics: {} };
}

// 重叠检测: 解析每条线的绝对折线段, 报「水平/竖直共线重叠」与「平行间距过近」。
// 阈值: 共线 |d| <= 0.1 且重叠 > 2 单位; 过近 0.1 < |d| <= 4 且投影重叠 > 8 单位。
// 交叉(h×v)不报。用途: 防回归, 替代 golden 硬对照。
function detectOverlaps(wirePaths) {
  const segs = [];
  for (const w of wirePaths) {
    const pts = w.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      if (Math.abs(y1 - y2) < 0.1 && Math.abs(x1 - x2) > 0.5) {
        segs.push({ w, horiz: true, p: y1, a: Math.min(x1, x2), b: Math.max(x1, x2) });
      } else if (Math.abs(x1 - x2) < 0.1 && Math.abs(y1 - y2) > 0.5) {
        segs.push({ w, horiz: false, p: x1, a: Math.min(y1, y2), b: Math.max(y1, y2) });
      }
    }
  }
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], t = segs[j];
      if (s.w === t.w) continue;   // 同一条线的段对不判（折线拐点端点必在自己竖段上，非近触）
      // 端点近触：水平段端点 vs 竖直段（及对称）——端点 x 与竖段 x 差 <=2 且端点 y 落在竖段 y 区间内
      if (s.horiz && !t.horiz) {
        const near = (ex, ey) => (Math.abs(ex - t.p) <= 2 && ey >= Math.min(t.a, t.b) - 0.5 && ey <= Math.max(t.a, t.b) + 0.5);
        if (near(s.a, s.p) || near(s.b, s.p)) {
          console.error(`[重叠] 端点近触 ${s.w.from}→${s.w.to} × ${t.w.from}→${t.w.to} @x=${Math.round(t.p * 10) / 10} 端点y=${Math.round(s.p * 10) / 10}`);
          n++;
        }
      } else if (!s.horiz && t.horiz) {
        const near = (ex, ey) => (Math.abs(ex - s.p) <= 2 && ey >= Math.min(s.a, s.b) - 0.5 && ey <= Math.max(s.a, s.b) + 0.5);
        if (near(t.a, t.p) || near(t.b, t.p)) {
          console.error(`[重叠] 端点近触 ${s.w.from}→${s.w.to} × ${t.w.from}→${t.w.to} @x=${Math.round(s.p * 10) / 10} 端点y=${Math.round(t.p * 10) / 10}`);
          n++;
        }
      }
      if (s.horiz !== t.horiz) continue;
      const gap = Math.abs(s.p - t.p);
      const ov = Math.min(s.b, t.b) - Math.max(s.a, t.a);
      if (gap <= 0.1 && ov > 2) {
        console.error(`[重叠] 共线 ${s.w.from}→${s.w.to} × ${t.w.from}→${t.w.to} @${s.horiz ? 'y' : 'x'}=${Math.round(s.p * 10) / 10} 重叠 ${Math.round(ov * 10) / 10} 单位`);
        n++;
      } else if (gap <= 4 && ov > 8) {
        console.error(`[重叠] 过近 ${s.w.from}→${s.w.to} × ${t.w.from}→${t.w.to} 间距 ${Math.round(gap * 10) / 10} 投影重叠 ${Math.round(ov * 10) / 10} 单位`);
        n++;
      }
    }
  }
  return n;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('用法: node layout-generator.js <layout-intent.json> [output-dir]');
    process.exit(1);
  }
  const intent = JSON.parse(fs.readFileSync(args[0], 'utf-8'));
  const OUT_DIR = args[1] ? path.resolve(args[1]) : path.dirname(path.resolve(args[0]));
  // --spacing <px>：覆盖元件间距（迭代骨架逐轮加大间距消重叠用）
  const spIdx = args.indexOf('--spacing');
  if (spIdx >= 0 && args[spIdx + 1]) {
    const v = parseInt(args[spIdx + 1], 10);
    if (v > 0) MIN_SPACING = v;
  }
  // --expand <region>:<px>：定向扩容（如 --expand right:40 把 right 区往右推 40；模型决策用）
  const EXPAND = { top: 0, right: 0, bottom: 0, left: 0 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--expand' && args[i + 1]) {
      const m = args[i + 1].match(/^(top|right|bottom|left):(\d+)$/);
      if (m) EXPAND[m[1]] = parseInt(m[2], 10);
    }
  }
  const sizesData = loadSizes();

  // 未知类型收集（A6 不静默）：sizes 表未收录的 type 在尺寸查询兜底处收集，
  // [OK] 摘要前统一输出 UNKNOWN_TYPES。chip- 占位符有 chip-geometry 实例几何，不算未知。
  const unknownTypes = new Set();
  const sizeOf = (type) => {
    const s = sizesData.sizes[type];
    if (!s) { if (type && !type.startsWith('chip-')) unknownTypes.add(type); return sizesData.default; }
    return s;
  };

  // 板子位置（面包板模式：板子右侧；直连：下方居中）
  let useBB = !!intent.breadboard;
  const board = { type: intent.board || 'wokwi-arduino-uno', left: useBB ? 400 : 40, top: useBB ? 310 : 200 };
  const boardSize = sizeOf(board.type);
  board.w = boardSize.width;
  board.h = boardSize.height;
  // 板型配置（id、分侧阈值、电源脚）——Uno 假设抽到这里，多板型加配置即可
  const bp = (loadBoards().boards || {})[board.type] || {};
  board.id = bp.id || 'uno';
  board.pinSideThreshold = bp.pinSideThreshold || 100;
  board.powerPins = bp.powerPins || ['GND', '5V', '3.3V', 'VIN'];
  board.gndTop = bp.gndTop || 'GND.1';
  board.gndBottom = bp.gndBottom || 'GND.2';
  board.railGnd = bp.railGnd || 'GND.2';
  board.railVcc = bp.railVcc || '5V';
  // ============================================================
  // 电源 fanout 判据（T3 常驻化改造）：
  //   无论是否声明面包板，每次生成都按「电源家族」盘点板脚供需：
  //   家族 = GND / 5V / 3.3V / VIN（按 board.powerPins 前缀归类，不再按单脚）
  //   demand(家族) = intent.connections 中任一端引用该家族板脚的连接数
  //                + (useBB ? 1 : 0)（bb 主线预留）
  //   available(家族) = powerPinCounts[家族]（boards.json，未配置用 Uno 兜底）
  //   任一 demand > available → 输出 FANOUT_INFO（每个超限家族一条）；
  //   未声明面包板时维持自动配板兜底（useBB=true / breadboard / board 位置）。
  //   （旧「某脚被 ≥3 条连接共用」的 bus 检测语义已被 demand 口径覆盖并取代）
  // ============================================================
  const powerPinCounts = bp.powerPinCounts || DEFAULT_POWER_PIN_COUNTS;
  {
    const boardRef0 = new RegExp('^' + board.id + ':(.+)$');
    const famOfBoardPin = (pin) => board.powerPins.find(p => pin === p || pin.startsWith(p + '.'));
    const famDemand = {};
    const famOrder = ['GND', '5V', '3.3V', 'VIN'];
    (intent.connections || []).forEach(c => {
      const fams = new Set();   // 一条连接的同一家族端点只计一次（按家族计数）
      [c.from, c.to].forEach(ref => {
        const m = ref.match(boardRef0);
        if (m) { const f = famOfBoardPin(m[1]); if (f) fams.add(f); }
      });
      fams.forEach(f => { famDemand[f] = (famDemand[f] || 0) + 1; });
    });
    famOrder.forEach(f => { famDemand[f] = (famDemand[f] || 0) + (useBB ? 1 : 0); });
    const over = famOrder.filter(f => famDemand[f] > powerPinCounts[f]);
    if (over.length > 0) {
      const wasBB = useBB;
      if (!useBB) {
        useBB = true;
        intent.breadboard = 'wokwi-breadboard-half';
        board.left = 400;
        board.top = 310;
      }
      over.forEach(f => {
        const bbNote = wasBB ? '(面包板轨分发中)' : `,已自动配面包板 ${intent.breadboard}`;
        console.log(`[INFO] 电源 fanout:${f} 需求 ${famDemand[f]} > 板脚 ${powerPinCounts[f]}。多线汇聚板脚易串接混乱,走轨分发更稳${bbNote}。`);
      });
    }
  }
  // 预编译板子引用正则（id 来自板型配置，避免散落 'uno' 字面量）
  board.digitPat = new RegExp('^' + board.id + ':(\\d+)$');     // 板子数字脚（uno:13）
  board.fromPat = new RegExp('^' + board.id + ':(\\S+)$');      // 板子源（uno:A4）
  board.gndPat = new RegExp('^' + board.id + ':GND\\.\\d+$');   // GND 脚（uno:GND.1）

  // 元件清单
  // 占位符（chip-<name>，custom chip）引脚几何 —— 与 optimize-wiring.js 共用
  // chip-geometry.js 单一事实源（wokwi 截图实测校准，见 chip-geometry.js 头注）。
  const { computeChipGeometry } = require('./chip-geometry');
  const customBoardOf = {};
  intent.parts.forEach(p => {
    if (p.type && p.type.startsWith('chip-')) {
      const chipName = p.type.slice('chip-'.length);
      const chipPath = p.attrs && p.attrs.chip
        ? path.resolve(OUT_DIR, p.attrs.chip)
        : path.resolve(OUT_DIR, 'placeholders', chipName, `${chipName}.chip.json`);
      const data = JSON.parse(fs.readFileSync(chipPath, 'utf-8'));
      const geo = computeChipGeometry(chipName, data);
      customBoardOf[p.id] = { w: geo.w, h: geo.h, pins: geo.pins };
    }
  });
  const parts = intent.parts.map(p => {
    const cb = customBoardOf[p.id];
    const size = cb || sizeOf(p.type);
    return { ...p, w: size.w || size.width, h: size.h || size.height, left: 0, top: 0 };
  });
  const partById = {};
  parts.forEach(p => partById[p.id] = p);

  // 分组与区域归属（直连分支依赖，之前缺失导致直连模式崩溃）
  const groups = intent.groups || [];
  const groupOf = {};   // part id → 所属 group
  const regionOf = {};  // part id → 所属 region（直连 region；zone 已映射）
  const ZONE_DIRECT = { output: 'top', input: 'right', sensor: 'right', display: 'right', misc: 'right' };
  const directRegion = (g) => ['top', 'right', 'bottom', 'left'].includes(g.region) ? g.region
                      : (ZONE_DIRECT[g.zone] || 'right');
  groups.forEach(g => g.parts.forEach(id => { groupOf[id] = g; regionOf[id] = directRegion(g); }));

  // 引脚坐标 + 面包板对象 + 走线路由（两个分支共用：面包板 / 直连）
  const pins = loadPins();
  // 占位符引脚按 id 存（实例级），坐标已是 px（DIP 推断，round 2 位）
  Object.keys(customBoardOf).forEach(id => {
    const obj = {};
    Object.keys(customBoardOf[id].pins).forEach(pn => {
      const pos = customBoardOf[id].pins[pn];
      obj[pn] = [Math.round(pos[0] * 100) / 100, Math.round(pos[1] * 100) / 100];
    });
    pins[id] = obj;
  });
  let bb = null;   // 面包板对象（面包板分支赋值；直连分支保持 null，pinPos 不引用 bb1）
  let laneMax = { top: -1, bottom: -1 };   // 板脚车道最大值（chip 右列走廊用；useBB 内填充）

  const pinPos = (id, pinName) => {
    let base, type, rotate;
    if (id === board.id) {
      base = { left: board.left, top: board.top };
      type = board.type; rotate = 0;
    } else if (id === 'bb1') {
      base = { left: bb.left, top: bb.top };
      type = bb.type; rotate = bb.rotate || 0;
    } else {
      const p = partById[id];
      if (!p) return null;
      base = { left: p.left, top: p.top };
      type = p.type; rotate = p.rotate || 0;
    }
    // 占位符（chip-<name>）引脚是实例级（按 id 查）；普通元件仍按 type 查
    const pd = (type && type.startsWith('chip-')) ? pins[id] : pins[type];
    if (!pd) return null;
    const off = (rotate === 90 && pd._rot90 && pd._rot90[pinName]) ? pd._rot90[pinName] : pd[pinName];
    if (!off) return null;
    return { x: base.left + off[0], y: base.top + off[1] };
  };

  const boardPinSide = (id, pin) => {
    if (id !== board.id || !pin) return null;
    const p = (pins[board.type] || {})[pin];
    return p && p[1] < board.pinSideThreshold ? 'top' : 'bottom';
  };

  // chip-<name> 占位符出线游标：每实例每列独立计数，用于错开出线 x（避免同列竖线共线）
  const chipEsc = {};
  // 统一信号走廊网格：场景含占位符芯片时，板子上缘所有水平走廊统一编号——
  //   基准 = min(芯片顶, 板顶) - 8，向上每 8 单位一条，车道越大越靠近芯片本体
  //   （左端目标车道 0 = 最高 = 绕行最长；右端目标最低，落线最短不压本体，
  //    任意 laneMax 都不会压到芯片；间距 8 保证视觉可辨）。
  //   无芯片时 corridorYFor 返回 null，各线沿用旧公式（走廊行为不变）。
  //   chipBase 依赖元件最终放置位置，故在放置循环之后赋值（见下方 chipBase=…）。
  let chipBase = null;
  const corridorYFor = (side, lane) => (chipBase == null || side !== 'top')
    ? null
    : chipBase - 8 * (laneMax[side] - lane);
  // 板底走廊带（布线阶段概念）：板子下缘以下、电源类水平线的专属走廊。
  //   上两条槽位预留给板电源主线（生成在后、贴近板底），芯片电源线用更下方
  //   槽位——两族走廊互不交叉；间距 10、距板底 16，与板身保持距离。
  const BELOW_BASE = board.top + board.h + 16;
  const BELOW_STEP = 10;
  let powerBelowIdx = 0;   // 芯片电源线槽位游标（从 BELOW_BASE + 2*BELOW_STEP 起）
  // 板底走廊带公共分配器：领下一个槽位（round 1 位，与 routeWp 内 r1 同语义）
  const nextBelowSlot = () => Math.round((BELOW_BASE + 2 * BELOW_STEP + BELOW_STEP * powerBelowIdx++) * 10) / 10;

  // ============================================================
  // T3.5 Fix A/B（条件触发）：逃逸竖段「列治理」——
  //   Fix B 触发：拟定列落在板盒(uno sizes.json 大包围盒) x 带内，且竖段 y 跨度
  //             触及板盒 y 带（即该竖段实际穿板）→ 推到盒外近侧
  //             (board.left-8 或右缘+8，取离元件中心近者)，水平段相应延长；
  //   Fix A 触发：该列与本次生成中已登记逃逸列水平距离 <6（共线/近触风险）→
  //             沿远离板中心方向步进 8 至空闲列；
  //   两条件都不满足 → 原样返回（现行干净路径逐字节不变）。
  //   usedEscCols 仅登记真实逃逸列，不登记引脚原生列，避免污染干净场景。
  // ============================================================
  const usedEscCols = [];
  const escColFor = (want, src, vTop, vBot) => {
    const r1v = v => Math.round(v * 10) / 10;
    let x = r1v(want);
    let moved = false;
    const touchY = Math.max(vTop, vBot) >= board.top && Math.min(vTop, vBot) <= board.top + board.h;
    if (x >= board.left && x <= board.left + board.w && touchY) {
      // Fix B：穿板列 → 推到盒外近侧
      const mid = src.left + src.w / 2;
      const leftCand = r1v(board.left - 8), rightCand = r1v(board.left + board.w + 8);
      x = Math.abs(mid - leftCand) <= Math.abs(rightCand - mid) ? leftCand : rightCand;
      moved = true;
    }
    if (usedEscCols.some(u => Math.abs(u - x) < 6)) {
      // Fix A：与已用列 <6px → 沿远离板中心方向错开一档(8px)
      const dir = x <= board.left + board.w / 2 ? -1 : 1;
      let guard = 0;
      while (usedEscCols.some(u => Math.abs(u - x) < 6) && guard++ < 80) x = r1v(x + dir * 8);
      moved = true;
    }
    usedEscCols.push(x);
    if (moved) console.error(`[FixAB] 逃逸列调整 x=${r1v(want)}→${x}（${src.id}）`);
    return x;
  };
  // Fix D 上路车道游标：顶区直放元件 → bb 轨改走 bb 上方通道（bb.top-12 起 8px 网格）
  let topFeedLane = 0;
  // T3.5 Fix A 前置①：同元件同排(行)多线登记——同排第 2 条起水平段上移 10*k 错行，
  // 消「同排水平逃离段共线/过近」。仅在真正同排第 2+ 条线时改变行为（首条原样）。
  const escRowCount = {};
  const escRowShift = (fidKey, y) => {
    const key = fidKey + '@' + (Math.round(y * 10) / 10);   // 精确同行（同 y）才错行
    const k = escRowCount[key] || 0;
    escRowCount[key] = k + 1;
    return k;
  };
  // T3.5 Fix A 前置②：同元件「同列引脚」登记——≥2 个引脚同 x（如 lcd VCC/GND 同列）
  // 时该列视为冲突列，各线出线列强制错开。分支放置完成后调用（需 pinPos）。
  let dupPinCols = new Set();
  // 板脚落点侧偏（T3.5）：wired 列登记（scanDupPinCols 填充）+ 已用落点列
  const boardDropCols = [];
  const usedDropCols = [];
  const dropMulti = new Set();   // 同板脚 ≥2 条连接端点（板脚落点侧偏门槛）
  const sideByPin = {};
  const scanDupPinCols = () => {
    const colCount = {};
    const pinEndCount = {};
    boardDropCols.length = 0;
    (intent.connections || []).forEach(c => {
      [c.from, c.to].forEach(ref => {
        const m = ref.match(/^([^:]+):(.+)$/);
        if (!m) return;
        if (m[1] === board.id) {
          // 板上有线脚列登记（板脚落点侧偏的避让依据）
          const bpos = pinPos(board.id, m[2]);
          pinEndCount[m[2]] = (pinEndCount[m[2]] || 0) + 1;
          if (bpos) boardDropCols.push(Math.round(bpos.x * 10) / 10);
          return;
        }
        if (m[1] === 'bb1') return;
        const p = partById[m[1]];
        if (!p || (p.placement || 'bb') === 'bb') return;
        const pos = pinPos(m[1], m[2]);
        if (!pos) return;
        const key = m[1] + '@' + (Math.round(pos.x * 10) / 10);
        colCount[key] = (colCount[key] || 0) + 1;
        if (colCount[key] >= 2) dupPinCols.add(key);
      });
    });
    Object.keys(pinEndCount).forEach(pk => { if (pinEndCount[pk] >= 2) dropMulti.add(pk); });
  };

  // 绝对折线采集(重叠检测用)。main 级声明：routeWp（智能直连判定）与两分支共用同一数组，
  // 分支内只做重置/追加，不重复声明（避免 routeWp 引用 TDZ/块级遮蔽）。
  let wirePaths = [];

  // 绝对折线构建（两个模式的主循环共用）：wps 相对折线 + 终点 → pts 点列
  const ptsOfWps = (a, b, wps) => {
    const pts = [[a.x, a.y]];
    let cx = a.x, cy = a.y;
    for (const m of wps) {
      const mm = /^([hv])(-?[\d.]+)$/.exec(m);
      if (!mm) continue;
      const d = parseFloat(mm[2]);
      if (mm[1] === 'h') cx += d; else cy += d;
      pts.push([cx, cy]);
    }
    pts.push([b.x, b.y]);
    return pts;
  };

  const routeWpRaw = (fid, fpin, a, b, stagger, toId, toPin) => {
    const r1 = v => Math.round(v * 10) / 10;   // 1 位小数
    // T3.5 Fix A：水平逃离族出线段统一构造（条件触发）——
    //   同元件共列引脚(dupPinCols) → 列视为已占，escColFor 强制错开；
    //   同元件同排第 2 条线(rowK>0) → 水平段上移 10*k 错行；
    //   干净单线（无共列、首条、列无需治理）→ 与旧路径逐字节一致。
    const escHorizWps = (sp, powerY, wantCol) => {
      if (dupPinCols.has(fid + '@' + r1(a.x))) usedEscCols.push(r1(a.x));
      const rowK = escRowShift(fid, a.y);
      const y0 = r1(a.y - 10 * rowK);
      const col = escColFor(wantCol, sp, y0, powerY);
      const wps = [];
      if (rowK > 0) wps.push(`v${r1(y0 - a.y)}`);
      if (Math.abs(col - a.x) > 0.05) wps.push(`h${r1(col - a.x)}`);
      wps.push(`v${r1(powerY - y0)}`, `h${r1(b.x - col)}`, `v${r1(b.y - powerY)}`, '@drop');
      return wps;
    };
    // 占位符芯片（DIP 两列引脚）专属出线：左列→左、右列→右先离开芯片包围盒，
    // 再走独立走廊（信号左列走板侧车道、右列走芯片上方走廊；电源走芯片下方走廊，
    // bn 上轨从面包板上方绕入），从结构上消除「竖线沿芯片本体/焊盘穿行」与共线重叠。
    const cp = fid ? partById[fid] : null;
    if (cp && cp.type && cp.type.startsWith('chip-')) {
      const off = (pins[fid] || {})[fpin];
      if (!off) return [];
      const esc = (chipEsc[fid] = chipEsc[fid] || { left: 0, right: 0 });
      const isLeft = off[0] < cp.w / 2;
      const colIdx = isLeft ? esc.left++ : esc.right++;
      const escX0 = r1(isLeft ? cp.left - 6 - colIdx * 6 : cp.left + cp.w + 6 + colIdx * 6);
      // Fix A/B（条件触发）：芯片逃逸列实际穿板盒或与已用列 <6px 时改列，否则原样
      const escX = escColFor(escX0, cp, a.y, BELOW_BASE);
      let laneY;
      if (toId === board.id && /^(3\.3V|VIN)$/.test(toPin || '')) {
        // 直连板脚电源（3.3V/VIN 无专属轨）：走板底走廊带，与电源主线/轨线同带分层
        const powerY = nextBelowSlot();
        return [`h${r1(escX - a.x)}`, `v${r1(powerY - a.y)}`, `h${r1(b.x - escX)}`, `v${r1(b.y - powerY)}`, '@drop'];
      }
      if (toId === board.id) {
        // 信号线：统一走全局走廊网格（corridorYFor，间距 8）；
        // 无芯片场景回退旧公式（左列板侧车道 / 右列芯片上方专属走廊）
        const side = boardPinSide(toId, toPin) || 'top';
        const lane = stagger ? Math.round(Math.abs(stagger) / 8) : 0;
        if (side === 'bottom') {
          const powerY = nextBelowSlot();
          return [`h${r1(escX - a.x)}`, `v${r1(powerY - a.y)}`, `h${r1(b.x - escX)}`, `v${r1(b.y - powerY)}`, '@drop'];
        }
        const cy = corridorYFor(side, lane);
        if (cy != null) {
          laneY = r1(cy);
        } else if (isLeft) {
          laneY = r1(board.top - 7 + stagger);
        } else {
          const slot = (laneMax[side] + 2) - lane;
          laneY = side === 'top' ? r1(cp.top - 8 - 6 * slot) : r1(cp.top + cp.h + 8 + 6 * slot);
        }
      } else if (toId === 'bb1' && /^(bn|bp|tn|tp)\.\d+$/.test(toPin || '')) {
        // 电源线：上轨(bn)走面包板上方走廊；其余轨走「板底走廊带」——
        // 主线槽位之下按序分配（VCC/GND 等各占一条，互不共线），从板子下方
        // 绕行、与上方信号网格彻底分开，落轨纵段只贴轨边，不横穿面包板/板身。
        const powerY = b.y < bb.top ? r1(bb.top - 8)
          : nextBelowSlot();
        return [`h${r1(escX - a.x)}`, `v${r1(powerY - a.y)}`, `h${r1(b.x - escX)}`, `v${r1(b.y - powerY)}`, '@drop'];
      } else {
        laneY = r1(b.y);
      }
      return [`h${r1(escX - a.x)}`, `v${r1(laneY - a.y)}`, `h${r1(b.x - escX)}`, `v${r1(b.y - laneY)}`];
    }
    if (fid === board.id) {
      // 板源 → 目标：出线到板外安全带（远一点，给别的线留空间），不沿引脚排横穿
      const side = boardPinSide(fid, fpin);
      const lane = stagger ? Math.round(Math.abs(stagger) / 8) : 0;
      const cy = corridorYFor(side, lane);
      const safeY = cy != null ? cy : (side === 'top' ? board.top - 15 : board.top + board.h + 15) + stagger;
      const v1 = r1(safeY - a.y);
      // 目标若是直连元件，且竖直段会纵穿其包围盒 → 先走到元件外侧，再水平进引脚（先离开区域再走线）
      const tp = toId ? partById[toId] : null;
      let outX = null;
      if (tp && tp.placement && tp.placement !== 'bb' && b.x >= tp.left && b.x <= tp.left + tp.w) {
        const cx = tp.left + tp.w / 2;
        const margin = 6;
        outX = r1(b.x >= cx ? tp.left + tp.w + margin : tp.left - margin);
      }
      const h1 = r1((outX != null ? outX : b.x) - a.x);
      const v3 = r1(b.y - (a.y + v1));
      const wp = [`v${v1}`, `h${h1}`, `v${v3}`];
      if (outX != null && Math.abs(b.x - outX) > 0.5) {
        wp.push(`h${r1(b.x - outX)}`);
        // T3.5 Fix A 前置: 板→元件信号线经元件侧沿入脚（末段在该元件引脚行）——
        // 登记该行, 使后续同排逃逸线（如 VCC/GND 馈线）自动错行（条件触发, 仅登记）
        if (tp) escRowShift(toId, b.y);
      }
      return wp;
    }
    if (toId === 'bb1' && /^(bn|bp|tn|tp)\.\d+$/.test(toPin || '')) {
      // 长线电源→轨(placement !== 'bb' 的元件): 走板底走廊带领槽,
      // 不再贴轨高度直连(消除与其它电源线共线、穿面包板本体、与信号走廊 1px 粘连)
      const src = partById[fid];
      if (src && (src.placement || 'bb') !== 'bb') {
        // 智能直连判定：贴轨直连本就干净（短线）时不再绕板底走廊带。
        // 三条件全满足 → 直连 [v,h]；任一不满足 → 走板底走廊带（下方兜底）。
        if (src.w != null) {
          const railY = b.y;
          const h0 = Math.min(a.x, b.x), h1 = Math.max(a.x, b.x);
          // 条件1: 水平段不穿板身(2 单位容差)
          const boardHit = railY >= board.top && railY <= board.top + board.h &&
                           h1 >= board.left + 2 && h0 <= board.left + board.w - 2;
          // 条件2: 不与已生成线的同高水平段共线(重叠 >2)
          const sameYHit = wirePaths.some(w => w.pts.some((pt, i) => {
            const q = w.pts[i + 1]; if (!q) return false;
            if (Math.abs(pt[1] - railY) > 0.1 || Math.abs(q[1] - railY) > 0.1) return false;
            const lo = Math.min(pt[0], q[0]), hi = Math.max(pt[0], q[0]);
            return Math.min(h1, hi) - Math.max(h0, lo) > 2;
          }));
          // 条件3: 竖段不穿自家本体(2 单位容差)
          const vLo = Math.min(a.y, railY), vHi = Math.max(a.y, railY);
          const ownHit = a.x >= src.left + 2 && a.x <= src.left + src.w - 2 &&
                         Math.max(vLo, src.top + 2) < Math.min(vHi, src.top + src.h - 2);
          // Fix C（条件4，条件触发）: 直连两段(v@a.x 跨 [vLo,vHi] / h@railY 跨 [h0,h1])
          // 与任何其他元件 rect 重叠 >20px → 判不满足，改走板底走廊带。
          // 排除线两端所属元件自身；面包板本体不在 parts 表，天然排除。
          const partHit = parts.some(q => {
            if (!q || q.id === fid || q.id === toId || q.w == null || q.left == null) return false;
            const vLen = (a.x >= q.left && a.x <= q.left + q.w)
              ? Math.min(vHi, q.top + q.h) - Math.max(vLo, q.top) : -1;
            const hLen = (railY >= q.top && railY <= q.top + q.h)
              ? Math.min(h1, q.left + q.w) - Math.max(h0, q.left) : -1;
            return Math.max(vLen, hLen) > 20;
          });
          if (!boardHit && !sameYHit && !ownHit && !partHit) {
            // 贴轨直连(短跳线): 不绕板底走廊带
            return [`v${r1(railY - a.y)}`, `h${r1(b.x - a.x)}`];
          }
        }
        const powerY = nextBelowSlot();
        // Fix D（条件触发）: 源元件整体在板盒上缘之上(src.top+src.h < board.top)且目标
        // 是 bb 轨 → 不再下坠板底走廊，改走「上路」：升到 bb 上方通道(bb.top-12 起
        // 8px 网格，按序领道)，水平行至轨位 x 上方，竖直落轨。全程 y < board.top，
        // 不穿板盒；从上方进轨不穿 bb（bench 对面包板单独口径）。越界(laneY<8)或
        // 上行竖段穿自家本体 >20px → 回退现行下路（Fix A/B/C 修正后）。
        if (bb && src.top != null && src.top + src.h < board.top && bb.top - 12 >= 8) {
          const selfAtPin = a.x > src.left && a.x < src.left + src.w &&
            Math.min(a.y, src.top + src.h) - Math.max(bb.top - 12, src.top) > 20;
          if (selfAtPin) {
            // pin 列上行会穿自家本体 → 仍走上路，但先水平让到体外近侧列再上行
            //（全程 y ≤ a.y < board.top，不穿板盒；体外列不穿本体）
            const laneY = r1(bb.top - 12 - 8 * topFeedLane++);
            const want = a.x < src.left + src.w / 2 ? r1(src.left - 6) : r1(src.left + src.w + 6);
            // Fix A 前置（条件触发）: 共列出线/同排多线 → 列/行错开（干净单线原样）
            if (dupPinCols.has(fid + '@' + r1(a.x))) usedEscCols.push(r1(a.x));
            const rowK = escRowShift(fid, a.y);
            const y0 = r1(a.y - 10 * rowK);
            const col = escColFor(want, src, y0, laneY);
            const wps = [];
            if (rowK > 0) wps.push(`v${r1(y0 - a.y)}`);
            wps.push(`h${r1(col - a.x)}`, `v${r1(laneY - y0)}`, `h${r1(b.x - col)}`, `v${r1(b.y - laneY)}`);
            return wps;
          }
          // pin 列直上不穿本体 → 直接上路（车道只在真正上路时消耗，回退下路不占道）
          const laneY = r1(bb.top - 12 - 8 * topFeedLane++);
          if (laneY >= 8) {
            return [`v${r1(laneY - a.y)}`, `h${r1(b.x - a.x)}`, `v${r1(b.y - laneY)}`];
          }
        }
        // 逃离三分：顶缘/上半部垂直上逃（错开高度列）、底缘/体外下方直接下穿、
        // 中部/侧列水平逃离——同排引脚避免水平逃离段共线
        const esc = (chipEsc[fid] = chipEsc[fid] || { left: 0, right: 0, up: 0 });
        const goLeft = b.x < src.left + src.w / 2;
        if (a.y < src.top + src.h / 2) {
          // 顶缘/上半部引脚: 垂直上逃, 逃到统一走廊网格上方, 高度/列都错开
          // Fix B（条件触发）: 首竖段(pin 列)穿板盒 → 改为引脚高度水平逃逸 +
          // 治理列单竖段直落走廊；否则第二竖段列仍过 Fix A/B 列治理（干净时原样）
          const idx = esc.up++;
          const top0 = corridorYFor('top', 0);
          const escTop = (top0 != null ? top0 : src.top) - 6;
          const escY = r1(escTop - idx * 6);
          const escX0 = r1((goLeft ? src.left : src.left + src.w) + (goLeft ? -6 : 6) + idx * 6);
          // Fix A 前置（条件触发）: 同元件共列出线 → 弃「pin 列直上」形态（消同列 pin
          // 竖段共线/端点近触）; Fix B（条件触发）: pin 列直上穿板盒 → 水平先逃 +
          // 治理列直落。两者都不满足才走原 5 段上逃形态。
          if (dupPinCols.has(fid + '@' + r1(a.x)) ||
              (a.x >= board.left && a.x <= board.left + board.w &&
               Math.max(a.y, escY) >= board.top && Math.min(a.y, escY) <= board.top + board.h)) {
            return escHorizWps(src, powerY, a.x);
          }
          const escX = escColFor(escX0, src, escY, powerY);
          return [`v${r1(escY - a.y)}`, `h${r1(escX - a.x)}`, `v${r1(powerY - escY)}`,
                  `h${r1(b.x - escX)}`, `v${r1(b.y - powerY)}`, '@drop'];
        }
        if (a.y >= src.top + src.h - 4) {
          // 底缘/体外下方引脚: 已离开本体, 直接下穿(无需逃离)
          // Fix B/A/前置（条件触发）: 列穿板盒/<6px 近触/共列/同排 → 治理, 否则原样
          return escHorizWps(src, powerY, a.x);
        }
        // 中部/侧列引脚: 水平逃离（列过 Fix A/B 治理，干净时原样）
        const idx = goLeft ? esc.left++ : esc.right++;
        return escHorizWps(src, powerY, r1(goLeft ? src.left - 6 - idx * 6 : src.left + src.w + 6 + idx * 6));
      }
      // 面包板上的短跳线(placement==='bb'): 保持原有贴轨直连, 不领槽
    }
    if (toId === board.id && /^(3\.3V|VIN)$/.test(toPin || '')) {
      const powerY = nextBelowSlot();
      const p = partById[fid];
      if (p) {
        // 逃离三分：顶缘/上半部垂直上逃（错开高度列）、底缘/体外下方直接下穿、
        // 中部/侧列水平逃离——同排引脚避免水平逃离段共线
        const esc = (chipEsc[fid] = chipEsc[fid] || { left: 0, right: 0, up: 0 });
        const goLeft = b.x < p.left + p.w / 2;
        if (a.y < p.top + p.h / 2) {
          // 顶缘/上半部引脚: 垂直上逃, 逃到统一走廊网格上方, 高度/列都错开
          // Fix B（条件触发）: 首竖段(pin 列)穿板盒 → 引脚高度水平逃逸 + 治理列直落
          const idx = esc.up++;
          const top0 = corridorYFor('top', 0);
          const escTop = (top0 != null ? top0 : p.top) - 6;
          const escY = r1(escTop - idx * 6);
          const escX0 = r1((goLeft ? p.left : p.left + p.w) + (goLeft ? -6 : 6) + idx * 6);
          // Fix A 前置 / Fix B（条件触发）: 共列出线或 pin 列直上穿板盒 → 水平先逃 + 治理列直落
          if (dupPinCols.has(fid + '@' + r1(a.x)) ||
              (a.x >= board.left && a.x <= board.left + board.w &&
               Math.max(a.y, escY) >= board.top && Math.min(a.y, escY) <= board.top + board.h)) {
            return escHorizWps(p, powerY, a.x);
          }
          const escX = escColFor(escX0, p, escY, powerY);
          return [`v${r1(escY - a.y)}`, `h${r1(escX - a.x)}`, `v${r1(powerY - escY)}`,
                  `h${r1(b.x - escX)}`, `v${r1(b.y - powerY)}`, '@drop'];
        }
        if (a.y >= p.top + p.h - 4) {
          // 底缘/体外下方引脚: 已离开本体, 直接下穿(无需逃离)
          // Fix B/A/前置（条件触发）: 列穿板盒/<6px 近触/共列/同排 → 治理, 否则原样
          return escHorizWps(p, powerY, a.x);
        }
        // 中部/侧列引脚: 水平逃离（列过 Fix A/B 治理，干净时原样）
        const idx = goLeft ? esc.left++ : esc.right++;
        return escHorizWps(p, powerY, r1(goLeft ? p.left - 6 - idx * 6 : p.left + p.w + 6 + idx * 6));
      }
      return [`v${r1(powerY - a.y)}`, `h${r1(b.x - a.x)}`, `v${r1(b.y - powerY)}`, '@drop'];
    }
    if (toId === board.id) {
      // 元件源 → 板脚：贴近板子的安全带（短接近，避免横跨别的线）
      const side = boardPinSide(toId, toPin);
      if (side === 'bottom') {
        // 板底侧目标(模拟脚 A0-A5 等): 走板底走廊带领槽, 替代旧的
        // board.top+board.h+7+stagger 走廊(该旧走廊与主线 527/537 网格不同源, 易共线)
        const powerY = nextBelowSlot();
        const p = partById[fid];
        if (p) {
          // 逃离三分：顶缘/上半部垂直上逃（错开高度列）、底缘/体外下方直接下穿、
          // 中部/侧列水平逃离——同排引脚避免水平逃离段共线
          const esc = (chipEsc[fid] = chipEsc[fid] || { left: 0, right: 0, up: 0 });
          const goLeft = b.x < p.left + p.w / 2;
          if (a.y < p.top + p.h / 2) {
            // 顶缘/上半部引脚: 垂直上逃, 逃到统一走廊网格上方, 高度/列都错开
            // Fix B（条件触发）: 首竖段(pin 列)穿板盒 → 引脚高度水平逃逸 + 治理列直落
            const idx = esc.up++;
            const top0 = corridorYFor('top', 0);
            const escTop = (top0 != null ? top0 : p.top) - 6;
            const escY = r1(escTop - idx * 6);
            const escX0 = r1((goLeft ? p.left : p.left + p.w) + (goLeft ? -6 : 6) + idx * 6);
            // Fix A 前置 / Fix B（条件触发）: 共列出线或 pin 列直上穿板盒 → 水平先逃 + 治理列直落
            if (dupPinCols.has(fid + '@' + r1(a.x)) ||
                (a.x >= board.left && a.x <= board.left + board.w &&
                 Math.max(a.y, escY) >= board.top && Math.min(a.y, escY) <= board.top + board.h)) {
              return escHorizWps(p, powerY, a.x);
            }
            const escX = escColFor(escX0, p, escY, powerY);
            return [`v${r1(escY - a.y)}`, `h${r1(escX - a.x)}`, `v${r1(powerY - escY)}`,
                    `h${r1(b.x - escX)}`, `v${r1(b.y - powerY)}`, '@drop'];
          }
          if (a.y >= p.top + p.h - 4) {
            // 底缘/体外下方引脚: 已离开本体, 直接下穿(无需逃离)
            // Fix B/A/前置（条件触发）: 列穿板盒/<6px 近触/共列/同排 → 治理, 否则原样
            return escHorizWps(p, powerY, a.x);
          }
          // 中部/侧列引脚: 水平逃离（列过 Fix A/B 治理，干净时原样）
          const idx = goLeft ? esc.left++ : esc.right++;
          return escHorizWps(p, powerY, r1(goLeft ? p.left - 6 - idx * 6 : p.left + p.w + 6 + idx * 6));
        }
        return [`v${r1(powerY - a.y)}`, `h${r1(b.x - a.x)}`, `v${r1(b.y - powerY)}`, '@drop'];
      }
      const lane = stagger ? Math.round(Math.abs(stagger) / 8) : 0;
      const cy = corridorYFor(side, lane);
      const safeY = cy != null ? cy : (side === 'top' ? board.top - 7 : board.top + board.h + 7) + stagger;
      const v1 = r1(safeY - a.y);
      const h1 = r1(b.x - a.x);
      const v3 = r1(b.y - (a.y + v1));
      return [`v${v1}`, `h${h1}`, `v${v3}`];
    }
    // 元件 → 元件：非错开时只保留必要段（去掉 v0 与 <0.5px 微小段）；错开时保留 Z 形三段
    const dy = b.y - a.y;
    const dx = b.x - a.x;
    if (stagger === 0) {
      const wp = [];
      if (Math.abs(dy) > 0.5) wp.push(`v${r1(dy)}`);
      if (Math.abs(dx) > 0.5) wp.push(`h${r1(dx)}`);
      if (wp.length === 0) wp.push('v0');
      return wp;
    }
    return [`v${r1(dy + stagger)}`, `h${r1(dx)}`, `v${r1(-stagger)}`];
  };
  // ============================================================
  // T3.5 板脚落点侧偏包装器（条件触发）：走廊分支以 '@drop' 哨兵声明
  // 「末段直落板脚」；同一板脚的第 2+ 条线及与相邻有线脚冲突时，从候选序列
  // （左7/右7/左14/右14/左21/右21/左28/右28）选首个不撞「其他有线脚列(±15)」
  // 且不撞「已用落点列(±3)」的侧偏入脚列（消同脚落点竖段共线/端点近触）。
  // ============================================================
  const routeWp = (fid, fpin, a, b, stagger, toId, toPin) => {
    const rr1 = v => Math.round(v * 10) / 10;
    const wps = routeWpRaw(fid, fpin, a, b, stagger, toId, toPin);
    const i = wps.indexOf('@drop');
    if (i < 0) return wps;
    const rest = wps.slice(0, i);
    if (toId !== board.id) return rest;
    // 仅「同板脚 ≥2 条走廊线」才侧偏（单线板脚保持原样, golden 逐字节不变）
    if (!dropMulti.has(toPin)) return rest;
    const others = boardDropCols.filter(cx => Math.abs(cx - b.x) > 0.5);
    const free = (cd) => !others.some(cx => Math.abs(cx - cd) < 2.3) &&
                         !usedDropCols.some(ux => Math.abs(ux - cd) < 3);
    // 侧向：首选躲开有线脚聚集的一侧；同脚第 2 条线强制换边（消同脚入脚段嵌套共线）
    const leftCrowd = others.some(cx => cx < b.x && b.x - cx < 12);
    const rightCrowd = others.some(cx => cx > b.x && cx - b.x < 12);
    const dk = toId + '@' + rr1(b.x);
    const sgn = sideByPin[dk] != null ? -sideByPin[dk]
      : ((leftCrowd && !rightCrowd) ? 1 : -1);
    sideByPin[dk] = sgn;
    let dropX = null;
    for (const m of [7, 14, 21, 28]) {
      const cd = b.x + sgn * m;
      if (free(cd)) { dropX = rr1(cd); break; }
    }
    if (dropX == null) dropX = rr1(b.x + sgn * 7);
    usedDropCols.push(dropX);
    if (Math.abs(dropX - b.x) <= 0.05) return rest;
    const mv = /^v(-?[\d.]+)$/.exec(wps[i - 1]);
    const dy = mv ? parseFloat(mv[1]) : 0;
    const out = wps.slice(0, i - 1);
    out.push(`h${rr1(dropX - b.x)}`, `v${dy}`, `h${rr1(b.x - dropX)}`);
    return out;
  };

  // ============================================================
  // 面包板模式（v0.7 重写）
  // 几何模型从 dragramtest.json（用户手动模板，已实测验证）校准。
  // 面包板 rotate=180（与模板一致，视觉正确）。
  // 孔位 (row n, half h∈{t,b}, letter L∈{a..j}) 画布坐标：
  //   rx(n)   = bb.left + 303 - (n-1)*9.6        （数字=水平，rotate180 后反向）
  //   ry(L,h) = bb.top  + 157 - idx(L)*9.6 - (h==='b' ? 19.2 : 0)
  // ⚠️ 半区每侧仅 5 孔：t 半区字母 a-e，b 半区字母 f-j（freeHole 只在这些字母里选，见 HALF_RANGE）
  // 各元件 $bb 配方（引脚→孔位 + 位置锚点，均实测校准）：
  //   按钮(rot90): 1.r→(n,t,b) 2.r→(n+2,t,b) 1.l→(n,b,g) 2.l→(n+2,b,g)；锚点 1.l 偏移 (44.5,-9.5)
  //   电阻(rot90): 1→(n,b,g) 2→(n,t,c)；锚点 1 偏移 (29.35,-24.0)
  //   DHT  (rot0) : GND→(n,b,i) NC→(n+1,b,i) SDA→(n+2,b,i) VCC→(n+3,b,i)；锚点 GND 偏移从 pins.json 取
  //   LED  (rot0) : 不用 $bb！可见线 A→孔(绿色)
  // ============================================================
  if (useBB) {
    // 几何单一事实源 geometry.json（数值与 optimize-wiring.js / breadboard.md 一致）
    const G = (loadGeometry() || {}).breadboard || {};
    const PITCH = G.pitch || 9.6;
    const BB_W = G.width || 313.6;
    const BB_H = G.height || 166;
    const OFF_X = (G.hole && G.hole.offsetX) || 10.6;
    const OFF_Y = (G.hole && G.hole.offsetY) || 9;
    const OFF_B = (G.hole && G.hole.halfBOffset) || 19.2;
    const RAIL_G = G.rail || {};
    bb = { type: intent.breadboard || 'wokwi-breadboard-half', id: 'bb1', top: 100, left: 0, rotate: 180, w: BB_W, h: BB_H };
    const LETTER = 'abcdefghij';
    const idx = L => LETTER.indexOf(L);
    const rx = n => bb.left + (BB_W - OFF_X) - (n - 1) * PITCH;
    const ry = (L, h) => bb.top + (BB_H - OFF_Y) - idx(L) * PITCH - (h === 'b' ? OFF_B : 0);
    const r2 = v => Math.round(v * 100) / 100;   // 保留 2 位小数，$bb 引脚精确对齐孔位（Wokwi 需精确位置才显示插接绿点）

    const bbParts = parts.filter(p => (p.placement || 'bb') === 'bb');
    const boardParts = parts.filter(p => (p.placement || 'bb') !== 'bb');

    const bbConns = [];   // $bb 插接连接
    const wireConns = []; // 可见线连接（LED 等）
    wirePaths = [];   // 重置折线采集（main 级数组，routeWp 智能直连判定共用）
    const is = (p, t) => (p.type || '').includes(t);

    // ============================================================
    // Phase 2：zone/region/hint 灰度开口（intent-format.md 契约）
    // 列带（rotate180 后列号大 = 视觉靠左）：
    //   left   左列带（output）: 电阻 27 / LED 26，步进 3
    //   middle 中列带（input） : 按钮 15，步进 5
    //   right  右列带（sensor/misc/display）: dht 4，步进 6
    // 兜底 = type→zone 推断（= 现行硬编码行为）；显式 zone/region 优先于推断。
    // 跨带游标值（如 left 带放按钮）为「可接受 + 适配」的兜底猜测，非最优，Wokwi 确认后回填。
    // ============================================================
    const ZONE_BAND = { output: 'left', input: 'middle', sensor: 'right', display: 'right', misc: 'right' };
    const REGION_BAND = { left: 'left', middle: 'middle', right: 'right' };
    const TYPE_ZONE = {
      led: 'output', resistor: 'output',
      pushbutton: 'input', switch: 'input',
      dht: 'sensor',
      oled: 'display', ssd1306: 'display',
      buzzer: 'misc', speaker: 'misc'
    };
    const BAND_START = {
      left:   { pushbutton: 27, resistor: 27, led: 26, dht: 20 },
      middle: { pushbutton: 15, resistor: 15, led: 15, dht: 12 },
      right:  { pushbutton: 8,  resistor: 8,  led: 8,  dht: 4  }
    };
    const TYPE_STEP = { pushbutton: 5, resistor: 3, led: 3, dht: 6 };

    // part → 有效列带：region 显式 > zone 显式 > type 推断（非法值回退 + 日志）
    const bandOf = {};
    const groupById = {};
    groups.forEach(g => g.parts.forEach(id => { groupById[id] = g; }));
    const bandCursor = {};   // band → { type: cursor }
    ['left', 'middle', 'right'].forEach(b => { bandCursor[b] = Object.assign({}, BAND_START[b]); });
    bbParts.forEach(p => {
      const g = groupById[p.id];
      let band = null;
      if (g) {
        const reg = g.region;
        if (reg && REGION_BAND[reg]) band = REGION_BAND[reg];
        else if (reg && reg !== 'bb') console.error(`[WARN] 非法 region '${reg}'（组 ${g.name}），回退 zone/type`);
        if (!band && g.zone) {
          if (ZONE_BAND[g.zone]) band = ZONE_BAND[g.zone];
          else console.error(`[WARN] 非法 zone '${g.zone}'（组 ${g.name}），回退 type 推断`);
        }
      }
      if (!band) {
        for (const t in TYPE_ZONE) { if (is(p, t)) { band = ZONE_BAND[TYPE_ZONE[t]]; break; } }
      }
      bandOf[p.id] = band || 'right';
    });

    // 从网表推导 LED↔电阻配对（如 r1:2 → led1:A），让 LED 放到其电阻正上方同列，
    // 避免「电阻在左、LED 在右」造成的长水平拖线 + 多段转弯
    const resOfLed = {};   // ledId -> resistorId
    (intent.connections || []).forEach(c => {
      const f = c.from.split(':')[0], t = c.to.split(':')[0];
      if (/^led/i.test(f) && /^r\d+/i.test(t)) resOfLed[f] = t;
      else if (/^r\d+/i.test(f) && /^led/i.test(t)) resOfLed[t] = f;
    });
    // 预分配列：电阻先占列；LED 复用其配对电阻的列（无配对电阻的 LED 用独立游标）
    const resColumn = {};   // resId -> column
    bbParts.forEach(p => {
      if (is(p, 'resistor')) {
        const cur = bandCursor[bandOf[p.id]].resistor;
        resColumn[p.id] = cur;
        bandCursor[bandOf[p.id]].resistor = cur - TYPE_STEP.resistor;
      }
    });
    const ledColumn = {};   // ledId -> column
    bbParts.forEach(p => {
      if (is(p, 'led')) {
        const resId = resOfLed[p.id];
        if (resId && resColumn[resId] != null) ledColumn[p.id] = resColumn[resId];
        else {
          const cur = bandCursor[bandOf[p.id]].led;
          ledColumn[p.id] = cur;
          bandCursor[bandOf[p.id]].led = cur - TYPE_STEP.led;
        }
      }
    });

    // 按钮列预分配：默认按「信号脚 x」排（左板脚→左按钮，避免右板脚连左按钮的交叉）；hint.order 覆盖
    //   'left' → 最左，'right' → 最右，序号 → 从左数第几个（1-based）
    const btnColumn = {};
    const btnRank = {};
    const btnSignalX = {};
    (intent.connections || []).forEach(c => {
      const f = c.from, t = c.to;
      const m1 = f.match(board.digitPat), m2 = t.match(/^(btn\d+):2\.r$/);
      if (m1 && m2) { const pd = (pins[board.type] || {})[m1[1]]; if (pd) btnSignalX[m2[1]] = pd[0]; }
      else {
        const m3 = t.match(board.digitPat), m4 = f.match(/^(btn\d+):2\.r$/);
        if (m3 && m4) { const pd = (pins[board.type] || {})[m3[1]]; if (pd) btnSignalX[m4[1]] = pd[0]; }
      }
    });
    const btnList = bbParts.filter(p => is(p, 'pushbutton'));
    btnList.forEach((p, i) => {
      const h = p.hint && p.hint.order;
      let rank;
      if (h == null) rank = (btnSignalX[p.id] != null) ? btnSignalX[p.id] : i;
      else if (h === 'left') rank = -1;
      else if (h === 'right') rank = btnList.length;
      else if (typeof h === 'number' && isFinite(h)) rank = h - 1;
      else { console.error(`[WARN] 非法 hint.order '${h}'（${p.id}），回退默认顺序`); rank = i; }
      btnRank[p.id] = rank;
    });
    const btnByBand = {};
    btnList.forEach(p => { (btnByBand[bandOf[p.id]] = btnByBand[bandOf[p.id]] || []).push(p); });
    Object.keys(btnByBand).forEach(band => {
      const list = btnByBand[band].sort((a, b) =>
        (btnRank[a.id] - btnRank[b.id]) || (btnList.indexOf(a) - btnList.indexOf(b)));
      let cur = bandCursor[band].pushbutton + (list.length - 1) * TYPE_STEP.pushbutton;
      list.forEach(p => { btnColumn[p.id] = cur; cur -= TYPE_STEP.pushbutton; });
    });

    bbParts.forEach(p => {
      if (is(p, 'pushbutton')) {
        const n = btnColumn[p.id];
        bbConns.push([`${p.id}:1.r`, `bb1:${n}t.b`, '', ['$bb']]);
        bbConns.push([`${p.id}:2.r`, `bb1:${n + 2}t.b`, '', ['$bb']]);
        bbConns.push([`${p.id}:1.l`, `bb1:${n}b.g`, '', ['$bb']]);
        bbConns.push([`${p.id}:2.l`, `bb1:${n + 2}b.g`, '', ['$bb']]);
        p.rotate = 90;
        p.left = r2(rx(n) - 44.5);
        p.top = r2(ry('g', 'b') + 9.5);
      } else if (is(p, 'resistor')) {
        const n = resColumn[p.id];
        bbConns.push([`${p.id}:1`, `bb1:${n}b.g`, '', ['$bb']]);
        bbConns.push([`${p.id}:2`, `bb1:${n}t.c`, '', ['$bb']]);
        p.rotate = 90;
        p.left = r2(rx(n) - 29.35);
        p.top = r2(ry('g', 'b') + 24.0);
      } else if (is(p, 'dht')) {
        const n = bandCursor[bandOf[p.id]].dht;
        bbConns.push([`${p.id}:GND`, `bb1:${n}b.i`, '', ['$bb']]);
        bbConns.push([`${p.id}:NC`, `bb1:${n + 1}b.i`, '', ['$bb']]);
        bbConns.push([`${p.id}:SDA`, `bb1:${n + 2}b.i`, '', ['$bb']]);
        bbConns.push([`${p.id}:VCC`, `bb1:${n + 3}b.i`, '', ['$bb']]);
        const dhtGnd = (pins[p.type] || {}).GND || [39.8, 110.9];   // GND 引脚偏移（pins.json 单一事实源，网页版悬停实测）
        p.left = r2(rx(n) - dhtGnd[0]);
        p.top = r2(ry('i', 'b') - dhtGnd[1]);
        bandCursor[bandOf[p.id]].dht = n + TYPE_STEP.dht;
      } else if (is(p, 'led')) {
        // LED：放到配对电阻的正上方同列（不用 $bb，连线由网表生成可见线）
        const n = ledColumn[p.id];
        p.left = r2(rx(n) - 25);   // A 引脚 x 对准孔
        p.top = bb.top - 80;
      } else {
        // 未知类型：回退为直连（放板子旁）
        boardParts.push(p);
      }
    });

    // 直连元件：分区围绕板子（top/right/bottom/left）；region 显式 > zone 映射 > right 兜底
    const dRegions = {
      top:    { x: board.left, y: board.top - 160 - EXPAND.top },
      right:  { x: board.left + board.w + 40 + EXPAND.right, y: board.top - 20 },
      bottom: { x: board.left, y: board.top + board.h + 80 + EXPAND.bottom },
      left:   { x: board.left - 160 - EXPAND.left, y: board.top }
    };
    const dCursor = { top: 0, right: 0, bottom: 0, left: 0 };
    (intent.groups || []).forEach(g => {
      const reg = ['top', 'right', 'bottom', 'left'].includes(g.region) ? g.region
                : (ZONE_DIRECT[g.zone] || 'right');
      const base = dRegions[reg];
      let x = base.x + dCursor[reg];
      g.parts.forEach(id => {
        const p = partById[id];
        if (!p || p.placement === 'bb') return;
        p.left = Math.round(x);
        p.top = Math.round(base.y);
        x += p.w + MIN_SPACING;
        dCursor[reg] += p.w + MIN_SPACING;
      });
    });

    // 统一信号走廊基准（依赖上面刚算出的元件最终 top；必须在放置之后）
    // 常开：无芯片时基准 = 板顶-8，板源线与元件→板线共用同一 8px 网格（消除两套旧网格相差 8 的共线）
    const chipList = parts.filter(p => p.type && p.type.startsWith('chip-'));
    chipBase = chipList.length ? Math.min(...chipList.map(p => p.top), board.top) - 8 : board.top - 8;

    // T3.5 Fix A 前置：共列引脚登记 + 逃逸行计数复位（放置完成后才有 pinPos）
    scanDupPinCols();
    for (const k in escRowCount) delete escRowCount[k];

    // $bb 元件锚点孔所在行 x = 其可见出线列。轨位选择时回避其他线的出线列(±4),
    // 避免落点贴着别的出线竖段(如 dht VCC 落 tp.5 与 SDA 出线 0.4 单位近触)。
    const anchorCols = new Set();
    bbConns.forEach(c => {
      const m = c[1].match(/bb1:(\d+)([tb])\.([a-j])/);
      if (m) anchorCols.add(rx(parseInt(m[1], 10)));
    });

    // ============================================================
    // 走线生成（v1）：读取 intent.connections 逻辑网表，生成物理连线
    // 模型给网表（谁连谁），脚本按引脚坐标 + 出线方向生成可见线
    // ============================================================
    // ============================================================
    // 面包板中心走线（A1）：插面板元件（$bb）的信号线连到「同行空闲孔」，
    // 靠面包板内部连通（同行同半区），而非直连引脚 —— 从结构上消除同 x 重叠
    // ============================================================
    const pinHole = {};    // "r1:1" → {row, half, letter}
    const usedHoles = {};  // "27:b" → Set(letter)
    bbConns.forEach(c => {
      const m = c[1].match(/bb1:(\d+)([tb])\.([a-j])/);
      if (m) {
        const row = parseInt(m[1]), half = m[2], letter = m[3];
        pinHole[c[0]] = { row, half, letter };
        const key = `${row}:${half}`;
        (usedHoles[key] = usedHoles[key] || new Set()).add(letter);
      }
    });
    // 孔位字母区间：t 半区 = a-e，b 半区 = f-j（每半区仅 5 孔，中间 trench 隔开）。
    // 内部连通 = 同行 + 同半区 + 同 5 孔组；跨半区（t↔b）或跨组（a-e↔f-j）都必须跳线。
    // 因此 freeHole 只能在所属半区的 5 个字母里选，且优先选「离元件引脚最近的空闲孔」，
    // 让可见线落在元件脚旁边（内部 hop 最短），而不是跳到最外侧的 a/j 多绕路。
    const HALF_RANGE = G.halfRange || { t: [0, 4], b: [5, 9] };   // [minIdx, maxIdx] of 'abcdefghij'
    const freeHole = (row, half, pinLetter, dir) => {
      const [lo, hi] = HALF_RANGE[half];
      const key = `${row}:${half}`;
      const used = usedHoles[key] || (usedHoles[key] = new Set());
      const pinIdx = LETTER.indexOf(pinLetter);
      const step = dir >= 0 ? 1 : -1;
      // 朝 dir 方向（dir>=0 朝更大 idx，即视觉上方）找离 pin 最近的空闲孔
      for (let i = pinIdx + step; i >= lo && i <= hi; i += step) {
        const L = LETTER[i];
        if (!used.has(L)) { used.add(L); return { row, half, letter: L }; }
      }
      // 方向到头了 → 反向回退找
      for (let i = pinIdx - step; i >= lo && i <= hi; i -= step) {
        const L = LETTER[i];
        if (!used.has(L)) { used.add(L); return { row, half, letter: L }; }
      }
      return null;
    };
    const holePos = (h) => ({ x: rx(h.row), y: ry(h.letter, h.half) });

    // ============================================================
    // 电源架构（A2）：GND/5V 走电源轨，而非直连板子引脚（就近走轨不穿板）
    // 轨几何（已实测确认：用户悬停孔名 + dragramtest 模板精确对齐）：
    //   bn=下负轨(视觉顶部) bp=下正轨 tn=上负轨 tp=上正轨(视觉底部)
    //   轨列：25 位置 = 5 组 × 5 孔，组间多 1 个孔距间隙（标准面包板结构）
    //   x(n) = left + 293.0 - (idx + floor(idx/5)) * 9.6, idx = n-1（rotate 180 基准）
    //   位置号有效范围 1..25（>25 的引用 Wokwi 不渲染 → 线消失）
    //   锚点：bn.23 在 LED1 阴极正下方（用户确认）；bn.25/bn.22 与模板 led1/2:C 精确重合
    // ============================================================
    const RAIL_MAX = RAIL_G.maxPosition || 25;
    const RAIL_GRP = RAIL_G.groupSize || 5;
    const railX = (n) => bb.left + (BB_W - (RAIL_G.xLeftRot0 || 20.6)) - ((n - 1) + Math.floor((n - 1) / RAIL_GRP)) * PITCH;
    // railY 实测校准：bn 视觉顶轨 = top+5.6（按钮线"半孔"折回 → 原 4 偏上 1.6px）
    const RY = RAIL_G.yRot180 || { bn: 5.6, bp: 15.2, tn: 156, tp: 162 };
    const railY = { bn: bb.top + RY.bn, bp: bb.top + RY.bp, tn: bb.top + RY.tn, tp: bb.top + RY.tp };
    const railPos = (rail, n) => ({ x: railX(n), y: railY[rail] });
    // 识别电源连线（目标 = uno:GND/5V/3V3/VIN）→ 连对应轨
    const railUsed = { bn: new Set(), bp: new Set(), tn: new Set(), tp: new Set() };
    const railXCross = {};   // 已被任一轨占用的 x（防同 x 跨轨电源线共线）
    // 就近选轨位（railTarget 与 A3 part↔part daisy 改写共用）：
    // 扫描 1..25 找离源 x 最近的空闲位置（一孔一接；跨轨同 x 冲突则跳过）。
    // 回避其他线的出线列(anchorCols ±4)，但不回避自己的出线列(ownCol 豁免——自己落自己列是理想落点)
    // T3.5（条件触发）：落轨竖段避元件足迹——轨位 x 的「下探竖段」(轨 y → 板底走廊)
    // 若穿过其他元件的引脚足迹矩形(本体宽与引脚最大 x 取大者, 外扩 8) → 跳过该轨位。
    // 元件不在下探 y 带(轨 y 以下)时不影响轨位选择 → 现行干净场景逐字节不变。
    const railDropBlock = (x, rail) => parts.some(q => {
      if (!q || q.left == null) return false;
      // 仅直放且位于面包板下缘以下的元件才会被「轨位下探竖段」穿过（插面板件
      // 骑在 bb 上, 其覆盖区不参与避让, 保持现行轨位选择逐字节不变）
      if ((q.placement || 'bb') === 'bb') return false;
      if (q.top <= bb.top + BB_H) return false;
      if (!((q.top + q.h) > railY[rail] - 2 && q.top < BELOW_BASE)) return false;
      let right = q.left + (q.w || 0);
      const pd = pins[q.type];
      if (pd) for (const k in pd) if (Array.isArray(pd[k]) && q.left + pd[k][0] > right) right = q.left + pd[k][0];
      return x >= q.left - 8 && x <= right + 8;
    });
    const pickRail = (rail, srcX, ownCol) => {
      const used = railUsed[rail];
      let best = 1, bestDist = Infinity;
      for (let n = 1; n <= RAIL_MAX; n++) {
        const x = railX(n);
        const d = Math.abs(x - srcX);
        const xKey = Math.round(x * 10);
        let nearOther = false;
        for (const c of anchorCols) {
          if (Math.abs(c - x) <= 4 && (ownCol == null || Math.abs(ownCol - c) > 4)) { nearOther = true; break; }
        }
        if (d < bestDist && !used.has(n) && !railXCross[xKey] && !nearOther && !railDropBlock(x, rail)) { bestDist = d; best = n; }
      }
      if (process.env.DBGRAIL) console.error('DBG rail', rail, 'srcX', srcX, '->', best);
      used.add(best);
      railXCross[Math.round(railX(best) * 10)] = true;
      return best;
    };
    const railTarget = (toRef, src, ownCol) => {
      const [rid, rpin] = toRef.split(':');
      if (rid !== board.id || !rpin) return null;
      const prefix = board.powerPins.find(p => rpin.startsWith(p));
      if (!prefix) return null;
      const isGND = prefix.startsWith('GND');
      // 3.3V / VIN 无专属电源轨 → 不映射到轨，直连板子对应脚（修复被错接 5V 轨）
      if (prefix.startsWith('3.3V') || prefix.startsWith('VIN')) return null;
      // GND 就近选负轨（bn 视觉顶部 / tn 视觉底部；两轨经跳线互通、都连板子 GND）：
      // 元件带（面包板顶部）用 bn，直连/芯片等靠近板子的用 tn，避免绕大圈
      const rail = isGND ? (Math.abs(src.y - railY.bn) <= Math.abs(railY.tn - src.y) ? 'bn' : 'tn') : 'tp';
      const n = pickRail(rail, src.x, ownCol);
      return { rail, n, ref: `bb1:${rail}.${n}` };
    };

    // ============================================================
    // A3 part↔part 电源 daisy 走轨发射器（A2 扩展）：
    // 模型写的 pA:VCC → pB:VCC / pA:GND → pB:GND 菊花链，bb 在场时改写为
    // 两条「元件 → 电源轨」接线（各自就近选轨位），复用主循环同款：
    // 配色(paletteColor) / 车道错开(finalTargetSeen) / routeWp 走板底走廊带 / pts 折线构建。
    // ============================================================
    const emitDaisyRail = (pid, pin, fam, modelCol) => {
      const src = pinPos(pid, pin);
      if (!src) return false;
      // GND 家族就近选负轨（与 railTarget 同款规则）；5V 家族走 tp
      const rail = fam === 'GND' ? (Math.abs(src.y - railY.bn) <= Math.abs(railY.tn - src.y) ? 'bn' : 'tn') : 'tp';
      const n = pickRail(rail, src.x, null);
      const fromRefD = `${pid}:${pin}`;
      const toRefD = `bb1:${rail}.${n}`;
      const posD = railPos(rail, n);
      const seen = finalTargetSeen[toRefD] || 0;
      finalTargetSeen[toRefD] = seen + 1;
      const colD = paletteColor(fromRefD, toRefD) || modelCol || (fam === 'GND' ? 'black' : 'red');
      const wps = routeWp(pid, pin, src, posD, seen * 10, 'bb1', `${rail}.${n}`);
      wireConns.push([fromRefD, toRefD, colD, wps]);
      wirePaths.push({ from: fromRefD, to: toRefD, pts: ptsOfWps(src, posD, wps) });
      return true;
    };

    // 共线错开：
    // ① 板子出线：同一边（上/下）每条线占一条水平车道（lane*8），避免多条板线共线重叠
    // ② 其他线：按「重映射后的最终目标」统计，同一目标孔的第二条起错开 10px
    //    （之前按逻辑网表目标 uno:GND.1 统计 → 全部 GND 线即使去了不同轨孔也被错开 → 无谓绕路）
    const edgeLane = { top: 0, bottom: 0 };
    const finalTargetSeen = {};
    // 预分配板脚车道：只对「实际用到的板脚」按 x 升序（左→右）分配连续车道，
    // 左脚线贴近板子、右脚线更高/更远，避免右脚本向左压过左脚出线造成交叉
    const boardPinLane = {};
    {
      const usedBySide = { top: [], bottom: [] };
      const addPin = (ref) => {
        const m = ref.match(board.digitPat);   // 仅数字信号脚占车道（电源脚走轨、不参与）
        if (!m) return;
        const pd = (pins[board.type] || {})[m[1]];
        if (!pd || !Array.isArray(pd)) return;
        const side = pd[1] < board.pinSideThreshold ? 'top' : 'bottom';
        if (!usedBySide[side].includes(m[1])) usedBySide[side].push(m[1]);
      };
      // 双向统计（板子做源、做目标都占车道），避免「元件→板脚」线因目标脚未登记而共线
      (intent.connections || []).forEach(c => { addPin(c.from); addPin(c.to); });
      (['top', 'bottom']).forEach(side => {
        usedBySide[side].sort((a, b) => pins[board.type][a][0] - pins[board.type][b][0]);
        usedBySide[side].forEach((k, i) => { boardPinLane[k] = i; laneMax[side] = i; });
      });
    }

    // ============================================================
    // 方向推导层（pin-semantics.json 数据驱动，不写死元件名）：
    //   swapPair 元件（如电阻 1/2 可互换）：信号接"靠近板子一侧"（t 区），
    //     生成连线时交换引脚映射（不改 intent 数据本身）。
    //   terminalPairs 元件（如按钮）：默认对侧接线；同侧时——
    //     无 hint.sameSide → 自动调为对侧（信号脚 l/r 互换，GND 不动）；
    //     有 hint.sameSide: true → 尊重显式省线选择。
    // ============================================================
    const semantics = loadPinSemantics().semantics || {};
    const pinSwap = {};   // 引脚重映射：{"r1:1" → "r1:2", "r1:2" → "r1:1"}
    const isPowerRef = (pin) => board.powerPins.some(p => pin === p || pin.startsWith(p + '.'));
    (intent.connections || []).forEach(c => {
      [c.from, c.to].forEach(ref => {
        const m = ref.match(/^([^:]+):(.+)$/);
        if (!m) return;
        const pid = m[1], pin = m[2];
        const p = partById[pid];
        if (!p) return;
        const sem = semantics[p.type];
        if (!sem || !sem.swapPair || !sem.swapPair.includes(pin)) return;
        // 信号线 = 连板子的那条线（排除电源脚：GND/5V 等不算信号）
        const other = ref === c.from ? c.to : c.from;
        const om = other.match(new RegExp('^' + board.id + ':(\\S+)$'));
        if (!om || isPowerRef(om[1])) return;
        // 该引脚在 b 区（视觉上方、远离板子）→ 信号应改接 t 区那端
        const hole = pinHole[ref];
        if (!hole || hole.half !== 'b') return;
        if (pinSwap[`${pid}:${pin}`] || pinSwap[`${pid}:${sem.swapPair.find(x => x !== pin)}`]) return;
        const otherPin = sem.swapPair.find(x => x !== pin);
        pinSwap[`${pid}:${pin}`] = `${pid}:${otherPin}`;
        pinSwap[`${pid}:${otherPin}`] = `${pid}:${pin}`;
        console.error(`[方向推导] ${pid} 信号改接 t 区`);
      });
    });
    // terminalPairs（按钮等）：默认对侧；同侧时——有 hint.sameSide 尊重（省线），
    // 无 hint 自动调整为对侧（信号脚 l/r 互换，GND 不动），并提示后果。
    const sideOf = {};   // pid → { signal: 'l'|'r', gnd: 'l'|'r', signalRef: 完整引用 }
    (intent.connections || []).forEach(c => {
      [c.from, c.to].forEach(ref => {
        const m = ref.match(/^([^:]+):(.+)$/);
        if (!m) return;
        const pid = m[1], pin = m[2];
        const p = partById[pid];
        if (!p) return;
        const sem = semantics[p.type];
        if (!sem || !sem.terminalPairs) return;
        const side = (pin.match(/\.([lr])$/) || [])[1];
        if (!side) return;
        const other = ref === c.from ? c.to : c.from;
        const om = other.match(new RegExp('^' + board.id + ':(\\S+)$'));
        if (!om) return;
        sideOf[pid] = sideOf[pid] || {};
        if (/^GND/.test(om[1])) sideOf[pid].gnd = side;
        else { sideOf[pid].signal = side; sideOf[pid].signalRef = ref; }
      });
    });
    Object.keys(sideOf).forEach(pid => {
      const s = sideOf[pid];
      const sem = semantics[(partById[pid] || {}).type] || {};
      if (sem.defaultSide !== 'opposite' || !s.signal || !s.gnd || s.signal !== s.gnd) return;
      const part = partById[pid];
      const keepSame = part && part.hint && part.hint.sameSide === true;
      if (keepSame) {
        console.error(`[方向提示] ${pid} 显式声明同侧（hint.sameSide），尊重省线选择`);
      } else {
        // 信号脚 l/r 互换 → 对侧（信号换到另一侧，GND 不动）
        const otherSide = s.signal === 'l' ? 'r' : 'l';
        const swappedRef = s.signalRef.replace(/\.([lr])$/, '.' + otherSide);
        pinSwap[s.signalRef] = swappedRef;
        console.error(`[方向推导] ${pid} 信号与 GND 同侧，已按默认对侧调整（${s.signalRef} → ${swappedRef}；若有意省线请加 hint.sameSide）`);
      }
    });

    // ============================================================
    // 电源线调色板（电压家族，按实际电气归宿取色）—— 见 PLAN-power-colors.md
    //   GND 黑灰系 / 5V 红系 / 3.3V 橙系 / VIN 棕系；每组 4 档由深到浅。
    //   仅长线消费者(placement !== 'bb')参与，按 intent.parts 声明顺序在其
    //   电压家族内领组号；同一元件的 VCC 与 GND 用同一组号（深浅配对）。
    //   模型 color:'red'/'black' 视为历史惯例不阻断调色板；其他颜色显式覆盖。
    // ============================================================
    const POWER_PALETTE = {
      GND: { shades: ['#212529', '#343A40', '#495057', '#6C757D'] },
      '5V': { shades: ['#CC1B1B', '#D33636', '#D95252', '#DE6D6D'] },
      '3.3V': { shades: ['#EE7F00', '#F08B1E', '#F2983A', '#F4A452'] },
      VIN: { shades: ['#A0522D', '#B46A42', '#C5835C', '#D49D78'] },
    };
    const powerFamOf = (ref) => {
      if (/^bb1:(bn|tn)\.\d+$/.test(ref)) return 'GND';
      if (/^bb1:(tp|bp)\.\d+$/.test(ref)) return '5V';
      const m = ref.match(new RegExp('^' + board.id + ':(GND(?:\\.\\d+)?|5V|3\\.3V|VIN)$'));
      if (!m) return null;
      return m[1].startsWith('GND') ? 'GND' : m[1];
    };
    const famNext = { GND: 0, '5V': 0, '3.3V': 0, VIN: 0 };
    const powerSlotOf = {};   // partId → 组号（0 起）
    parts.forEach(p => {      // parts 即 intent.parts 声明顺序
      if ((p.placement || 'bb') === 'bb') return;
      const fams = new Set();
      (intent.connections || []).forEach(c => {
        if (c.from.split(':')[0] !== p.id) return;
        const f = powerFamOf(c.to);
        if (f) fams.add(f);
      });
      const vccFam = ['5V', '3.3V', 'VIN'].find(f => fams.has(f));
      const fam = vccFam || (fams.has('GND') ? 'GND' : null);
      if (fam) powerSlotOf[p.id] = famNext[fam]++ % 4;
    });
    const paletteColor = (fromRef, toRef) => {
      const fam = powerFamOf(toRef);
      if (!fam) return null;
      const slot = powerSlotOf[fromRef.split(':')[0]];
      if (slot == null) return null;
      return POWER_PALETTE[fam].shades[slot];
    };

    (intent.connections || []).forEach(c => {
      const fromRef0 = pinSwap[c.from] || c.from;
      const toRef0 = pinSwap[c.to] || c.to;
      let fid = fromRef0.split(':')[0];
      const fpin = fromRef0.split(':')[1];
      let fromRef = fromRef0;
      let toRef = toRef0;
      let a = pinPos(fid, fpin);
      let b = pinPos(toRef0.split(':')[0], toRef0.split(':')[1]);
      if (!a || !b) {
        console.log(`  [走线跳过] ${c.from}→${c.to}：引脚坐标缺失`);
        return;
      }

      // A2 扩展（A3）：part↔part 电源菊花链，bb 在场时默认走轨分发。
      // 条件：两端都是非板/非 bb 元件，且两端引脚名都匹配电源家族
      //（任一端无家族——如 3.3V/VIN/VBAT/VBUS 或信号脚——保持直连不改写）。
      // 短线例外：pinPos 曼哈顿跨距 ≤ POWER_DIRECT_KEEP_PX → 保持直连（贴轨直连本就干净）。
      const fId0 = fromRef0.split(':')[0], tId0 = toRef0.split(':')[0];
      const noBb = (id) => id !== board.id && id !== 'bb1';
      if (noBb(fId0) && noBb(tId0)) {
        const fFam = daisyFamOf(fpin), tFam = daisyFamOf(toRef0.split(':')[1]);
        const spanD = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (fFam && tFam && spanD > POWER_DIRECT_KEEP_PX) {
          if (emitDaisyRail(fId0, fpin, fFam) && emitDaisyRail(tId0, toRef0.split(':')[1], tFam)) return;
          // 任一端造轨失败（引脚坐标缺失等）→ 回落原直连路径发射（不静默丢线）
        }
      }

      // ① 电源连线（目标 = GND/5V/3V3/VIN）→ 连电源轨（就近走轨，不穿板）
      // 就近基准: $bb 元件实际从「锚点孔列」出线, 按锚点孔位置就近选轨位
      // (避免按引脚位置选位导致落点贴着相邻孔出线, 如 dht VCC 落 tp.5 与 SDA 出线 0.4 单位近触)
      const fHolePre = pinHole[fromRef0];
      const railSrc = fHolePre ? holePos(fHolePre) : a;
      const ownCol = fHolePre ? railSrc.x : null;
      const rt = railTarget(toRef0, railSrc, ownCol);
      if (rt) {
        toRef = rt.ref;
        b = railPos(rt.rail, rt.n);   // 先算轨位置，供下方判断出线方向
        // 源若是插面板引脚（$bb）→ 从「同行空闲孔」出线再接轨，而非从引脚直接出线
        // （面包板接线惯例：引脚插孔、相邻孔出线 —— 与 dragramtest 模板一致）
        const fHole = pinHole[fromRef0];
        if (fHole) {
          const h = freeHole(fHole.row, fHole.half, fHole.letter, b.y < a.y ? 1 : -1);
          if (h) { fid = 'bb1'; fromRef = `bb1:${h.row}${h.half}.${h.letter}`; a = holePos(h); }
        }
      } else {
        // ② 端点若是插面板元件引脚 → 连到同行空闲孔（面包板内部连通）
        //    freeHole 朝「线的来向」选外侧孔，让线露在元件外侧（不被元件盖住）
        const fHole = pinHole[fromRef0];
        if (fHole) {
          const h = freeHole(fHole.row, fHole.half, fHole.letter, b.y < a.y ? 1 : -1);
          if (h) { fid = 'bb1'; fromRef = `bb1:${h.row}${h.half}.${h.letter}`; a = holePos(h); }
        }
        const tHole = pinHole[toRef0];
        if (tHole) {
          const h = freeHole(tHole.row, tHole.half, tHole.letter, a.y < b.y ? 1 : -1);
          if (h) { toRef = `bb1:${h.row}${h.half}.${h.letter}`; b = holePos(h); }
        }
      }

      let stagger = 0;
      if (fid === board.id) {
        // 板线：按脚位 x 占独立水平车道，避免多线共线/右脚本向左压左脚出线
        const pinInfo = (pins[board.type] || {})[fpin];
        const side = pinInfo && pinInfo[1] < board.pinSideThreshold ? 'top' : 'bottom';
        const lane = (boardPinLane[fpin] != null) ? boardPinLane[fpin] : edgeLane[side]++;
        stagger = side === 'top' ? -lane * 8 : lane * 8;
      } else {
        // 元件→板脚：按目标板脚的车道错开（同侧每脚一条独立水平车道，消除多线共线重叠）
        const tId = toRef.split(':')[0], tPin = toRef.split(':')[1];
        const tpd = tId === board.id ? (pins[board.type] || {})[tPin] : null;
        if (tpd && Array.isArray(tpd) && board.digitPat.test(toRef)) {
          const side = tpd[1] < board.pinSideThreshold ? 'top' : 'bottom';
          const lane = (boardPinLane[tPin] != null) ? boardPinLane[tPin] : edgeLane[side]++;
          stagger = side === 'top' ? -lane * 8 : lane * 8;
        } else {
          const seen = finalTargetSeen[toRef] || 0;
          finalTargetSeen[toRef] = seen + 1;
          stagger = seen * 10;
        }
      }
      const modelCol = c.color;
      const col = (modelCol && modelCol !== 'red' && modelCol !== 'black')
        ? modelCol
        : (paletteColor(fromRef, toRef) || modelCol || 'green');
      const wps = routeWp(fid, fpin, a, b, stagger, toRef.split(':')[0], toRef.split(':')[1]);
      wireConns.push([fromRef, toRef, col, wps]);
      {
        const pts = ptsOfWps(a, b, wps);
        wirePaths.push({ from: fromRef, to: toRef, pts });
        // A4 长线告警：part↔part 电源线（两端都非板/非 bb1 → daisy）按折线段长求和，
        // 超 POWER_DAISY_WARN_PX → POWER_DAISY_LONG。板腿线（目标=板脚）与轨馈线
        // （目标=bb1 轨）天然不进此分支，自动豁免（N12 口径：只罚菊花链单线）。
        const fIdE = fromRef.split(':')[0], tIdE = toRef.split(':')[0];
        if (fIdE !== board.id && fIdE !== 'bb1' && tIdE !== board.id && tIdE !== 'bb1' &&
            (daisyFamOf(fromRef.split(':')[1]) || daisyFamOf(toRef.split(':')[1]))) {
          let spanP = 0;
          for (let i = 0; i + 1 < pts.length; i++) {
            spanP += Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
          }
          spanP = Math.round(spanP * 10) / 10;
          if (spanP > POWER_DAISY_WARN_PX) {
            console.log(`[WARN] 电源菊花链超长:${fromRef}→${toRef} 跨度 ${spanP}px > ${POWER_DAISY_WARN_PX}px。元件↔元件电源直连长线绕远。走面包板轨分发或缩短元件间距。`);
          }
        }
      }
    });

    // 电源轨主线（板底走廊带上两条槽位）：板子 GND/5V → 主线接 tn/tp。
    // GND 需跳线 tn→bn（主线落 tn、元件用 bn，bn 有消费者才需要跳线）；
    // 5V 主线直接落 tp（= 元件取电轨，bp 无消费者不需要跳线）。
    // 仅一条轨时主线走最左轨位 25；两条轨同时用时 GND 主线仍 tn.25、
    // 5V 主线改 tp.23(x=43.4)，两主线不同 x + 不同深度（527/537）互不共线。
    // 主线存在性按「轨是否有消费者」判断：tn 的消费者（芯片 GND）也计入，
    // 否则芯片 GND 落到 tn 却无主线接入板子 GND（电气断链）。
    const rw = v => Math.round(v * 10) / 10;
    const bothRails = (railUsed['bn'].size > 0 || railUsed['tn'].size > 0) && railUsed['tp'].size > 0;
    if (railUsed['bn'].size > 0 || railUsed['tn'].size > 0) {
      const a = pinPos(board.id, board.railGnd), b = railPos('tn', RAIL_MAX);
      const cy = BELOW_BASE + BELOW_STEP;
      const wps = [`v${rw(cy - a.y)}`, `h${rw(b.x - a.x)}`, `v${rw(b.y - cy)}`];
      wireConns.push([`${board.id}:${board.railGnd}`, `bb1:tn.${RAIL_MAX}`, 'black', wps]);
      {
        const pts = [[a.x, a.y]];
        let cx = a.x, cyy = a.y;
        for (const m of wps) {
          const mm = /^([hv])(-?[\d.]+)$/.exec(m);
          if (!mm) continue;
          const d = parseFloat(mm[2]);
          if (mm[1] === 'h') cx += d; else cyy += d;
          pts.push([cx, cyy]);
        }
        pts.push([b.x, b.y]);
        wirePaths.push({ from: `${board.id}:${board.railGnd}`, to: `bb1:tn.${RAIL_MAX}`, pts });
      }
      if (railUsed['bn'].size > 0) {
        const A = railPos('tn', RAIL_MAX - 1), B = railPos('bn', RAIL_MAX - 1);
        wireConns.push([`bb1:tn.${RAIL_MAX - 1}`, `bb1:bn.${RAIL_MAX - 1}`, 'black',
          [`v${rw(B.y - A.y)}`]]);
        wirePaths.push({ from: `bb1:tn.${RAIL_MAX - 1}`, to: `bb1:bn.${RAIL_MAX - 1}`, pts: [[A.x, A.y], [B.x, B.y]] });
      }
    }
    if (railUsed['tp'].size > 0) {
      const n = bothRails ? RAIL_MAX - 2 : RAIL_MAX;
      const a = pinPos(board.id, board.railVcc), b = railPos('tp', n);
      const cy = BELOW_BASE;
      const wps = [`v${rw(cy - a.y)}`, `h${rw(b.x - a.x)}`, `v${rw(b.y - cy)}`];
      wireConns.push([`${board.id}:${board.railVcc}`, `bb1:tp.${n}`, 'red', wps]);
      {
        const pts = [[a.x, a.y]];
        let cx = a.x, cyy = a.y;
        for (const m of wps) {
          const mm = /^([hv])(-?[\d.]+)$/.exec(m);
          if (!mm) continue;
          const d = parseFloat(mm[2]);
          if (mm[1] === 'h') cx += d; else cyy += d;
          pts.push([cx, cyy]);
        }
        pts.push([b.x, b.y]);
        wirePaths.push({ from: `${board.id}:${board.railVcc}`, to: `bb1:tp.${n}`, pts });
      }
    }

    const ovCount = detectOverlaps(wirePaths);
    if (ovCount > 0) console.error(`[重叠] 共 ${ovCount} 处, 见上`);

    // 输出
    const outParts = [
      { type: bb.type, id: 'bb1', top: bb.top, left: bb.left, rotate: bb.rotate, attrs: {} },
      { type: board.type, id: board.id, top: board.top, left: board.left, attrs: {} },
      ...parts.map(p => { const o = { type: p.type, id: p.id, top: p.top, left: p.left, attrs: p.attrs || {} }; if (p.rotate) o.rotate = p.rotate; return o; })
    ];
    // 紧凑输出：parts 单行、connections 单行
    const allConns = bbConns.concat(wireConns);
    const lines = ['{', '  "version": 1,', '  "author": "layout-generator",', '  "editor": "wokwi",', '  "parts": ['];
    outParts.forEach((p, i) => lines.push('    ' + JSON.stringify(p) + (i < outParts.length - 1 ? ',' : '')));
    lines.push('  ],', '  "connections": [');
    allConns.forEach((c, i) => lines.push('    ' + JSON.stringify(c) + (i < allConns.length - 1 ? ',' : '')));
    lines.push('  ]', '}');
    fs.writeFileSync(path.join(OUT_DIR, 'diagram.json'), lines.join('\n'));
    // ============================================================
    // A5 面包板最低使用检查（bb 模式，[OK] 前）：
    //   ① bb 空置：allConns(bbConns+wireConns) 中任一端是轨孔（bn/bp/tn/tp.N）的
    //      条数 < 2 → BB_VACANT（面包板在场却几乎不走轨，白占布局位）
    //   ② 离散元件未插接且无 reason → DISCRETE_NO_REASON（placement !== 'bb' 即直连）
    // A6 未知类型：sizes 未收录 → UNKNOWN_TYPES（去重列 type 名，消除盲区信号效应）
    // ============================================================
    const RAIL_PIN_PAT = /^bb1:(bn|bp|tn|tp)\.\d+$/;
    const railConnCount = allConns.filter(cv => RAIL_PIN_PAT.test(cv[0]) || RAIL_PIN_PAT.test(cv[1])).length;
    if (railConnCount < 2) {
      console.log(`[WARN] 面包板空置:轨连接 ${railConnCount} < 2。面包板在场却几乎不走轨,白占布局位。走轨分发电源,或撤板改直连并写明 reason。`);
    }
    const bbDiscreteNoReason = parts.filter(p =>
      DISCRETE_TYPES.includes(p.type) && (p.placement || 'bb') !== 'bb' && !p.reason).map(p => p.id);
    if (bbDiscreteNoReason.length) {
      console.log(`[WARN] 离散元件未插接且无 reason:${bbDiscreteNoReason.join(',')}。电阻/LED/按钮直连悬空线多且无锚固。写 placement:"bb" 插面包板,或加 reason:"一句话" 说明直连理由。`);
    }
    if (unknownTypes.size) {
      console.log(`[INFO] 未知元件类型(回退默认尺寸/直连):${[...unknownTypes].join('、')}。尺寸表未收录。补录 references/common/sizes.json 或显式声明尺寸。`);
    }
    console.log(`[OK] 面包板布局：${bbParts.length} 插面板 + ${boardParts.length} 直连 + ${bbConns.length} 条 $bb + ${wireConns.length} 条可见线`);
    console.log('[INFO] 输出:', path.join(OUT_DIR, 'diagram.json'));
    return;
  }

  // 第 1 层：区域分配（硬）— 每个 region 独立排布，组间自动错开
  // ============================================================
  const regions = {
    top:    { baseX: board.left, baseY: board.top - 160 - EXPAND.top, dirX: 1, rowMax: 4, rowGap: 45 },
    bottom: { baseX: board.left, baseY: board.top + board.h + 80 + EXPAND.bottom, dirX: 1, rowMax: 4, rowGap: 45 },
    left:   { baseX: board.left - 160 - EXPAND.left, baseY: board.top, dirX: 1, rowMax: 3, rowGap: 40 },
    right:  { baseX: board.left + board.w + 150 + EXPAND.right, baseY: board.top + board.h / 2, dirX: 1, rowMax: 3, rowGap: 40 },
  };

  // 每个 region 的"下一个组起始位置"（组间错开）
  const regionCursor = {};
  Object.keys(regions).forEach(k => regionCursor[k] = { x: regions[k].baseX, y: regions[k].baseY });

  // 组内排布：纵向优先（每列 columnMax 个，列横向分开）— 让线从板子出发有纵向空间

  groups.forEach(g => {
    const regName = directRegion(g);
    const reg = regions[regName];
    const cur = regionCursor[regName];
    const columnMax = (regName === 'top' || regName === 'bottom') ? 2 : 1;
    let colX = cur.x;
    let colY = cur.y;
    let colCount = 0;
    let colMaxW = 0;
    let totalH = 0;

    g.parts.forEach((id, idx) => {
      const p = partById[id];
      if (!p) return;
      // 元件间距：交互元件（按钮/蜂鸣器）间距更大（引脚不挤）
      // 间距：按钮/蜂鸣器 50；LED/电阻配对 50（走线空间）；其他 30
      let spacing = MIN_SPACING;
      if (p.type.includes('pushbutton') || p.type.includes('buzzer')) spacing = 50;
      if (p.type === 'wokwi-led' || p.type === 'wokwi-rgb-led') spacing = 50;
      if (idx > 0 && colCount >= columnMax) {
        colX += colMaxW + spacing;  // 换列
        colY = cur.y;
        colCount = 0;
        colMaxW = 0;
      }
      p.left = Math.round(colX);
      p.top = Math.round(colY);
      // 电阻自动垂直放置（rotate 90）：与 LED 纵向配对更清晰；旋转后宽高互换
      if (p.type.includes('resistor')) {
        p.rotate = 90;
        [p.w, p.h] = [p.h, p.w];
      }
      colY += p.h + spacing;       // 纵向推进
      colMaxW = Math.max(colMaxW, p.w);
      colCount++;
      totalH = Math.max(totalH, p.top + p.h - cur.y);
    });

    // 更新 region 光标：
    // top/bottom → 横向错开（纵向会挤入板子）
    // left/right → 纵向递增（横向会与散件重叠）
    const groupW = colX - cur.x + colMaxW;
    if (regName === 'top' || regName === 'bottom') {
      regionCursor[regName] = { x: cur.x + groupW + GROUP_SPACING, y: cur.y };
    } else {
      regionCursor[regName] = { x: cur.x, y: cur.y + totalH + GROUP_SPACING };
    }
  });

  // 未分组元件 → right 区域下方
  parts.forEach(p => {
    if (!groupOf[p.id]) {
      p.left = regions.right.baseX;
      p.top = regionCursor.right.y;
      regionCursor.right.y += p.h + GROUP_SPACING;
    }
  });

  // ============================================================
  // 第 3 层：near/avoid（软）— 仅同区域时微调，跨区域放弃
  // ============================================================
  const constraints = intent.constraints || [];
  constraints.forEach(c => {
    const a = partById[c.a], b = partById[c.b];
    if (!a || !b) return;
    const ra = regionOf[c.a], rb = regionOf[c.b];
    if (ra !== rb) {
      console.log(`  [soft-跳过] ${c.a}(${ra}) ${c.type} ${c.b}(${rb})：跨区域，放弃（区域约束优先）`);
      return;
    }
    if (c.type === 'near') {
      a.left = b.left + (b.w || 20) + 20;
      a.top = b.top;
      console.log(`  [soft] ${c.a} 靠近 ${c.b}（同区域 ${ra}）`);
    } else if (c.type === 'avoid') {
      a.left = b.left - (a.w || 20) - 60;
      console.log(`  [soft] ${c.a} 远离 ${c.b}（同区域 ${ra}）`);
    }
  });

  // ============================================================
  // 第 4 层：硬底线（不遮挡板子、不重叠）— 迭代修复
  // ============================================================
  function overlaps(a, b) {
    return !(a.left > b.left + b.w + 5 || a.left + a.w + 5 < b.left ||
             a.top > b.top + b.h + 5 || a.top + a.h + 5 < b.top);
  }
  const boardRect = { left: board.left, top: board.top, w: board.w, h: board.h };
  const issues = [];
  const fixed = new Set();

  // 修复遮挡板子（区域感知：移到所属区域的最近安全位置）
  parts.forEach(p => {
    if (overlaps(p, boardRect)) {
      const reg = regions[regionOf[p.id]] || regions.bottom;
      issues.push(`${p.id} 遮挡板子 → 回移区域 ${regionOf[p.id]}`);
      if (regionOf[p.id] === 'top' || regionOf[p.id] === 'left') {
        // 区域上方安全位置：确保元件完全在板子上方（底 < 板子顶）
        const safeTop = board.top - p.h - 20;
        p.top = safeTop;
      } else {
        p.top = board.top + board.h + 60;
      }
      p.left = reg.baseX;
      fixed.add(p.id);
    }
  });

  // 修复元件互叠（迭代，最多 10 轮）
  for (let iter = 0; iter < 10; iter++) {
    let anyFix = false;
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        if (overlaps(parts[i], parts[j])) {
          issues.push(`${parts[i].id} ↔ ${parts[j].id} 重叠`);
          // 向右/向下错开（保持间距）
          if (!fixed.has(parts[j].id) || parts[i].left < parts[j].left) {
            parts[j].left = parts[i].left + parts[i].w + MIN_SPACING;
            anyFix = true;
          } else {
            parts[j].top = parts[i].top + parts[i].h + MIN_SPACING;
            anyFix = true;
          }
        }
      }
    }
    if (!anyFix) break;
  }

  // ============================================================
  // 走线生成（直连）：板脚 → 元件脚直接连线（无面包板孔/轨）
  // 复用 routeWp + pinPos + 共线错开（edgeLane / finalTargetSeen）
  // ============================================================
  const wireConns = [];
  wirePaths = [];   // 重置折线采集（main 级数组，routeWp 智能直连判定共用）
  scanDupPinCols();   // T3.5 Fix A 前置：共列引脚登记（放置完成后才有 pinPos）
  for (const k in escRowCount) delete escRowCount[k];
  const edgeLane = { top: 0, bottom: 0 };
  const targetLane = { top: 0, bottom: 0 };
  const finalTargetSeen = {};
  (intent.connections || []).forEach(c => {
    const fid = c.from.split(':')[0];
    const fpin = c.from.split(':')[1];
    let toRef = c.to;
    let a = pinPos(fid, fpin);
    let b = pinPos(toRef.split(':')[0], toRef.split(':')[1]);
    if (!a || !b) {
      console.log(`  [走线跳过] ${c.from}→${c.to}：引脚坐标缺失`);
      return;
    }
    // ② GND 智能选边：目标 = 板子 GND 时，按源元件在板上/下方就近选 GND.1（顶部数字侧）/ GND.2（底部电源侧）
    if (board.gndPat.test(c.to) && fid !== board.id) {
      const boardMid = board.top + board.h / 2;
      toRef = (a.y < boardMid) ? `${board.id}:${board.gndTop}` : `${board.id}:${board.gndBottom}`;
      b = pinPos(board.id, toRef.split(':')[1]);
    }
    const toId = toRef.split(':')[0];
    const toPin = toRef.split(':')[1];
    let stagger = 0;
    if (fid === board.id) {
      // 板源：同一边每条线占一条水平车道
      const side = boardPinSide(fid, fpin);
      const lane = edgeLane[side]++;
      stagger = side === 'top' ? -lane * 8 : lane * 8;
    } else if (toId === board.id) {
      // 元件源 → 板脚：贴近板子，小错开（8px）
      const side = boardPinSide(toId, toPin);
      const lane = targetLane[side]++;
      stagger = side === 'top' ? -lane * 8 : lane * 8;
    } else {
      // 元件→元件：同一目标引脚的第二条起错开 10px
      const seen = finalTargetSeen[toRef] || 0;
      finalTargetSeen[toRef] = seen + 1;
      stagger = seen * 10;
    }
    const wps = routeWp(fid, fpin, a, b, stagger, toId, toPin);
    wireConns.push([c.from, toRef, c.color || 'green', wps]);
    {
      const pts = ptsOfWps(a, b, wps);
      wirePaths.push({ from: c.from, to: toRef, pts });
      // A4 长线告警（直连模式）：part↔part 电源线（两端都非板 → daisy）跨度求和
      // 超 POWER_DAISY_WARN_PX → POWER_DAISY_LONG（无 bb 时 daisy 是唯一电源
      // 分布形态，正是 N12 治理对象）。板腿线（目标=板脚 GND/其他）在下方改写/
      // 检测排除，自动豁免。
      const tIdE = toRef.split(':')[0];
      if (fid !== board.id && tIdE !== board.id &&
          (daisyFamOf(c.from.split(':')[1]) || daisyFamOf(toRef.split(':')[1]))) {
        let spanP = 0;
        for (let i = 0; i + 1 < pts.length; i++) {
          spanP += Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
        }
        spanP = Math.round(spanP * 10) / 10;
        if (spanP > POWER_DAISY_WARN_PX) {
          console.log(`[WARN] 电源菊花链超长:${c.from}→${toRef} 跨度 ${spanP}px > ${POWER_DAISY_WARN_PX}px。元件↔元件电源直连长线绕远。走面包板轨分发或缩短元件间距。`);
        }
      }
    }
  });
  const ovCount = detectOverlaps(wirePaths);
  if (ovCount > 0) console.error(`[重叠] 共 ${ovCount} 处, 见上`);

  // ============================================================
  // 输出：diagram.json parts + connections
  // ============================================================
  const outputParts = parts.map(p => {
    const out = { type: p.type, id: p.id, top: p.top, left: p.left, attrs: p.attrs || {} };
    if (p.rotate) out.rotate = p.rotate;
    return out;
  });
  outputParts.unshift({ type: board.type, id: board.id, top: board.top, left: board.left, attrs: {} });

  // 紧凑输出：parts 单行、connections 单行（与面包板分支一致，不刷太多换行）
  const lines = ['{', '  "version": 1,', '  "author": "layout-generator",', '  "editor": "wokwi",', '  "parts": ['];
  outputParts.forEach((p, i) => lines.push('    ' + JSON.stringify(p) + (i < outputParts.length - 1 ? ',' : '')));
  lines.push('  ],', '  "connections": [');
  wireConns.forEach((c, i) => lines.push('    ' + JSON.stringify(c) + (i < wireConns.length - 1 ? ',' : '')));
  lines.push('  ]', '}');
  fs.writeFileSync(path.join(OUT_DIR, 'diagram.json'), lines.join('\n'));
  // ============================================================
  // A5 离散元件检查（直连模式，[OK] 前）：直连模式一律视为未插接，
  //   DISCRETE_TYPES 且无 reason → DISCRETE_NO_REASON（逼模型过脑子，不禁止判断）
  // A6 未知类型：sizes 未收录 → UNKNOWN_TYPES（去重列 type 名）
  // ============================================================
  const dDiscreteNoReason = parts.filter(p =>
    DISCRETE_TYPES.includes(p.type) && !p.reason).map(p => p.id);
  if (dDiscreteNoReason.length) {
    console.log(`[WARN] 离散元件未插接且无 reason:${dDiscreteNoReason.join(',')}。电阻/LED/按钮直连悬空线多且无锚固。写 placement:"bb" 插面包板,或加 reason:"一句话" 说明直连理由。`);
  }
  if (unknownTypes.size) {
    console.log(`[INFO] 未知元件类型(回退默认尺寸/直连):${[...unknownTypes].join('、')}。尺寸表未收录。补录 references/common/sizes.json 或显式声明尺寸。`);
  }
  console.log(`[OK] 直连布局：${parts.length} 元件 + ${wireConns.length} 条可见线`);
  if (issues.length) {
    console.log(`[WARN] 硬约束修复 ${issues.length} 处:`);
    [...new Set(issues)].forEach(i => console.log(`  - ${i}`));
  }
  console.log(`[INFO] 输出: ${path.join(OUT_DIR, 'diagram.json')}`);
}

main();
