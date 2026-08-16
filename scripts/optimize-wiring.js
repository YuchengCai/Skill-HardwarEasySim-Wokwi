#!/usr/bin/env node
/**
 * optimize-wiring.js — Wokwi 布线优化脚本 (v0.5)
 *
 * 功能：检测 diagram.json 的布线冲突（线穿元件/板子、线交叉），
 *       并按通道规则动态修正控制点，输出优化后的 diagram.json。
 *
 * 用法：
 *   node optimize-wiring.js <project-dir> [--dry-run]
 *   --dry-run: 只检测报告，不写入
 *
 * 原理：
 *   几何检测（确定性）+ 通道决策（动态计算绕行路径）
 *   不固化固定参数 —— 绕行距离由元件位置/尺寸动态计算
 *
 * 依赖：
 *   references/common/sizes.json（元件尺寸表）
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// 常量与配置
// ============================================================
const SAFE_MARGIN = 3;        // 安全边距：检测时元件矩形外扩（吸收尺寸误差）
const MIN_SPACING = 10;       // 线与元件的最小距离
const OVERLAP_THRESHOLD = 5;  // 平行线重叠判定阈值

// 引脚坐标（pins.json，wokwi-elements 源码提取的权威数据，含 _rot90 校准偏移）
let PINS = {};
function loadPins() {
  const p = path.join(__dirname, '..', 'references', 'common', 'pins.json');
  if (fs.existsSync(p)) {
    PINS = JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
}

// ============================================================
// 工具函数：几何计算
// ============================================================

/** 矩形：{x, y, w, h} */
function makeRect(px, py, w, h, margin = 0) {
  return { x: px - margin, y: py - margin, w: w + margin * 2, h: h + margin * 2 };
}

/** 线段是否与矩形相交（含触碰） */
function lineHitsRect(x1, y1, x2, y2, rect) {
  // 快速排除：线段包围盒与矩形无交集
  if (Math.max(x1, x2) < rect.x || Math.min(x1, x2) > rect.x + rect.w ||
      Math.max(y1, y2) < rect.y || Math.min(y1, y2) > rect.y + rect.h) {
    return false;
  }
  // 线段任一端点在矩形内
  if (pointInRect(x1, y1, rect) || pointInRect(x2, y2, rect)) return true;
  // 线段与矩形四条边求交
  const edges = [
    [rect.x, rect.y, rect.x + rect.w, rect.y],
    [rect.x, rect.y, rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h, rect.x + rect.w, rect.y + rect.h],
  ];
  for (const [ex1, ey1, ex2, ey2] of edges) {
    if (segmentsIntersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2)) return true;
  }
  return false;
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** 两线段是否相交（含端点） */
function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  function orient(ax, ay, bx, by, cx, cy) {
    const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    return v > 1e-9 ? 1 : (v < -1e-9 ? -1 : 0);
  }
  function onSeg(ax, ay, bx, by, cx, cy) {
    return Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) &&
           Math.min(ay, by) <= cy && cy <= Math.max(ay, by);
  }
  const o1 = orient(x1, y1, x2, y2, x3, y3);
  const o2 = orient(x1, y1, x2, y2, x4, y4);
  const o3 = orient(x3, y3, x4, y4, x1, y1);
  const o4 = orient(x3, y3, x4, y4, x2, y2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSeg(x1, y1, x2, y2, x3, y3)) return true;
  if (o2 === 0 && onSeg(x1, y1, x2, y2, x4, y4)) return true;
  if (o3 === 0 && onSeg(x3, y3, x4, y4, x1, y1)) return true;
  if (o4 === 0 && onSeg(x3, y3, x4, y4, x2, y2)) return true;
  return false;
}

/** 两矩形是否相交（重叠） */
function rectsOverlap(a, b) {
  return !(a.x > b.x + b.w || a.x + a.w < b.x || a.y > b.y + b.h || a.y + a.h < b.y);
}

