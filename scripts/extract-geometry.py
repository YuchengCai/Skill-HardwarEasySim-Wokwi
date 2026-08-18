#!/usr/bin/env python3
"""
extract-geometry.py — 从 wokwi-elements 源码提取元件引脚坐标

功能：
  1. 下载 wokwi-elements 的元件 .ts 源码（或读本地文件）
  2. 正则提取 pinInfo 的 { name, x, y }
  3. 生成 pins-auto.json（wokwi-* 部分，x/y 为 px 直接用）

用法：
  python3 extract-geometry.py                      # 全量下载所有元件 → pins-auto.json
  python3 extract-geometry.py --local <file.ts>    # 只对本地文件跑正则（验证用，不下载；输出引脚+footprint）
  python3 extract-geometry.py --board <board.json> # 从 board.json 提取引脚（mm→px）
  python3 extract-geometry.py --out <文件路径>     # 指定输出文件

输出默认：<脚本同目录>/../references/common/pins-auto.json
"""
import json
import os
import re
import sys
import urllib.request

# 修复 Windows 中文输出（GBK 编码崩溃）
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

REPO = "wokwi/wokwi-elements"
BRANCH = "main"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/src/"

# 元件文件列表（与 extract-components.py 同源，wokwi-elements src/ 下的 *-element.ts）
ELEMENT_FILES = [
    "7segment-element.ts", "analog-joystick-element.ts",
    "arduino-mega-element.ts", "arduino-nano-element.ts",
    "arduino-uno-element.ts", "biaxial-stepper-element.ts",
    "big-sound-sensor-element.ts", "buzzer-element.ts",
    "dht22-element.ts", "dip-switch-8-element.ts",
    "ds1307-element.ts", "esp32-devkit-v1-element.ts",
    "flame-sensor-element.ts", "franzininho-element.ts",
    "gas-sensor-element.ts", "hc-sr04-element.ts",
    "heart-beat-sensor-element.ts", "hx711-element.ts",
    "ili9341-element.ts", "ir-receiver-element.ts",
    "ir-remote-element.ts", "ks2e-m-dc5-element.ts",
    "ky-040-element.ts", "lcd1602-element.ts",
    "lcd2004-element.ts", "led-bar-graph-element.ts",
    "led-element.ts", "led-ring-element.ts",
    "membrane-keypad-element.ts", "microsd-card-element.ts",
    "mpu6050-element.ts", "nano-rp2040-connect-element.ts",
    "neopixel-element.ts", "neopixel-matrix-element.ts",
    "ntc-temperature-sensor-element.ts", "photoresistor-sensor-element.ts",
    "pir-motion-sensor-element.ts", "potentiometer-element.ts",
    "pushbutton-6mm-element.ts", "pushbutton-element.ts",
    "resistor-element.ts", "rgb-led-element.ts",
    "rotary-dialer-element.ts", "servo-element.ts",
    "slide-potentiometer-element.ts", "slide-switch-element.ts",
    "small-sound-sensor-element.ts", "ssd1306-element.ts",
    "stepper-motor-element.ts", "tilt-switch-element.ts",
]

# 提取 type 名：@customElement('wokwi-xxx')
TYPE_RE = re.compile(r"@customElement\('([^']+)'\)")

# 提取 pinInfo 的 name/x/y（x/y 为 px，直接可用）
PIN_RE = re.compile(r"\{\s*name:\s*'([^']+)',\s*x:\s*(-?[\d.]+),\s*y:\s*(-?[\d.]+)")

