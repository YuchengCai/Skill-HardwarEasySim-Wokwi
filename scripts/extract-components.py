#!/usr/bin/env python3
"""
extract-components.py — 从 wokwi-elements 仓库提取元件索引

功能：
  1. 获取 wokwi-elements 的所有元件源码文件列表
  2. 对每个元件提取：type 名（@customElement）+ 引脚（pinInfo）+ 源码文件名
  3. 生成：
     - index.json         精简索引（常驻查询）
     - detail/<type>.json 详细条目（按需加载，当前为骨架，后续可补属性/示例）

用法：
  python3 extract-components.py [--out <输出目录>]

输出目录默认：<脚本同目录>/../references/arduino/
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

# 硬编码元件文件列表（wokwi-elements src/ 下的 *-element.ts）
# 来源：wokwi-elements 仓库 v1.9.x 的文件清单
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


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "wokwi-extractor"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def get_element_files() -> list[str]:
    """返回硬编码的元件文件列表"""
    return [f for f in ELEMENT_FILES]


def extract_component(source: str, fname: str) -> dict:
    """从源码提取 type + pins"""
    # type 名：@customElement('wokwi-xxx')
    m = re.search(r"@customElement\('([^']+)'\)", source)
    ptype = m.group(1) if m else f"wokwi-{fname[:-len('-element.ts')]}"

    # 引脚：全局匹配 { name: 'XXX', ... }（pinInfo 数组中的定义）
    pins = []
    for pm in re.finditer(r"\{\s*name:\s*'([^']+)'", source):
        if pm.group(1) not in pins:
            pins.append(pm.group(1))

    return {
        "type": ptype,
        "file": fname,
        "pins": pins,
        "zh": [],          # 中文名/别名（待填）
        "verified": False, # 是否已实际验证
    }


def main():
    out_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "references", "uno",
    )
    if "--out" in sys.argv:
        out_dir = sys.argv[sys.argv.index("--out") + 1]

    detail_dir = os.path.join(out_dir, "detail")
    os.makedirs(detail_dir, exist_ok=True)

    print("获取元件文件列表...")
    files = get_element_files()
    print(f"发现 {len(files)} 个元件文件")

    index = []
    for f in files:
        fname = f.split("/")[-1]
        print(f"  处理 {fname} ...")
        try:
            source = fetch(RAW_BASE + fname)
            comp = extract_component(source, fname)
            index.append(comp)
            # 写 detail 骨架
            with open(os.path.join(detail_dir, f"{comp['type']}.json"), "w", encoding="utf-8") as fh:
                json.dump(comp, fh, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"  ⚠️ {fname} 失败: {e}")

    # 写 index.json
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2)

    print(f"\n完成！生成:")
    print(f"  index.json        ({len(index)} 个元件)")
    print(f"  detail/*.json     ({len(index)} 个文件)")


if __name__ == "__main__":
    main()