/** 点到线段距离 */
function distPointToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 两线段最小距离（相交 = 0） */
function segsMinDist(a1, a2, b1, b2) {
  if (segmentsIntersect(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y, b2.x, b2.y)) return 0;
  return Math.min(
    distPointToSeg(b1.x, b1.y, a1.x, a1.y, a2.x, a2.y),
    distPointToSeg(b2.x, b2.y, a1.x, a1.y, a2.x, a2.y),
    distPointToSeg(a1.x, a1.y, b1.x, b1.y, b2.x, b2.y),
    distPointToSeg(a2.x, a2.y, b1.x, b1.y, b2.x, b2.y)
  );
}

/** 计算元件引脚位置（按类型 + 引脚名，比元件中心准确） */
function pinPosition(part, pinName) {
  const x = part.left || 0;
  const y = part.top || 0;
  const w = part.w || 20;
  const h = part.h || 20;
  const type = part.type || '';
  const pin = String(pinName || '');

  // 面包板孔位（实测校准自 dragramtest：数字=水平间距9.6, 字母=垂直间距9.6, 半区b偏移19.2）
  if (type.includes('breadboard')) {
    const BOARD_W = 313.6; // half 面板宽（实测校准，与 layout-generator.js 一致）
    const BOARD_H = 166;   // half 面板高（实测校准）
    const rotated = (part.rotate || 0) === 180;
    let ox = 0, oy = 0;
    // 元件区孔位: <数字><半区>.<字母> 如 30b.h
    const holeMatch = pin.match(/^(\d+)([tb])\.([a-j])$/);
    if (holeMatch) {
      const num = parseInt(holeMatch[1]);
      const half = holeMatch[2];
      const letterIdx = holeMatch[3].charCodeAt(0) - 97;
      ox = 10.6 + (num - 1) * 9.6;
      oy = 9 + letterIdx * 9.6 + (half === 'b' ? 19.2 : 0);
    } else {
      // 电源轨: <t/b><p/n>.<位置号> 如 bn.25, tp.9（近似，待实测校准）
      const railMatch = pin.match(/^([tb])([pn])\.(\d+)$/);
      if (railMatch) {
        const half = railMatch[1];
        const polarity = railMatch[2];
        const pos = parseInt(railMatch[3]);
        ox = 10.6 + (pos - 1) * 9.6;
        if (half === 't') oy = (polarity === 'p' ? 4 : 10);
        else oy = BOARD_H - (polarity === 'p' ? 10 : 4);
      } else {
        return { x: x + w / 2, y: y + h / 2 };
      }
    }
    // rotate 180：绕面板中心翻转，孔位 = 面板左上 + 尺寸 - 偏移
    if (rotated) {
      return { x: x + BOARD_W - ox, y: y + BOARD_H - oy };
    }
    return { x: x + ox, y: y + oy };
  }

  // 权威引脚坐标：优先查 pins.json（wokwi-elements 源码提取），
  // rotate 90/270 时用 _rot90 校准偏移（电阻/按钮在面包板上会旋转）
  const pinsData = PINS[type];
  if (pinsData) {
    let offset;
    if ((part.rotate === 90 || part.rotate === 270) && pinsData._rot90 && pinsData._rot90[pin]) {
      offset = pinsData._rot90[pin];
    } else {
      offset = pinsData[pin];
    }
    if (offset) {
      return { x: x + offset[0], y: y + offset[1] };
    }
  }

  // 回退：元件中心
  return { x: x + w / 2, y: y + h / 2 };
}