class _TsExprEval:
    """解析 wokwi-elements 源码里 svg width/height 的简单 TS 表达式。

    wokwi-elements 的 <svg width> 有时是模板插值，例如：
      ssd1306:   <svg width="${width}">              + readonly width = 150;
      slide-pot: <svg width="${travelLength + 25}mm"> + travelLength = 30;
      lcd1602:   <svg width="${width}mm">             + const width = this.screenOnly
                                                        ? panelWidth : panelWidth + 23.8;
    支持：类字段/局部 const/getter 查表、this.x、三元、+ - * / ( )。
    解析不了返回 None（footprint 退化为引脚范围并告警）。
    """

    def __init__(self, source):
        self.table = {}
        # 类字段：readonly width = 150; / @property() screenOnly = false;
        for m in re.finditer(
            r"(?:(?:readonly|protected|private|public|static)\s+)*"
            r"([A-Za-z_$][\w$]*)\s*=\s*(true|false|-?[\d.]+)\s*;",
            source,
        ):
            self.table[m.group(1)] = m.group(2)
        # getter：get panelHeight() { return this.rows * 5.75; }
        for m in re.finditer(
            r"get\s+([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\{\s*return\s+(.+?)\s*;\s*\}",
            source,
            re.DOTALL,
        ):
            self.table[m.group(1)] = ("raw", m.group(2))
        # 局部 const：const width = this.screenOnly ? panelWidth : panelWidth + 23.8;
        # （解构 const { a } = ... 以 { 开头，不会误匹配）
        for m in re.finditer(
            r"\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*;", source, re.DOTALL
        ):
            self.table[m.group(1)] = ("raw", m.group(2))

    def eval(self, expr, _depth=0):
        """表达式 → 数值(float)；解析不了返回 None。"""
        if _depth > 20 or not expr:
            return None
        raw = self._resolve_expr(expr.strip(), _depth)
        if raw is None:
            return None
        if raw in ("true", "false"):
            return 1.0 if raw == "true" else 0.0
        if not re.fullmatch(r"[0-9.\s+\-*/()]+", raw):
            return None
        try:
            return float(eval(raw, {"__builtins__": {}}, {}))
        except Exception:
            return None

    def _resolve_expr(self, raw, _depth):
        """把表达式里的 this.x / 标识符 / 三元 替换成算术串；失败返回 None。"""
        if _depth > 20:
            return None
        raw = re.sub(
            r"\bthis\.([A-Za-z_$][\w$]*)",
            lambda m: self._resolve_name(m.group(1), _depth),
            raw,
        )
        if raw is None:
            return None
        m = re.fullmatch(r"(.+?)\s*\?\s*(.+?)\s*:\s*(.+?)", raw)
        if m:
            cond = self.eval(m.group(1), _depth + 1)
            if cond is None:
                return None
            return self._resolve_expr(m.group(2) if cond else m.group(3), _depth + 1)
        return re.sub(
            r"\b([A-Za-z_$][\w$]*)\b",
            lambda m: self._resolve_name(m.group(1), _depth),
            raw,
        )

    def _resolve_name(self, name, _depth):
        if name in ("true", "false"):
            return "1" if name == "true" else "0"  # 布尔 → 数值，避免被标识符替换误伤
        if name not in self.table:
            return "NaN"  # 未知名 → 后续校验失败 → eval 返回 None
        v = self.table[name]
        if isinstance(v, str):
            return v
        return self._resolve_expr(v[1], _depth + 1)


def extract_svg_size(source):
    """提取 <svg> 的 width/height → (px, px) 或 (None, None)。

    兼容：属性顺序任意、单双引号、字面量（45mm / 150 / 150px）、
    模板插值（${travelLength + 25}mm，用 _TsExprEval 解析）。
    抓不到时 footprint 退化为「引脚范围」。
    """
    m = re.search(r"<svg\b([^>]*)>", source, re.DOTALL)
    if not m:
        return None, None
    attrs = m.group(1)
    ev = _TsExprEval(source)

    def attr(name):
        m2 = re.search(r"\b" + name + r'\s*=\s*["\']([^"\']+)["\']', attrs)
        if not m2:
            return None
        val = m2.group(1).strip()
        # 模板插值：${expr} / ${expr}mm / ${expr}px
        m3 = re.fullmatch(r"\$\{([^}]+)\}(mm|px)?", val)
        if m3:
            n = ev.eval(m3.group(1))
            if n is None:
                return None
            return n * MM2PX if m3.group(2) == "mm" else n
        # 字面量：45mm / 150 / 150px
        m4 = re.fullmatch(r"([\d.]+)(mm|px)?", val)
        if not m4:
            return None
        v = float(m4.group(1))
        return v * MM2PX if m4.group(2) == "mm" else v

    return attr("width"), attr("height")

# board.json 的 mm→px 换算（96dpi：1 英寸 = 25.4mm = 96px）
MM2PX = 96 / 25.4  # = 3.779527559055118


def mm2px(v: float) -> float:
    """mm → px，保留 2 位小数（引脚坐标用）。"""
    return round(v * MM2PX, 2)


def footprint(svg_w_px, svg_h_px, pins: dict) -> list:
    """footprint = max(SVG 尺寸(px), 引脚范围)，round 1 位。

    SVG 尺寸缺失（svg_w_px/svg_h_px 为 None）时退化为「引脚范围」。
    """
    max_x = max((p[0] for p in pins.values()), default=0)
    max_y = max((p[1] for p in pins.values()), default=0)
    if svg_w_px is None or svg_h_px is None:
        return [round(max_x, 1), round(max_y, 1)]
    w = max(round(svg_w_px, 1), round(max_x, 1))
    h = max(round(svg_h_px, 1), round(max_y, 1))
    return [w, h]


