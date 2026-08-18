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
import glob
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

# 提取 pinInfo 的 name/x/y 由 extract_pins() 完成（顺序无关，见下方实现）

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
        # 注入 import 常量：mmToPix = 96/25.4（来自 ./utils/units，本地无该文件）
        self.table.setdefault("mmToPix", str(MM2PX))

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


def _skip_js_string(s: str, i: int) -> int:
    """从 i(指向引号) 跳到字符串结束后的下标。支持 ' " ` 三种引号。"""
    q = s[i]
    i += 1
    n = len(s)
    while i < n:
        if s[i] == "\\":
            i += 2
            continue
        if s[i] == q:
            return i + 1
        i += 1
    return n


def _iter_js_objects(text: str):
    """全局扫描所有 { ... } 对象(任意深度),跳过字符串/注释。

    每遇到一个配对的 { ... } 就 yield 其文本(含两端)。
    深度无关:无论 pin 对象嵌在数组、getter、switch 里都能抓到。
    """
    stack = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c in "'\"`":
            i = _skip_js_string(text, i)
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "{":
            stack.append(i)
        elif c == "}":
            if stack:
                start = stack.pop()
                yield text[start : i + 1]
        i += 1


def _field_value(obj: str, field: str):
    """提取对象里 field 字段的值文本(到 , 或 } 前)。无该字段返回 None。"""
    m = re.search(r"\b" + field + r"\s*:\s*([^,}]+)", obj)
    return m.group(1).strip() if m else None


def _to_float(val: str, ev) -> float:
    """字段值文本 → float；纯数字直接转，否则用 _TsExprEval 求值(round 2)。"""
    if re.fullmatch(r"-?[\d.]+", val):
        return float(val)
    n = ev.eval(val)
    return round(n, 2) if n is not None else None


def extract_pins(source: str) -> dict:
    """从源码提取 { pinName: [x, y] }（x/y 为 px float）。

    顺序无关 + 深度无关：全局扫描每个 { ... } 对象，只要同时含
    name(单引号字符串) + x + y 就提取。
    x/y 为纯数字直接转；否则用 _TsExprEval 求值（常量/算术/三元/this.x/mmToPix）。
    程序化坐标(spread/循环/函数调用/查表)求值失败则跳过，留给更高层。
    """
    ev = _TsExprEval(source)
    pins = {}
    for obj in _iter_js_objects(source):
        nm = re.search(r"\bname\s*:\s*'([^']+)'", obj)
        if not nm:
            continue
        xv = _field_value(obj, "x")
        yv = _field_value(obj, "y")
        if xv is None or yv is None:
            continue
        x = _to_float(xv, ev)
        y = _to_float(yv, ev)
        if x is not None and y is not None:
            pins[nm.group(1)] = [x, y]
    return pins


def _extract_batch(sources):
    """sources: (fname, source) 迭代器 → (result, sizes) 两个字典。"""
    result = {}
    sizes = {}
    for fname, source in sources:
        try:
            ptype = extract_type(source)
            if not ptype:
                continue
            pins = extract_pins(source)
            svg_w, svg_h = extract_svg_size(source)
            if svg_w is None or svg_h is None:
                print(f"  ⚠️ {ptype}: SVG 尺寸未解析，footprint 退化为引脚范围（疑似插值解析失败）", file=sys.stderr)
            fp = footprint(svg_w, svg_h, pins)
            # 即使 pins=0 也记录 footprint（如 ir-remote 无引脚但有 SVG）；跳过 [0,0] 空值
            if fp[0] > 0 and fp[1] > 0:
                sizes[ptype] = fp
            if pins:
                result[ptype] = pins
        except Exception as e:
            print(f"  ⚠️ {fname} 失败: {e}")
    return result, sizes


def _write_outputs(result, sizes):
    """写 pins-auto.json + sizes-auto.json 到 references/common/。"""
    out_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "references", "common", "pins-auto.json",
    )
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print(f"完成！输出 {len(result)} 个元件的引脚坐标到 {out_path}")

    sizes_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "references", "common", "sizes-auto.json",
    )
    with open(sizes_path, "w", encoding="utf-8") as fh:
        json.dump(sizes, fh, ensure_ascii=False, indent=2)
    print(f"输出 {len(sizes)} 个元件的 footprint 到 {sizes_path}")


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

    # --download <目录>：下载全部 ELEMENT_FILES 到本地目录（已存在则跳过）
    if "--download" in args:
        d = args[args.index("--download") + 1]
        os.makedirs(d, exist_ok=True)
        for f in ELEMENT_FILES:
            fname = f.split("/")[-1]
            dest = os.path.join(d, fname)
            if os.path.exists(dest):
                print(f"  已存在 {fname}")
                continue
            try:
                content = fetch(RAW_BASE + fname)
                with open(dest, "w", encoding="utf-8") as fh:
                    fh.write(content)
                print(f"  OK {fname}")
            except Exception as e:
                print(f"  ⚠️ {fname} 下载失败: {e}")
        print(f"下载完成到 {d}")
        return

    # --dir <目录>：从本地目录读所有 *element.ts（不下载）
    if "--dir" in args:
        d = args[args.index("--dir") + 1]
        files = sorted(glob.glob(os.path.join(d, "*element.ts")))
        result, sizes = _extract_batch(
            (os.path.basename(f), open(f, encoding="utf-8").read()) for f in files
        )
        _write_outputs(result, sizes)
        return

    # 全量下载（fetch，不落盘）
    result, sizes = _extract_batch(
        (fname, fetch(RAW_BASE + fname)) for fname in ELEMENT_FILES
    )
    _write_outputs(result, sizes)


if __name__ == "__main__":
    main()