/** 解析连接路径（waypoints → 折线段集合） */
function connectionPath(conn, parts) {
  // conn: [from, to, color, waypoints?]
  const [from, to] = conn;
  const [fromPart, fromPin] = from.split(':');
  const [toPart, toPin] = to.split(':');
  const wp = conn.length > 3 ? conn[3] : [];

  // 找元件位置（近似：用元件中心作为引脚位置）
  const fp = parts.find(p => p.id === fromPart);
  const tp = parts.find(p => p.id === toPart);
  if (!fp || !tp) return null;

  // 引脚位置（按元件类型 + 引脚名计算，替代元件中心）
  const f = pinPosition(fp, fromPin);
  const t = pinPosition(tp, toPin);

  // 构建折线点集
  const points = [{ x: f.x, y: f.y }];
  let current = { x: f.x, y: f.y };

  const applyInstr = (instr, sign = 1) => {
    const type = instr[0];
    const val = parseFloat(instr.slice(1)) * sign;
    if (type === 'v') current = { ...current, y: current.y + val };
    else if (type === 'h') current = { ...current, x: current.x + val };
  };

  // * 前：从源执行；* 后：从目标反向执行
  const starIdx = wp.indexOf('*');
  const pre = starIdx >= 0 ? wp.slice(0, starIdx) : wp;
  const post = starIdx >= 0 ? wp.slice(starIdx + 1) : [];

  for (const instr of pre) applyInstr(instr, 1);
  points.push({ ...current });

  // 目标端反向：从目标点出发，反向应用 post 指令
  const tPoints = [{ x: t.x, y: t.y }];
  let tCurrent = { x: t.x, y: t.y };
  for (let i = post.length - 1; i >= 0; i--) {
    applyInstr(post[i], -1);
    tPoints.push({ ...current });
  }
  // 合并：源端路径 + 目标端路径
  const allPoints = [...points, ...tPoints.reverse()];
  return allPoints;
}

/** 折线 → 线段数组 */
function polylineToSegments(points) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push([points[i], points[i + 1]]);
  }
  return segs;
}

// ============================================================
// 检测
// ============================================================

