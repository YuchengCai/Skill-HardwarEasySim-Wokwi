#!/usr/bin/env python3
"""fill-zh.py — 为 index.json 填入中文名/别名初稿"""

import json
import os

ZH_MAP = {
    "wokwi-7segment": ["数码管", "7段数码管", "七段数码管"],
    "wokwi-analog-joystick": ["摇杆", "模拟摇杆", "游戏摇杆"],
    "wokwi-arduino-mega": ["Arduino Mega", "Mega2560", "大板"],
    "wokwi-arduino-nano": ["Arduino Nano", "小板"],
    "wokwi-arduino-uno": ["Arduino Uno", "UNO板", "开发板"],
    "wokwi-biaxial-stepper": ["双轴步进电机", "步进电机"],
    "wokwi-big-sound-sensor": ["声音传感器", "声音检测模块"],
    "wokwi-buzzer": ["蜂鸣器", "有源蜂鸣器", "无源蜂鸣器"],
    "wokwi-dht22": ["温湿度传感器", "DHT11", "DHT22", "温湿度模块"],
    "wokwi-dip-switch-8": ["拨码开关", "8位拨码开关", "DIP开关"],
    "wokwi-ds1307": ["实时时钟", "RTC时钟模块", "DS1307"],
    "wokwi-esp32-devkit-v1": ["ESP32开发板", "ESP32 DevKit"],
    "wokwi-flame-sensor": ["火焰传感器", "火焰检测模块"],
    "wokwi-franzininho": ["Franzininho开发板"],
    "wokwi-gas-sensor": ["气体传感器", "烟雾传感器", "MQ系列传感器"],
    "wokwi-hc-sr04": ["超声波测距模块", "超声波模块", "超声波传感器"],
    "wokwi-heart-beat-sensor": ["心率传感器", "心跳传感器"],
    "wokwi-hx711": ["称重传感器", "压力传感器", "HX711模块"],
    "wokwi-ili9341": ["彩色TFT屏", "ILI9341屏幕", "液晶显示屏"],
    "wokwi-ir-receiver": ["红外接收头", "红外接收模块"],
    "wokwi-ir-remote": ["红外遥控器", "遥控器"],
    "wokwi-ks2e-m-dc5": ["继电器", "5V继电器", "继电器模块"],
    "wokwi-ky-040": ["旋转编码器", "旋钮编码器", "编码器"],
    "wokwi-lcd1602": ["LCD1602", "1602液晶屏", "字符液晶屏"],
    "wokwi-lcd2004": ["LCD2004", "2004液晶屏"],
    "wokwi-led-bar-graph": ["LED条形灯", "LED光条", "LED柱"],
    "wokwi-led": ["LED", "发光二极管", "指示灯"],
    "wokwi-led-ring": ["LED环", "LED灯环", "环形LED"],
    "wokwi-membrane-keypad": ["矩阵键盘", "薄膜键盘", "4x4键盘"],
    "wokwi-microsd-card": ["存储卡模块", "MicroSD卡模块", "SD卡模块"],
    "wokwi-mpu6050": ["陀螺仪加速度计", "MPU6050", "姿态传感器"],
    "wokwi-nano-rp2040-connect": ["Raspberry Pi Pico", "RP2040", "树莓派Pico"],
    "wokwi-neopixel": ["可编程LED", "WS2812", "灯带"],
    "wokwi-neopixel-matrix": ["LED点阵屏", "可编程点阵", "WS2812矩阵"],
    "wokwi-ntc-temperature-sensor": ["热敏电阻", "温度传感器", "NTC"],
    "wokwi-photoresistor-sensor": ["光敏电阻", "光线传感器", "光照传感器"],
    "wokwi-pir-motion-sensor": ["人体红外传感器", "PIR", "人体感应模块"],
    "wokwi-potentiometer": ["电位器", "可调电阻", "旋钮"],
    "wokwi-pushbutton-6mm": ["按钮", "轻触开关", "6mm按钮"],
    "wokwi-pushbutton": ["按钮", "按键", "轻触开关"],
    "wokwi-resistor": ["电阻"],
    "wokwi-rgb-led": ["RGB LED", "三色LED", "全彩LED"],
    "wokwi-rotary-dialer": ["旋转拨盘", "拨号盘"],
    "wokwi-servo": ["舵机", "伺服电机"],
    "wokwi-slide-potentiometer": ["滑动变阻器", "滑杆电位器", "滑杆"],
    "wokwi-slide-switch": ["拨动开关", "滑动开关"],
    "wokwi-small-sound-sensor": ["声音传感器", "麦克风模块", "声音检测"],
    "wokwi-ssd1306": ["OLED显示屏", "SSD1306", "OLED屏幕"],
    "wokwi-stepper-motor": ["步进电机"],
    "wokwi-tilt-switch": ["倾斜开关", "倾斜传感器"],
}


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    index_path = os.path.join(script_dir, "..", "references", "uno", "index.json")
    with open(index_path, encoding="utf-8") as f:
        index = json.load(f)

    filled = 0
    for comp in index:
        comp["zh"] = ZH_MAP.get(comp["type"], [])

    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f"已填入 {filled}/50 个元件的中文名")


if __name__ == "__main__":
    main()