def strip_jsonc(text: str) -> str:
    """去掉 JSONC 注释（/* */ 和 //），字符串字面量内的内容保持不变。"""
    out = []
    i, n = 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\":
                if i + 1 < n:
                    out.append(text[i + 1])
                    i += 2
                    continue
            elif c == '"':
                in_str = False
            i += 1
        elif c == '"':
            in_str = True
            out.append(c)
            i += 1
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end == -1:  # 未闭合的注释，丢弃到结尾
                break
            i = end + 2
        elif text.startswith("//", i):
            end = text.find("\n", i + 2)
            if end == -1:
                break
            out.append("\n")  # 保留换行，避免前后 token 粘连
            i = end + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "wokwi-extractor"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def extract_type(source: str):
    m = TYPE_RE.search(source)
    return m.group(1) if m else None


def extract_pins(source: str) -> dict:
    """从源码提取 { pinName: [x, y] }（x/y 为 px float）"""
    pins = {}
    for m in PIN_RE.finditer(source):
        name, x, y = m.group(1), float(m.group(2)), float(m.group(3))
        pins[name] = [x, y]
    return pins


def main():
    args = sys.argv[1:]

    # --local <file>：只对本地文件跑正则（验证用，不下载）
    if "--local" in args:
        i = args.index("--local")
        fname = args[i + 1]
        source = open(fname, encoding="utf-8").read()
        ptype = extract_type(source)
        pins = extract_pins(source)
        # footprint：SVG 尺寸(px) 与引脚范围取大者（round 1 位）
        svg_w, svg_h = extract_svg_size(source)
        if svg_w is None or svg_h is None:
            print(f"⚠️ {ptype or fname}: SVG 尺寸未解析，footprint 退化为引脚范围（疑似插值解析失败）", file=sys.stderr)
        result = {ptype: pins}
        result["footprint"] = footprint(svg_w, svg_h, pins)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    # --board <board.json>：从 board.json 提取引脚（x/y 单位 mm，换算成 px）
    if "--board" in args:
        i = args.index("--board")
        bpath = args[i + 1]
        data = json.loads(strip_jsonc(open(bpath, encoding="utf-8").read()))
        pins = {name: [mm2px(p["x"]), mm2px(p["y"])] for name, p in data.get("pins", {}).items()}
        # 注意：size 用 1 位小数、引脚用 2 位小数 —— 与权威样例 ssd1306-board.json
        # 的换算结果 [104.7, 85.4] 一致（若统一 round 2 位会得到 [104.69, 85.42]）。
        size = [round(v * MM2PX, 1) for v in (data["width"], data["height"])]
        print(json.dumps({"pins": pins, "size": size}, ensure_ascii=False, indent=2))
        return

    # 全量下载
    out_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "references", "common", "pins-auto.json",
    )
    if "--out" in args:
        out_path = args[args.index("--out") + 1]

    result = {}
    sizes = {}
    for f in ELEMENT_FILES:
        fname = f.split("/")[-1]
        print(f"  处理 {fname} ...")
        try:
            source = fetch(RAW_BASE + fname)
            ptype = extract_type(source)
            pins = extract_pins(source)
            if ptype and pins:
                result[ptype] = pins
                svg_w, svg_h = extract_svg_size(source)
                if svg_w is None or svg_h is None:
                    print(f"  ⚠️ {ptype}: SVG 尺寸未解析，footprint 退化为引脚范围（疑似插值解析失败）", file=sys.stderr)
                sizes[ptype] = footprint(svg_w, svg_h, pins)
        except Exception as e:
            print(f"  ⚠️ {fname} 失败: {e}")

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print(f"\n完成！输出 {len(result)} 个元件的引脚坐标到 {out_path}")

    # 同时输出 footprint → sizes-auto.json（尺寸自动提取，后续由 pro 合并进 sizes.json）
    sizes_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "references", "common", "sizes-auto.json",
    )
    with open(sizes_path, "w", encoding="utf-8") as fh:
        json.dump(sizes, fh, ensure_ascii=False, indent=2)
    print(f"输出 {len(sizes)} 个元件的 footprint 到 {sizes_path}")


if __name__ == "__main__":
    main()