function detectConflicts(diagram, partRects) {
  const conflicts = [];
  const conns = diagram.connections || [];
  const parts = diagram.parts || [];

  const isBoardType = (type) => type.includes('arduino') || type.includes('esp32');
  const boardParts = parts.filter(p => isBoardType(p.type));

  // ① 元件 vs 板子遮挡（arduino/esp32 板；面包板：仅插其上的元件豁免）
  const realBoards = parts.filter(p => p.type.includes('arduino') || p.type.includes('esp32'));
  const breadboards = parts.filter(p => p.type.includes('breadboard'));
  const pluggedParts = new Set(); // 插在面包板上的元件（有 $bb 连接）
  for (const c of (diagram.connections || [])) {
    const wp = c.length > 3 ? c[3] : [];
    if (wp.includes('$bb')) pluggedParts.add(c[0].split(':')[0]);
  }
  for (const p of parts) {
    if (isBoardType(p.type)) continue;
    if (p.type.includes('breadboard')) continue;
    const pr = partRects.get(p.id);
    // 面包板：插其上的元件豁免，遮挡面板的元件要检
    for (const bb of breadboards) {
      const br = partRects.get(bb.id);
      if (pr && br && rectsOverlap(pr, br) && !pluggedParts.has(p.id)) {
        conflicts.push({ type: 'part-on-breadboard', part: p.id, connStr: p.type });
      }
    }
    for (const bp of realBoards) {
      const br = partRects.get(bp.id);
      if (pr && br && rectsOverlap(pr, br)) {
        conflicts.push({ type: 'part-on-board', part: p.id, connStr: p.type });
        break;
      }
    }
  }

  // ② 元件 vs 元件重叠（排除面包板参与：面板是载体）
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j];
      if (isBoardType(a.type) && isBoardType(b.type)) continue;
      if (a.type.includes('breadboard') || b.type.includes('breadboard')) continue;
      const ar = partRects.get(a.id), br = partRects.get(b.id);
      if (ar && br && rectsOverlap(ar, br)) {
        conflicts.push({ type: 'parts-overlap', a: a.id, b: b.id, connStr: `${a.id} ↔ ${b.id}` });
      }
    }
  }

  for (let i = 0; i < conns.length; i++) {
    const conn = conns[i];
    const wp = conn.length > 3 ? conn[3] : [];
    if (wp.includes('$bb')) continue;

    const points = connectionPath(conn, parts);
    if (!points) continue;
    const segs = polylineToSegments(points);

    // ③ 线 vs 板子（中间段）
    for (const bp of boardParts) {
      const br = partRects.get(bp.id);
      for (let s = 1; s < segs.length - 1; s++) {
        const [a, b] = segs[s];
        if (br && lineHitsRect(a.x, a.y, b.x, b.y, br)) {
          conflicts.push({ conn: i, type: 'wire-through-board', connStr: JSON.stringify(conn) });
          break;
        }
      }
      if (conflicts.some(c => c.conn === i && c.type === 'wire-through-board')) break;
    }

    // ④ 线 vs 元件（中间段穿任何元件，含两端）
    for (const [pid, rect] of partRects) {
      let hit = false;
      for (let s = 1; s < segs.length - 1; s++) {
        const [a, b] = segs[s];
        if (lineHitsRect(a.x, a.y, b.x, b.y, rect)) {
          conflicts.push({ conn: i, type: 'hits-part', part: pid, connStr: JSON.stringify(conn) });
          hit = true;
          break;
        }
      }
      if (hit) break;
    }

    // ⑤ 线交叉（不同元件之间的线）
    const c1From = conn[0].split(':')[0];
    const c1To = conn[1].split(':')[0];
    for (let j = i + 1; j < conns.length; j++) {
      const conn2 = conns[j];
      const wp2 = conn2.length > 3 ? conn2[3] : [];
      if (wp2.includes('$bb')) continue;
      const c2From = conn2[0].split(':')[0];
      const c2To = conn2[1].split(':')[0];
      if (c1From === c2From || c1From === c2To || c1To === c2From || c1To === c2To) continue;
      const points2 = connectionPath(conn2, parts);
      if (!points2) continue;
      const segs2 = polylineToSegments(points2);
      let crossed = false;
      for (const [a, b] of segs) {
        if (crossed) break;
        for (const [c, d] of segs2) {
          if (segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) {
            conflicts.push({ conn: i, type: 'cross', with: j, connStr: JSON.stringify(conn) });
            crossed = true;
            break;
          }
        }
      }
    }

    // ⑥ 线重叠（不同元件之间的线；共享元件的线在引脚区自然密集）
    for (let j = i + 1; j < conns.length; j++) {
      const conn2 = conns[j];
      const wp2 = conn2.length > 3 ? conn2[3] : [];
      if (wp2.includes('$bb')) continue;
      // 只检测共享同一引脚端点的线对（如都连 uno:5V → 共线问题）
      // 不共享端点 → 跳过（不同引脚的线密集是正常的）
      const sharedPin = (conn[0] === conn2[0] || conn[0] === conn2[1] ||
                         conn[1] === conn2[0] || conn[1] === conn2[1]);
      if (!sharedPin) continue;
      const points2 = connectionPath(conn2, parts);
      if (!points2) continue;
      const segs2 = polylineToSegments(points2);
      let overlapped = false;
      for (const [a, b] of segs) {
        if (overlapped) break;
        for (const [c, d] of segs2) {
          const shared =
            (Math.abs(a.x - c.x) < 0.5 && Math.abs(a.y - c.y) < 0.5) ||
            (Math.abs(a.x - d.x) < 0.5 && Math.abs(a.y - d.y) < 0.5) ||
            (Math.abs(b.x - c.x) < 0.5 && Math.abs(b.y - c.y) < 0.5) ||
            (Math.abs(b.x - d.x) < 0.5 && Math.abs(b.y - d.y) < 0.5);
          if (shared) continue;
          const dmin = segsMinDist(a, b, c, d);
          if (dmin > 0.01 && dmin < OVERLAP_THRESHOLD) {
            conflicts.push({ conn: i, type: 'overlap', with: j, connStr: JSON.stringify(conn) });
            overlapped = true;
            break;
          }
        }
      }
    }
  }

  return conflicts;
}

