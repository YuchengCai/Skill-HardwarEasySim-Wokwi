#!/usr/bin/env python3
"""
extract-geometry.py — 从 wokwi-elements 源码提取元件引脚坐标

功能：
  1. 下载 wokwi-elements 的元件 .ts 源码（或读本地文件）
  2. 正则提取 pinInfo 的 { name, x, y }
  3. 生成 pins-auto.json（wokwi-* 部分，x/y 为 px 直接用）

用法：
  python3 extract-geometry.py                      # 全量下载所有元件 → pins-auto.json
  python3 extract-geometry.py --local <file.ts>    # 只对本地文件跑正则（验证用，不下载）
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
        print(json.dumps({ptype: pins}, ensure_ascii=False, indent=2))
        return

    # 全量下载
    out_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "references", "common", "pins-auto.json",
    )
    if "--out" in args:
        out_path = args[args.index("--out") + 1]

    result = {}
    for f in ELEMENT_FILES:
        fname = f.split("/")[-1]
        print(f"  处理 {fname} ...")
        try:
            source = fetch(RAW_BASE + fname)
            ptype = extract_type(source)
            pins = extract_pins(source)
            if ptype and pins:
                result[ptype] = pins
        except Exception as e:
            print(f"  ⚠️ {fname} 失败: {e}")

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print(f"\n完成！输出 {len(result)} 个元件的引脚坐标到 {out_path}")


if __name__ == "__main__":
    main()
