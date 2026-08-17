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

// 面包板几何（单一事实源 geometry.json，与 optimize-wiring.js / breadboard.md 共用）
function loadGeometry() {
  const p = path.join(__dirname, '..', 'references', 'common', 'geometry.json');
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
  const board = { type: intent.board || 'wokwi-arduino-uno', left: useBB ? 400 : 40, top: useBB ? 310 : 200 };
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
  const regionOf = {};  // part id → 所属 region（直连 region；zone 已映射）
  const ZONE_DIRECT = { output: 'top', input: 'right', sensor: 'right', display: 'right', misc: 'right' };
  const directRegion = (g) => ['top', 'right', 'bottom', 'left'].includes(g.region) ? g.region
                      : (ZONE_DIRECT[g.zone] || 'right');
  groups.forEach(g => g.parts.forEach(id => { groupOf[id] = g; regionOf[id] = directRegion(g); }));

  // 引脚坐标 + 面包板对象 + 走线路由（两个分支共用：面包板 / 直连）
  const pins = loadPins();
  let bb = null;   // 面包板对象（面包板分支赋值；直连分支保持 null，pinPos 不引用 bb1）

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

  const boardPinSide = (id, pin) => {
    if (id !== 'uno' || !pin) return null;
    const p = (pins[board.type] || {})[pin];
    return p && p[1] < 100 ? 'top' : 'bottom';
  };

  const routeWp = (fid, fpin, a, b, stagger, toId, toPin) => {
    const r1 = v => Math.round(v * 10) / 10;   // 1 位小数
    if (fid === 'uno') {
      // 板源 → 目标：出线到板外安全带（远一点，给别的线留空间），不沿引脚排横穿
      const side = boardPinSide(fid, fpin);
      const safeY = (side === 'top' ? board.top - 15 : board.top + board.h + 15) + stagger;
      const v1 = r1(safeY - a.y);
      const h1 = r1(b.x - a.x);
      const v3 = r1(b.y - (a.y + v1));
      return [`v${v1}`, `h${h1}`, `v${v3}`];
    }
    if (toId === 'uno') {
      // 元件源 → 板脚：贴近板子的安全带（短接近，避免横跨别的线）
      const side = boardPinSide(toId, toPin);
      const safeY = (side === 'top' ? board.top - 7 : board.top + board.h + 7) + stagger;
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
  //   DHT  (rot0) : GND→(n,b,i) NC→(n+1,b,i) SDA→(n+2,b,i) VCC→(n+3,b,i)；锚点 GND 偏移 (43.8,114.9)
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
    bb = { type: intent.breadboard || 'wokwi-breadboard-half', id: 'bb1', top: 100, left: 0, rotate: 180 };
    const LETTER = 'abcdefghij';
    const idx = L => LETTER.indexOf(L);
    const rx = n => bb.left + (BB_W - OFF_X) - (n - 1) * PITCH;
    const ry = (L, h) => bb.top + (BB_H - OFF_Y) - idx(L) * PITCH - (h === 'b' ? OFF_B : 0);
    const r2 = v => Math.round(v * 100) / 100;   // 保留 2 位小数，$bb 引脚精确对齐孔位（Wokwi 需精确位置才显示插接绿点）

    const bbParts = parts.filter(p => (p.placement || 'bb') === 'bb');
    const boardParts = parts.filter(p => (p.placement || 'bb') !== 'bb');

    const bbConns = [];   // $bb 插接连接
    const wireConns = []; // 可见线连接（LED 等）
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
      const m1 = f.match(/^uno:(\d+)$/), m2 = t.match(/^(btn\d+):2\.r$/);
      if (m1 && m2) { const pd = (pins[board.type] || {})[m1[1]]; if (pd) btnSignalX[m2[1]] = pd[0]; }
      else {
        const m3 = t.match(/^uno:(\d+)$/), m4 = f.match(/^(btn\d+):2\.r$/);
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
        p.left = r2(rx(n) - 43.8);
        p.top = r2(ry('i', 'b') - 114.9);
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
      top:    { x: board.left, y: board.top - 160 },
      right:  { x: board.left + board.w + 40, y: board.top - 20 },
      bottom: { x: board.left, y: board.top + board.h + 80 },
      left:   { x: board.left - 160, y: board.top }
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
    const railTarget = (toRef, sourceX) => {
      const m = toRef.match(/^uno:(GND|5V|3V3|VIN)/);
      if (!m) return null;
      const isGND = m[1].startsWith('GND');
      const rail = isGND ? 'bn' : 'tp';
      // 就近：扫描 1..25 找离源 x 最近的空闲位置（一孔一接）
      const used = railUsed[rail];
      let best = 1, bestDist = Infinity;
      for (let n = 1; n <= RAIL_MAX; n++) {
        const d = Math.abs(railX(n) - sourceX);
        if (d < bestDist && !used.has(n)) { bestDist = d; best = n; }
      }
      used.add(best);
      return { rail, n: best, ref: `bb1:${rail}.${best}` };
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
      (intent.connections || []).forEach(c => {
        const m = c.from.match(/^uno:(\S+)$/);
        if (!m) return;
        const pd = (pins[board.type] || {})[m[1]];
        if (!pd || !Array.isArray(pd)) return;
        const side = pd[1] < 100 ? 'top' : 'bottom';
        if (!usedBySide[side].includes(m[1])) usedBySide[side].push(m[1]);
      });
      (['top', 'bottom']).forEach(side => {
        usedBySide[side].sort((a, b) => pins[board.type][a][0] - pins[board.type][b][0]);
        usedBySide[side].forEach((k, i) => { boardPinLane[k] = i; });
      });
    }

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
        b = railPos(rt.rail, rt.n);   // 先算轨位置，供下方判断出线方向
        // 源若是插面板引脚（$bb）→ 从「同行空闲孔」出线再接轨，而非从引脚直接出线
        // （面包板接线惯例：引脚插孔、相邻孔出线 —— 与 dragramtest 模板一致）
        const fHole = pinHole[c.from];
        if (fHole) {
          const h = freeHole(fHole.row, fHole.half, fHole.letter, b.y < a.y ? 1 : -1);
          if (h) { fid = 'bb1'; fromRef = `bb1:${h.row}${h.half}.${h.letter}`; a = holePos(h); }
        }
      } else {
        // ② 端点若是插面板元件引脚 → 连到同行空闲孔（面包板内部连通）
        //    freeHole 朝「线的来向」选外侧孔，让线露在元件外侧（不被元件盖住）
        const fHole = pinHole[c.from];
        if (fHole) {
          const h = freeHole(fHole.row, fHole.half, fHole.letter, b.y < a.y ? 1 : -1);
          if (h) { fid = 'bb1'; fromRef = `bb1:${h.row}${h.half}.${h.letter}`; a = holePos(h); }
        }
        const tHole = pinHole[c.to];
        if (tHole) {
          const h = freeHole(tHole.row, tHole.half, tHole.letter, a.y < b.y ? 1 : -1);
          if (h) { toRef = `bb1:${h.row}${h.half}.${h.letter}`; b = holePos(h); }
        }
      }

      if (!a || !b) {
        console.log(`  [走线跳过] ${c.from}→${c.to}：引脚坐标缺失`);
        return;
      }
      let stagger = 0;
      if (fid === 'uno') {
        // 板线：按脚位 x 占独立水平车道，避免多线共线/右脚本向左压左脚出线
        const pinInfo = (pins[board.type] || {})[fpin];
        const side = pinInfo && pinInfo[1] < 100 ? 'top' : 'bottom';
        const lane = (boardPinLane[fpin] != null) ? boardPinLane[fpin] : edgeLane[side]++;
        stagger = side === 'top' ? -lane * 8 : lane * 8;
      } else {
        const seen = finalTargetSeen[toRef] || 0;
        finalTargetSeen[toRef] = seen + 1;
        stagger = seen * 10;
      }
      wireConns.push([fromRef, toRef, c.color || 'green', routeWp(fid, fpin, a, b, stagger)]);
    });

    // 电源轨主线：板子 GND/5V → 就近轨端口（tn.1/tp.1，靠板子最近的右端，直连不绕远），
    // 再跳线 tn→bn、tp→bp 连到元件取电用的轨（上下轨连通）。
    // 一孔一接：主线接 tn.1/tp.1，跳线从 tn.2→bn.2 / tp.2→bp.2（四条轨同 x 模型，
    // 同号位置同 x → 跳线纯竖直），不与主线共用孔。
    if (railUsed['bn'].size > 0) {
      // 轨主线走最左侧轨位（x<信号孔位），竖直段不横穿信号线；跳线相邻位 tn→bn
      wireConns.push(['uno:GND.2', `bb1:tn.${RAIL_MAX}`, 'black', routeWp('uno', 'GND.2', pinPos('uno', 'GND.2'), railPos('tn', RAIL_MAX), 0)]);
      wireConns.push([`bb1:tn.${RAIL_MAX - 1}`, `bb1:bn.${RAIL_MAX - 1}`, 'black', routeWp('bb1', '', railPos('tn', RAIL_MAX - 1), railPos('bn', RAIL_MAX - 1), 0)]);
    }
    if (railUsed['tp'].size > 0) {
      wireConns.push(['uno:5V', `bb1:tp.${RAIL_MAX}`, 'red', routeWp('uno', '5V', pinPos('uno', '5V'), railPos('tp', RAIL_MAX), 0)]);
      wireConns.push([`bb1:tp.${RAIL_MAX - 1}`, `bb1:bp.${RAIL_MAX - 1}`, 'red', routeWp('bb1', '', railPos('tp', RAIL_MAX - 1), railPos('bp', RAIL_MAX - 1), 0)]);
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
    right:  { baseX: board.left + board.w + 150, baseY: board.top + board.h / 2, dirX: 1, rowMax: 3, rowGap: 40 },
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
      if (p.type.includes('led')) spacing = 50;
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
    if (/^uno:GND\.\d+$/.test(c.to) && fid !== 'uno') {
      const boardMid = board.top + board.h / 2;
      toRef = (a.y < boardMid) ? 'uno:GND.1' : 'uno:GND.2';
      b = pinPos('uno', toRef.split(':')[1]);
    }
    const toId = toRef.split(':')[0];
    const toPin = toRef.split(':')[1];
    let stagger = 0;
    if (fid === 'uno') {
      // 板源：同一边每条线占一条水平车道
      const side = boardPinSide(fid, fpin);
      const lane = edgeLane[side]++;
      stagger = side === 'top' ? -lane * 8 : lane * 8;
    } else if (toId === 'uno') {
      // 元件源 → 板脚：贴近板子，小错开（4px）
      const side = boardPinSide(toId, toPin);
      const lane = targetLane[side]++;
      stagger = side === 'top' ? -lane * 4 : lane * 4;
    } else {
      // 元件→元件：同一目标引脚的第二条起错开 10px
      const seen = finalTargetSeen[toRef] || 0;
      finalTargetSeen[toRef] = seen + 1;
      stagger = seen * 10;
    }
    wireConns.push([c.from, toRef, c.color || 'green', routeWp(fid, fpin, a, b, stagger, toId, toPin)]);
  });

  // ============================================================
  // 输出：diagram.json parts + connections
  // ============================================================
  const outputParts = parts.map(p => {
    const out = { type: p.type, id: p.id, top: p.top, left: p.left, attrs: p.attrs || {} };
    if (p.rotate) out.rotate = p.rotate;
    return out;
  });
  outputParts.unshift({ type: board.type, id: 'uno', top: board.top, left: board.left, attrs: {} });

  // 紧凑输出：parts 单行、connections 单行（与面包板分支一致，不刷太多换行）
  const lines = ['{', '  "version": 1,', '  "author": "layout-generator",', '  "editor": "wokwi",', '  "parts": ['];
  outputParts.forEach((p, i) => lines.push('    ' + JSON.stringify(p) + (i < outputParts.length - 1 ? ',' : '')));
  lines.push('  ],', '  "connections": [');
  wireConns.forEach((c, i) => lines.push('    ' + JSON.stringify(c) + (i < wireConns.length - 1 ? ',' : '')));
  lines.push('  ]', '}');
  fs.writeFileSync(path.join(OUT_DIR, 'diagram.json'), lines.join('\n'));
  console.log(`[OK] 直连布局：${parts.length} 元件 + ${wireConns.length} 条可见线`);
  if (issues.length) {
    console.log(`[WARN] 硬约束修复 ${issues.length} 处:`);
    [...new Set(issues)].forEach(i => console.log(`  - ${i}`));
  }
  console.log(`[INFO] 输出: ${path.join(OUT_DIR, 'diagram.json')}`);
}

main();