// ============================================================
// 主流程
// ============================================================
function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('用法: node optimize-wiring.js <project-dir> [--dry-run]');
    process.exit(1);
  }
  const PROJECT_DIR = path.resolve(args[0]);
  const DRY_RUN = args.includes('--dry-run');

  const diagramPath = path.join(PROJECT_DIR, 'diagram.json');
  if (!fs.existsSync(diagramPath)) {
    console.error(`[ERR] 未找到 ${diagramPath}`);
    process.exit(1);
  }

  const diagram = JSON.parse(fs.readFileSync(diagramPath, 'utf-8'));

  // 加载尺寸表
  let sizesData = { sizes: {}, default: { width: 20, height: 20 } };
  const sizesPath = path.join(__dirname, '..', 'references', 'common', 'sizes.json');
  if (fs.existsSync(sizesPath)) {
    sizesData = JSON.parse(fs.readFileSync(sizesPath, 'utf-8'));
  }

  // 加载引脚坐标（pins.json）
  loadPins();

  // 构建元件矩形（带安全边距；rotate 90/270 时宽高交换）
  const parts = diagram.parts || [];
  const partRects = new Map();
  for (const p of parts) {
    const size = (sizesData.sizes && sizesData.sizes[p.type]) || sizesData.default || { width: 20, height: 20 };
    const rotated = p.rotate === 90 || p.rotate === 270;
    p.w = rotated ? size.height : size.width;
    p.h = rotated ? size.width : size.height;
    partRects.set(p.id, makeRect(p.left || 0, p.top || 0, p.w, p.h, SAFE_MARGIN));
  }

  // 检测冲突（函数化）

  const conflicts = detectConflicts(diagram, partRects);


  // 报告
  console.log(`[INFO] 元件 ${parts.length} 个, 连接 ${(diagram.connections || []).length} 条`);
  console.log(`[INFO] 检测到冲突 ${conflicts.length} 处:`);
  const TYPE_LABEL = {
    'hits-part': '线穿元件',
    'cross': '线交叉',
    'part-on-board': '元件遮挡板子',
    'part-on-breadboard': '元件遮挡面包板',
    'parts-overlap': '元件重叠',
    'wire-through-board': '线穿板子',
    'overlap': '线重叠'
  };
  for (const c of conflicts.slice(0, 15)) {
    const label = TYPE_LABEL[c.type] || c.type;
    const detail = c.type === 'part-on-board' ? `(${c.part}: ${c.connStr})`
      : c.type === 'parts-overlap' ? `(${c.connStr})`
      : `(连接 #${c.conn}${c.part ? ' 穿 ' + c.part : ''}): ${c.connStr}`;
    console.log(`  - ${label} ${detail}`);
  }
  if (conflicts.length > 15) console.log(`  ... 等 ${conflicts.length} 处`);

  if (DRY_RUN) {
    console.log('[DRY-RUN] 仅检测，未写入');
    process.exit(conflicts.length > 0 ? 2 : 0);
  }

  // ============================================================
  // 修正逻辑（启发式：迭代逼近，模拟人的微调）
  // ============================================================
  console.log('[INFO] 开始修正...');
  let iteration = 0;
  const MAX_ITER = 8;
  let totalFixed = 0;

  while (iteration < MAX_ITER) {
    iteration++;
    if (conflicts.length === 0) break;
    let fixed = 0;

    for (const c of conflicts) {
      if (c.type === 'part-on-board') {
        // ① 元件遮挡板子 → 移动到【目标区域】（按元件类型，一步到位）
        const part = diagram.parts.find(p => p.id === c.part);
        const board = parts.find(p => p.type.includes("arduino") || p.type.includes("esp32"));
        if (part && board) {
          const bw = board.w || 70, bh = board.h || 50;
          const bx = board.left || 0, by = board.top || 0;
          const bcx = bx + bw / 2, bcy = by + bh / 2;
          const pw = part.w || 20, ph = part.h || 20;
          const MARGIN = 30;
          const type = part.type || '';

          let tx, ty; // 目标位置
          if (type.includes('pushbutton') || type.includes('buzzer')) {
            // 交互类（按钮/蜂鸣器）→ 板子下方
            tx = bcx - pw / 2;
            ty = by + bh + MARGIN;
          } else if (type.includes('dht') || type.includes('pir') || type.includes('hc-sr') ||
                     type.includes('ultrasonic') || type.includes('led')) {
            // 传感器/LED → 板子上方
            tx = bcx - pw / 2;
            ty = by - ph - MARGIN;
          } else if (type.includes('oled') || type.includes('lcd') || type.includes('segment')) {
            // 显示类 → 板子上方（右侧偏置避免与传感器挤）
            tx = bx + bw - pw - MARGIN;
            ty = by - ph - MARGIN;
          } else {
            // 其他 → 板子右侧
            tx = bx + bw + MARGIN;
            ty = bcy - ph / 2;
          }
          part.left = Math.round(tx);
          part.top = Math.round(ty);
          // 更新矩形
          partRects.set(part.id, makeRect(part.left, part.top, part.w, part.h, SAFE_MARGIN));
          console.log(`  [修正] 元件 ${c.part} → 目标区域 (${type}) @ (${tx}, ${ty})`);
          fixed++;
        }
      } else if (c.type === 'parts-overlap') {
        // 元件重叠 → 移动【非板子】元件错开（板子是基准，不动）
        const a = diagram.parts.find(p => p.id === c.a);
        const b = diagram.parts.find(p => p.id === c.b);
        const isBoardA = a && (a.type.includes('arduino') || a.type.includes('esp32'));
        const isBoardB = b && (b.type.includes('arduino') || b.type.includes('esp32'));
        const move = (!isBoardA && a) ? a : ((!isBoardB && b) ? b : null);
        if (move) {
          move.left = (move.left || 0) + 50;
          partRects.set(move.id, makeRect(move.left, move.top, move.w, move.h, SAFE_MARGIN));
          console.log(`  [修正] 元件 ${move.id} 右移错开 (iter ${iteration})`);
          fixed++;
        }
      } else if (c.type === 'overlap' || c.type === 'cross') {
        // ② 线重叠/交叉 → 给连接加水平错开控制点（步进 8）
        const conn = diagram.connections[c.conn];
        if (conn) {
          const wp = conn.length > 3 ? conn[3] : [];
          if (wp.length >= 3) continue;  // 控制点上限 3，避免堆叠
          const newWp = [...wp];
          const shift = iteration * 8;
          newWp.push('h' + shift);
          if (conn.length > 3) conn[3] = newWp;
          else conn.push(newWp);
          console.log(`  [修正] 连接 #${c.conn} 加错开控制点 (iter ${iteration})`);
          fixed++;
        }
      } else if (c.type === 'wire-through-board') {
        // ③ 线穿板子 → 加"分侧出发"控制点（先垂直离开）
        const conn = diagram.connections[c.conn];
        if (conn) {
          const wp = conn.length > 3 ? conn[3] : [];
          const newWp = [...wp];
          if (newWp.length === 0) {
            newWp.push('v-40'); // 先向上离开（默认）
          } else {
            newWp.unshift('v-40');
          }
          if (conn.length > 3) conn[3] = newWp;
          else conn.push(newWp);
          console.log(`  [修正] 连接 #${c.conn} 加垂直离开点 (iter ${iteration})`);
          fixed++;
        }
      }
    }
    totalFixed += fixed;
    console.log(`[INFO] 迭代 ${iteration}: 修正 ${fixed} 处，重新检测...`);

    // 重新检测
    const newConflicts = detectConflicts(diagram, partRects);
    conflicts.length = 0;
    conflicts.push(...newConflicts);
  }

  if (conflicts.length === 0) {
    console.log(`[OK] 修正完成（${totalFixed} 处修正，${iteration} 轮迭代）→ 无冲突`);
  } else {
    console.log(`[WARN] 达到最大迭代 ${MAX_ITER}，剩余冲突 ${conflicts.length} 处`);
    for (const c of conflicts.slice(0, 5)) {
      console.log(`  - 剩余: ${c.type} ${c.connStr || c.part || ''}`);
    }
  }

  // 写入修正后的 diagram.json
  const outPath = diagramPath;
  fs.writeFileSync(outPath, JSON.stringify(diagram, null, 2));
  console.log(`[INFO] 已写入修正后的 ${outPath}`);
}

main();
