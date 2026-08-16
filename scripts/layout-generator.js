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

const MIN_SPACING = 30; // 元件间距
const GROUP_SPACING = 80; // 组间距

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

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('用法: node layout-generator.js <layout-intent.json> [output-dir]');
    process.exit(1);
  }
  const intent = JSON.parse(fs.readFileSync(args[0], 'utf-8'));
  const OUT_DIR = args[1] ? path.resolve(args[1]) : path.dirname(path.resolve(args[0]));
  const sizesData = loadSizes();

  // 板子位置（面包板模式：板子右侧；直连：下方居中）
  const useBB = !!intent.breadboard;
  const board = { type: intent.board || 'wokwi-arduino-uno', left: useBB ? 400 : 40, top: useBB ? 300 : 200 };
  const boardSize = sizesData.sizes[board.type] || sizesData.default;
  board.w = boardSize.width;
  board.h = boardSize.height;

  // 元件清单
  const parts = intent.parts.map(p => {
    const size = sizesData.sizes[p.type] || sizesData.default;
    return { ...p, w: size.width, h: size.height, left: 0, top: 0 };
  });
  const partById = {};
  parts.forEach(p => partById[p.id] = p);

  // 分组与区域归属（直连分支依赖，之前缺失导致直连模式崩溃）
  const groups = intent.groups || [];
  const groupOf = {};   // part id → 所属 group
  const regionOf = {};  // part id → 所属 region
  groups.forEach(g => g.parts.forEach(id => { groupOf[id] = g; regionOf[id] = g.region; }));

  // ============================================================
  // 面包板模式（v0.7 重写）
  // 几何模型从 dragramtest.json（用户手动模板，已实测验证）校准。
  // 面包板 rotate=180（与模板一致，视觉正确）。
  // 孔位 (row n, half h∈{t,b}, letter L∈{a..j}) 画布坐标：
  //   rx(n)   = bb.left + 303 - (n-1)*9.6        （数字=水平，rotate180 后反向）
  //   ry(L,h) = bb.top  + 157 - idx(L)*9.6 - (h==='b' ? 19.2 : 0)
  // 各元件 $bb 配方（引脚→孔位 + 位置锚点，均实测校准）：
  //   按钮(rot90): 1.r→(n,t,b) 2.r→(n+2,t,b) 1.l→(n,b,g) 2.l→(n+2,b,g)；锚点 1.l 偏移 (44.5,-9.5)
  //   电阻(rot90): 1→(n,b,g) 2→(n,t,c)；锚点 1 偏移 (29.35,-24.0)
  //   DHT  (rot0) : GND→(n,b,i) NC→(n+1,b,i) SDA→(n+2,b,i) VCC→(n+3,b,i)；锚点 GND 偏移 (43.8,114.9)
  //   LED  (rot0) : 不用 $bb！可见线 A→孔(绿色)
  // ============================================================
  if (useBB) {
    const bb = { type: intent.breadboard || 'wokwi-breadboard-half', id: 'bb1', top: 100, left: 0, rotate: 180 };
    const LETTER = 'abcdefghij';
    const idx = L => LETTER.indexOf(L);
    const rx = n => bb.left + 303 - (n - 1) * 9.6;
    const ry = (L, h) => bb.top + 157 - idx(L) * 9.6 - (h === 'b' ? 19.2 : 0);

    const bbParts = parts.filter(p => (p.placement || 'bb') === 'bb');
    const boardParts = parts.filter(p => (p.placement || 'bb') !== 'bb');

    const bbConns = [];   // $bb 插接连接
    const wireConns = []; // 可见线连接（LED 等）
    // 每类元件的起始行游标（行=水平方向，rotate180 后行号越大越靠左）
    // 类型分带（与 dragramtest 模板一致，各带之间留物理宽度空档，避免相邻带重叠）：
    //   dht22: 4-9   传感区（右侧 x≈207-236）
    //   led  : 8-13  指示区（面板上方，可见线连这些行）
    //   按钮 : 16-25 输入区（中间 x≈92-159）
    //   电阻 : 27-30 指示区（左侧 x≈25-53）
    const cursors = { pushbutton: 16, resistor: 27, dht22: 4, led: 8 };
    const is = (p, t) => (p.type || '').includes(t);
    let ledCount = 0;   // LED 纵向错开计数（避免多个 LED 的 A 脚同高 → 信号线共线）

    bbParts.forEach(p => {
      if (is(p, 'pushbutton')) {
        const n = cursors.pushbutton;
        bbConns.push([`${p.id}:1.r`, `bb1:${n}t.b`, '', ['$bb']]);
        bbConns.push([`${p.id}:2.r`, `bb1:${n + 2}t.b`, '', ['$bb']]);
        bbConns.push([`${p.id}:1.l`, `bb1:${n}b.g`, '', ['$bb']]);
        bbConns.push([`${p.id}:2.l`, `bb1:${n + 2}b.g`, '', ['$bb']]);
        p.rotate = 90;
        p.left = Math.round(rx(n) - 44.5);
        p.top = Math.round(ry('g', 'b') + 9.5);
        cursors.pushbutton += 5;
      } else if (is(p, 'resistor')) {
        const n = cursors.resistor;
        bbConns.push([`${p.id}:1`, `bb1:${n}b.g`, '', ['$bb']]);
        bbConns.push([`${p.id}:2`, `bb1:${n}t.c`, '', ['$bb']]);
        p.rotate = 90;
        p.left = Math.round(rx(n) - 29.35);
        p.top = Math.round(ry('g', 'b') + 24.0);
        cursors.resistor += 3;
      } else if (is(p, 'dht')) {
        const n = cursors.dht22;
        bbConns.push([`${p.id}:GND`, `bb1:${n}b.i`, '', ['$bb']]);
        bbConns.push([`${p.id}:NC`, `bb1:${n + 1}b.i`, '', ['$bb']]);
        bbConns.push([`${p.id}:SDA`, `bb1:${n + 2}b.i`, '', ['$bb']]);
        bbConns.push([`${p.id}:VCC`, `bb1:${n + 3}b.i`, '', ['$bb']]);
        p.left = Math.round(rx(n) - 43.8);
        p.top = Math.round(ry('i', 'b') - 114.9);
        cursors.dht22 += 6;
      } else if (is(p, 'led')) {
        // LED：面包板上方放置（连线由 intent.connections 网表生成，不用 $bb）
        // 多个 LED 纵向错开 15px，避免 A 脚同高导致信号线水平共线
        const n = cursors.led;
        p.left = Math.round(rx(n) - 25);   // A 引脚 x 对准孔
        p.top = bb.top - 80 + ledCount * 15;
        cursors.led += 5;
        ledCount++;
      } else {
        // 未知类型：回退为直连（放板子旁）
        boardParts.push(p);
      }
    });

    // 直连元件：分区围绕板子（top/right/bottom）
    const dRegions = {
      top:    { x: board.left, y: board.top - 160 },
      right:  { x: board.left + board.w + 40, y: board.top - 20 },
      bottom: { x: board.left, y: board.top + board.h + 80 }
    };
    const dCursor = { top: 0, right: 0, bottom: 0 };
    (intent.groups || []).forEach(g => {
      const reg = (g.region === 'top' || g.region === 'right' || g.region === 'bottom') ? g.region : 'right';
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

    // ============================================================
    // 走线生成（v1）：读取 intent.connections 逻辑网表，生成物理连线
    // 模型给网表（谁连谁），脚本按引脚坐标 + 出线方向生成可见线
    // ============================================================
    const pins = loadPins();
    const pinPos = (id, pinName) => {
      let base, type, rotate;
      if (id === 'uno') {
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
      const pd = pins[type];
      if (!pd) return null;
      const off = (rotate === 90 && pd._rot90 && pd._rot90[pinName]) ? pd._rot90[pinName] : pd[pinName];
      if (!off) return null;
      return { x: base.left + off[0], y: base.top + off[1] };
    };
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
    const freeHole = (row, half, dir) => {
      const key = `${row}:${half}`;
      const used = usedHoles[key] || new Set();
      // dir>=0: 选「最上方」空闲字母（跳出元件本体 → 线从上方可见）；dir<0: 最下方
      const order = dir >= 0 ? [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      for (const idx of order) {
        const letter = 'abcdefghij'[idx];
        if (!used.has(letter)) return { row, half, letter };
      }
      return null;
    };
    const holePos = (h) => ({ x: rx(h.row), y: ry(h.letter, h.half) });

    // ============================================================
    // 电源架构（A2）：GND/5V 走电源轨，而非直连板子引脚（就近走轨不穿板）
    // 轨坐标 rotate 180（近似，待 Wokwi 实测校准）：
    //   bn=下负轨(视觉顶部) bp=下正轨 tn=上负轨 tp=上正轨(视觉底部)
    // ============================================================
    const railY = { bn: bb.top + 4, bp: bb.top + 10, tn: bb.top + 156, tp: bb.top + 162 };
    const railPos = (rail, n) => ({ x: rx(n), y: railY[rail] });
    // 识别电源连线（目标 = uno:GND/5V/3V3/VIN）→ 连对应轨
    const railSeen = {};   // 每类轨已用的位置号
    const railTarget = (toRef, sourceX) => {
      const m = toRef.match(/^uno:(GND|5V|3V3|VIN)/);
      if (!m) return null;
      const isGND = m[1].startsWith('GND');
      const rail = isGND ? 'bn' : 'tp';
      // 就近：轨道数字 = 源元件 x 对应的最近列（线最短、不绕圈）
      const n = Math.max(1, Math.min(30, Math.round((303 - sourceX) / 9.6) + 1));
      railSeen[rail] = (railSeen[rail] || 0) + 1;
      return { rail, n, ref: `bb1:${rail}.${n}` };
    };

    // 走线路径（v3）：
    // ① 板子引脚按侧出线到「安全带」（板顶/板底外 15px），避开上方/下方元件（如 LED）
    // ② 水平到目标列 → 垂直到达（L/Z 形）
    // ③ 多条线汇到同一引脚时错开水平通道（stagger），避免共线
    const routeWp = (fid, fpin, a, b, stagger) => {
      if (fid === 'uno') {
        const p = (pins[board.type] || {})[fpin];
        const isTop = p && p[1] < 100;
        const safeY = (isTop ? board.top - 15 : board.top + board.h + 15) + stagger;
        return [`v${Math.round(safeY - a.y)}`, `h${Math.round(b.x - a.x)}`, `v${Math.round(b.y - safeY)}`];
      }
      // 元件/面包板孔 → 目标：先到目标 y（带错开），再水平，再回到目标 y
      const dy = b.y - a.y;
      return [`v${Math.round(dy + stagger)}`, `h${Math.round(b.x - a.x)}`, `v${Math.round(-stagger)}`];
    };

    // 统计同目标引脚的连线数，用于共线错开
    const targetCount = {};
    (intent.connections || []).forEach(c => { targetCount[c.to] = (targetCount[c.to] || 0) + 1; });
    const targetSeen = {};

    (intent.connections || []).forEach(c => {
      let fid = c.from.split(':')[0];
      const fpin = c.from.split(':')[1];
      let fromRef = c.from;
      let toRef = c.to;
      let a = pinPos(fid, fpin);
      let b = pinPos(c.to.split(':')[0], c.to.split(':')[1]);

      // ① 电源连线（目标 = GND/5V/3V3/VIN）→ 连电源轨（就近走轨，不穿板）
      const rt = railTarget(c.to, a.x);
      if (rt) {
        toRef = rt.ref;
        b = railPos(rt.rail, rt.n);
      } else {
        // ② 端点若是插面板元件引脚 → 连到同行空闲孔（面包板内部连通）
        //    freeHole 朝「线的来向」选外侧孔，让线露在元件外侧（不被元件盖住）
        const fHole = pinHole[c.from];
        if (fHole) {
          const h = freeHole(fHole.row, fHole.half, b.y < a.y ? 1 : -1);
          if (h) { fid = 'bb1'; fromRef = `bb1:${h.row}${h.half}.${h.letter}`; a = holePos(h); }
        }
        const tHole = pinHole[c.to];
        if (tHole) {
          const h = freeHole(tHole.row, tHole.half, a.y < b.y ? 1 : -1);
          if (h) { toRef = `bb1:${h.row}${h.half}.${h.letter}`; b = holePos(h); }
        }
      }

      if (!a || !b) {
        console.log(`  [走线跳过] ${c.from}→${c.to}：引脚坐标缺失`);
        return;
      }
      const seen = targetSeen[c.to] || 0;
      targetSeen[c.to] = seen + 1;
      const stagger = targetCount[c.to] > 1 ? seen * 10 : 0;
      wireConns.push([fromRef, toRef, c.color || 'green', routeWp(fid, fpin, a, b, stagger)]);
    });

    // 电源轨主线：板子 GND/5V → 就近轨（板子在下 → 上负轨 tn / 上正轨 tp），
    // 再跳线 tn→bn、tp→bp 连到元件取电用的轨（上下轨连通）
    if (railSeen['bn']) {
      wireConns.push(['uno:GND.2', 'bb1:tn.1', 'black', routeWp('uno', 'GND.2', pinPos('uno', 'GND.2'), railPos('tn', 1), 0)]);
      wireConns.push(['bb1:tn.30', 'bb1:bn.30', 'black', ['v0']]);
    }
    if (railSeen['tp']) {
      wireConns.push(['uno:5V', 'bb1:tp.1', 'red', routeWp('uno', '5V', pinPos('uno', '5V'), railPos('tp', 1), 0)]);
      wireConns.push(['bb1:tp.30', 'bb1:bp.30', 'red', ['v0']]);
    }

    // 输出
    const outParts = [
      { type: bb.type, id: 'bb1', top: bb.top, left: bb.left, rotate: bb.rotate, attrs: {} },
      { type: board.type, id: 'uno', top: board.top, left: board.left, attrs: {} },
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
    console.log(`[OK] 面包板布局：${bbParts.length} 插面板 + ${boardParts.length} 直连 + ${bbConns.length} 条 $bb + ${wireConns.length} 条可见线`);
    console.log('[INFO] 输出:', path.join(OUT_DIR, 'diagram.json'));
    return;
  }

  // 第 1 层：区域分配（硬）— 每个 region 独立排布，组间自动错开
  // ============================================================
  const regions = {
    top:    { baseX: board.left, baseY: board.top - 160, dirX: 1, rowMax: 4, rowGap: 45 },
    bottom: { baseX: board.left, baseY: board.top + board.h + 80, dirX: 1, rowMax: 4, rowGap: 45 },
    left:   { baseX: board.left - 160, baseY: board.top, dirX: 1, rowMax: 3, rowGap: 40 },
    right:  { baseX: board.left + board.w + 150, baseY: board.top - 20, dirX: 1, rowMax: 3, rowGap: 40 },
  };

  // 每个 region 的"下一个组起始位置"（组间错开）
  const regionCursor = {};
  Object.keys(regions).forEach(k => regionCursor[k] = { x: regions[k].baseX, y: regions[k].baseY });

  // 组内排布：纵向优先（每列 columnMax 个，列横向分开）— 让线从板子出发有纵向空间
  groups.forEach(g => {
    const reg = regions[g.region];
    const cur = regionCursor[g.region];
    const columnMax = (g.region === 'top' || g.region === 'bottom') ? 2 : 1;
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
      if (p.type.includes('led')) spacing = 50;
      if (idx > 0 && colCount >= columnMax) {
        colX += colMaxW + spacing;  // 换列
        colY = cur.y;
        colCount = 0;
        colMaxW = 0;
      }
      p.left = Math.round(colX);
      p.top = Math.round(colY);
      // 电阻自动垂直放置（rotate 90）：与 LED 纵向配对更清晰
      if (p.type.includes('resistor')) {
        p.rotate = 90;
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
    if (g.region === 'top' || g.region === 'bottom') {
      regionCursor[g.region] = { x: cur.x + groupW + GROUP_SPACING, y: cur.y };
    } else {
      regionCursor[g.region] = { x: cur.x, y: cur.y + totalH + GROUP_SPACING };
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
        const safeTop = Math.min(reg.baseY - p.h, board.top - p.h - 20);
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
  // 输出：diagram.json parts
  // ============================================================
  const outputParts = parts.map(p => {
    const out = { type: p.type, id: p.id, top: p.top, left: p.left, attrs: p.attrs || {} };
    if (p.rotate) out.rotate = p.rotate;
    return out;
  });
  outputParts.unshift({ type: board.type, id: 'uno', top: board.top, left: board.left, attrs: {} });

  const result = { version: 1, author: 'layout-generator', editor: 'wokwi', parts: outputParts, connections: [] };
  fs.writeFileSync(path.join(OUT_DIR, 'diagram.json'), JSON.stringify(result, null, 2));
  console.log(`[OK] 布局生成完成：${parts.length} 元件 + 板子`);
  if (issues.length) {
    console.log(`[WARN] 硬约束修复 ${issues.length} 处:`);
    [...new Set(issues)].forEach(i => console.log(`  - ${i}`));
  }
  console.log(`[INFO] 输出: ${path.join(OUT_DIR, 'diagram.json')}`);
}

main();
