#!/usr/bin/env bash
# ==============================================================
# compile.sh — Arduino 项目编译与上传脚本 (v0.2.6)
#
# 用法:
#   ./compile.sh <project-dir>                    # 仅编译
#   ./compile.sh <project-dir> --upload           # 编译 + 检测并上传
#   ./compile.sh <project-dir> --upload --port COM3 --fqbn arduino:avr:uno  # 编译 + 指定端口上传
#   ./compile.sh <project-dir> --detect           # 仅检测已连接的板子
#   ./compile.sh <project-dir> --upload --monitor  # 编译 + 上传 + 自动显示串口输出
#
# 功能:
#   - 自动安装 arduino-cli + Uno 核心
#   - 编译 .ino → .hex
#   - 检测已连接的 Arduino 板子
#   - 上传固件到板子
# ==============================================================
set -euo pipefail

# --- 颜色输出 ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
section() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

# --- 参数解析 ---
if [ $# -lt 1 ]; then
    echo "用法: $0 <project-dir> [--upload|--detect] [--port <port>] [--fqbn <fqbn>]"
    exit 1
fi

PROJECT_DIR="$(cd "$1" 2>/dev/null && pwd)" || error "目录不存在: $1"
shift

FLAG_UPLOAD=false
FLAG_DETECT=false
FLAG_MONITOR=false
PORT=""
FQBN=""

while [ $# -gt 0 ]; do
    case "$1" in
        --upload) FLAG_UPLOAD=true ;;
        --detect) FLAG_DETECT=true ;;
        --monitor) FLAG_MONITOR=true ;;
        --port)   PORT="$2"; shift ;;
        --fqbn)   FQBN="$2"; shift ;;
        *) error "未知参数: $1" ;;
    esac
    shift
done

# --- 检测操作系统 ---
detect_os() {
    case "$(uname -s)" in
        Linux*)  echo "linux" ;;
        Darwin*) echo "darwin" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)       echo "unknown" ;;
    esac
}

OS=$(detect_os)
info "操作系统: $OS"

# ==============================================================
# 安装 arduino-cli（如缺失）
# ==============================================================
ensure_arduino_cli() {
    # ① 当前进程 PATH 中查找
    if command -v arduino-cli &>/dev/null; then
        info "arduino-cli 已安装 ($(command -v arduino-cli))"
        return 0
    fi

    # ② 常见安装位置查找（解决"已安装但 PATH 未生效"问题）
    local CANDIDATES=(
        "${HOME}/.arduino-cli/bin/arduino-cli"
        "${HOME}/.arduino15/bin/arduino-cli"
        "${HOME}/bin/arduino-cli"
        "/usr/local/bin/arduino-cli"
        "/opt/homebrew/bin/arduino-cli"
        "/c/tool/arduinoCli/arduino-cli"
        "/d/tool/arduinoCli/arduino-cli"
        "/c/Program Files/Arduino CLI/arduino-cli"
    )
    for CAND in "${CANDIDATES[@]}"; do
        if [ -f "$CAND" ]; then
            info "在 $CAND 找到已安装的 arduino-cli"
            export PATH="$(dirname "$CAND"):${PATH}"
            # Windows 下同步到用户级 PATH，让所有进程可见
            if [ "$OS" = "windows" ]; then
                WIN_PATH=$(cygpath -w "$(dirname "$CAND")" 2>/dev/null)
                cmd //c "setx PATH \"$WIN_PATH;%PATH%\"" >/dev/null 2>&1 && \
                    info "已同步 arduino-cli 到 Windows 用户级 PATH（重启终端/VS Code 后全局生效）"
            fi
            return 0
        fi
    done

    section "安装 arduino-cli"

    local INSTALL_DIR="${HOME}/.arduino-cli"
    local BIN_DIR="${INSTALL_DIR}/bin"

    case "$OS" in
        linux|darwin)
            info "使用官方脚本安装..."
            curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
            if [ -f "$(pwd)/bin/arduino-cli" ]; then
                mkdir -p "$BIN_DIR"
                mv "$(pwd)/bin/arduino-cli" "$BIN_DIR/"
                rm -rf "$(pwd)/bin"
            fi
            ;;
        windows)
            info "下载 arduino-cli (Windows)..."
            mkdir -p "$BIN_DIR"
            curl -fsSL https://github.com/arduino/arduino-cli/releases/latest/download/arduino-cli_latest_Windows_64bit.zip -o /tmp/arduino-cli.zip
            unzip -o /tmp/arduino-cli.zip -d "$BIN_DIR" >/dev/null 2>&1
            rm -f /tmp/arduino-cli.zip
            ;;
        *)
            error "不支持的操作系统: $OS"
            ;;
    esac

    export PATH="${BIN_DIR}:${PATH}"

    if command -v arduino-cli &>/dev/null; then
        local RC_FILE=""
        case "$OS" in
            linux)   RC_FILE="${HOME}/.bashrc" ;;
            darwin)  RC_FILE="${HOME}/.zshrc" ;;
            windows) RC_FILE="${HOME}/.bashrc" ;;
        esac
        if [ -n "$RC_FILE" ] && [ -f "$RC_FILE" ]; then
            if ! grep -q "arduino-cli" "$RC_FILE" 2>/dev/null; then
                echo "export PATH=\"${BIN_DIR}:\$PATH\"" >> "$RC_FILE"
            fi
        fi
        # Windows: 写入用户级 PATH，让所有进程（终端/VS Code/插件）可见
        if [ "$OS" = "windows" ]; then
            WIN_PATH=$(cygpath -w "$BIN_DIR" 2>/dev/null)
            cmd //c "setx PATH \"$WIN_PATH;%PATH%\"" >/dev/null 2>&1 && \
                info "已写入 Windows 用户级 PATH（重启终端/VS Code 后全局生效）"
        fi
        arduino-cli config init >/dev/null 2>&1 || true
        info "arduino-cli 安装成功"
    else
        error "arduino-cli 安装失败"
    fi
}

# ==============================================================
# 安装核心（如缺失，按 FQBN 的 vendor 自动安装）
# ==============================================================
ensure_core() {
    local FQBN_ARG="$1"
    local CORE_VENDOR="arduino:avr"
    local EXTRA_URL=""
    case "$FQBN_ARG" in
        esp32:*|arduino:esp32:*)
            CORE_VENDOR="esp32:esp32"
            # 国内镜像（乐鑫官方中国源，避免 GitHub 下载超时）
            EXTRA_URL="https://espressif.github.io/arduino-esp32/package_esp32_dev_index_cn.json"
            ;;
    esac

    if arduino-cli core list 2>/dev/null | grep -q "${CORE_VENDOR%%:*}"; then
        info "核心 ${CORE_VENDOR%%:*} 已安装"
        return 0
    fi

    section "安装核心 ${CORE_VENDOR}"
    if [ -n "$EXTRA_URL" ]; then
        # 配置国内镜像（幂等，重复添加会被 arduino-cli 去重）
        arduino-cli config add board_manager.additional_urls "$EXTRA_URL" >/dev/null 2>&1 || true
    fi
    arduino-cli core update-index >/dev/null 2>&1
    arduino-cli core install "$CORE_VENDOR"
    info "核心 ${CORE_VENDOR} 安装完成"
}

# ==============================================================
# 路径归一化（MINGW → Windows 路径，修复 f:\f\ 双写问题）
# ==============================================================
normalize_path() {
    local PATH_ARG="$1"
    case "$OS" in
        windows)
            if command -v cygpath &>/dev/null; then
                cygpath -w "$PATH_ARG"
            else
                echo "$PATH_ARG"
            fi
            ;;
        *)
            echo "$PATH_ARG"
            ;;
    esac
}

# ==============================================================
# 从 diagram.json 推断板型 FQBN
# ==============================================================
infer_fqbn() {
    local DIAGRAM="$PROJECT_DIR/diagram.json"
    local BOARD_TYPE=""
    if [ -f "$DIAGRAM" ]; then
        BOARD_TYPE=$(grep -oE '"type": "wokwi-(arduino|esp32|nano|pico)-[a-z0-9-]+"' "$DIAGRAM" 2>/dev/null | head -1 | sed 's/"type": "//;s/"//')
    fi
    case "$BOARD_TYPE" in
        wokwi-arduino-mega) echo "arduino:avr:mega" ;;
        wokwi-arduino-nano) echo "arduino:avr:nano" ;;
        wokwi-arduino-uno)  echo "arduino:avr:uno" ;;
        wokwi-esp32-devkit-v1) echo "esp32:esp32:esp32" ;;
        "") echo "arduino:avr:uno" ;;
        *)  echo "arduino:avr:uno" ;;   # 未知板型默认 Uno
    esac
}

# ==============================================================
# 编译项目
# ==============================================================
compile_project() {
    INO_FILE=$(find "$PROJECT_DIR" -maxdepth 1 -name "*.ino" | head -1)
    if [ -z "$INO_FILE" ]; then
        error "未找到 .ino 文件"
    fi

    PROJECT_NAME=$(basename "$INO_FILE" .ino)
    BUILD_DIR="$PROJECT_DIR/build"
    mkdir -p "$BUILD_DIR"

    # 转换为 Windows 路径（MINGW 环境下 arduino-cli 需要）
    INO_FILE_WIN=$(normalize_path "$INO_FILE")
    BUILD_DIR_WIN=$(normalize_path "$BUILD_DIR")

    # FQBN: 优先用 --fqbn 参数，否则从 diagram.json 自动推断
    if [ -z "$FQBN" ]; then
        FQBN=$(infer_fqbn)
        info "自动推断 FQBN: $FQBN"
    fi

    section "编译 $PROJECT_NAME"
    arduino-cli compile \
        --fqbn "$FQBN" \
        --output-dir "$BUILD_DIR_WIN" \
        "$INO_FILE_WIN"

    info "编译成功！"

    # 更新 wokwi.toml
    WOKWI_TOML="$PROJECT_DIR/wokwi.toml"
    if [ -f "$WOKWI_TOML" ]; then
        if grep -q "^firmware" "$WOKWI_TOML"; then
            sed -i "s|^firmware.*|firmware = 'build/${PROJECT_NAME}.ino.hex'|" "$WOKWI_TOML"
        fi
    fi

    echo "  .hex: $BUILD_DIR/${PROJECT_NAME}.ino.hex"
}

# ==============================================================
# VID/PID → 常见克隆板提示（解决 CH340 等板型 Unknown 问题）
# ==============================================================
# 平台检测方式:
#   Windows: PowerShell 查询 PnP 设备 VID/PID
#   macOS:   system_profiler SPUSBDataType
#   Linux:   lsusb
# 匹配表:
#   1A86:7523  CH340  → Uno/克隆板 (FQBN: arduino:avr:uno)
#   1A86:5523  CH341  → Uno/克隆板 (FQBN: arduino:avr:uno)
#   10C4:EA60  CP2102 → 通用串口（可能是板子，需用户确认）
#   0403:6001  FTDI   → 通用串口（可能是板子，需用户确认）
# ==============================================================
detect_ch340() {
    local PORT_ARG="$1"

    case "$OS" in
        windows)
            local VIDPID
            VIDPID=$(powershell -Command "
                \$com = '$PORT_ARG'
                Get-CimInstance Win32_PnPEntity | Where-Object {
                    \$_.Name -like \"*(\$com)\" -and \$_.DeviceID -like 'USB\*'
                } | ForEach-Object { \$_.DeviceID }
            " 2>/dev/null | head -1 || true)

            if [ -z "$VIDPID" ]; then
                return 1
            fi

            # 提取 VID/PID (格式: USB\VID_1A86&PID_7523\...)
            local VID PID
            VID=$(echo "$VIDPID" | grep -o "VID_[0-9A-Fa-f]*" | head -1 | tr 'a-f' 'A-F')
            PID=$(echo "$VIDPID" | grep -o "PID_[0-9A-Fa-f]*" | head -1 | tr 'a-f' 'A-F')

            case "$VID:$PID" in
                VID_1A86:PID_7523|VID_1A86:PID_5523) echo "CH340" ;;
                VID_10C4:PID_EA60) echo "CP2102" ;;
                VID_0403:PID_6001) echo "FTDI" ;;
                *) echo "UNKNOWN" ;;
            esac
            ;;

        darwin)
            # macOS: system_profiler 按设备名匹配
            local USBINFO
            USBINFO=$(system_profiler SPUSBDataType 2>/dev/null)
            if echo "$USBINFO" | grep -qi "CH340\|CH341"; then
                echo "CH340"
            elif echo "$USBINFO" | grep -qi "CP210"; then
                echo "CP2102"
            elif echo "$USBINFO" | grep -qi "FTDI\|FT232"; then
                echo "FTDI"
            else
                echo "UNKNOWN"
            fi
            ;;

        linux)
            # Linux: lsusb 按 VID:PID 匹配
            local USBID
            USBID=$(lsusb 2>/dev/null)
            if echo "$USBID" | grep -qi "1a86:7523\|1a86:5523"; then
                echo "CH340"
            elif echo "$USBID" | grep -qi "10c4:ea60"; then
                echo "CP2102"
            elif echo "$USBID" | grep -qi "0403:6001"; then
                echo "FTDI"
            else
                echo "UNKNOWN"
            fi
            ;;

        *)
            return 1
            ;;
    esac
}

# ==============================================================
# 检测已连接的板子
# ==============================================================
detect_boards() {
    section "检测 Arduino 板子"
    local OUTPUT
    OUTPUT=$(arduino-cli board list 2>&1)

    if echo "$OUTPUT" | grep -q "No boards"; then
        echo ""
        echo "❌ 未检测到 Arduino 板子"
        echo "请确认 USB 已连接，且板子已通电。"
        return 1
    fi

    echo "$OUTPUT"
    echo ""

    # 检查是否有 Unknown 板型（CH340 等克隆板常见）
    local UNKNOWN_PORTS
    UNKNOWN_PORTS=$(echo "$OUTPUT" | grep "Unknown" | grep -oE "COM[0-9]+|/dev/[a-zA-Z0-9]+" | head -5)

    if [ -n "$UNKNOWN_PORTS" ]; then
        for P in $UNKNOWN_PORTS; do
            local CHIP
            CHIP=$(detect_ch340 "$P" || true)
            case "$CHIP" in
                CH340|CH341)
                    echo "🔍 $P: 检测到 CH340 芯片（通用 USB 转串口，常见于 Arduino Uno 克隆板）"
                    echo "   建议 FQBN: arduino:avr:uno（上传时使用 --fqbn arduino:avr:uno）"
                    echo ""
                    ;;
                CP2102)
                    echo "🔍 $P: 检测到 CP2102 芯片（通用串口，可能是板子，请确认板型）"
                    echo ""
                    ;;
                FTDI)
                    echo "🔍 $P: 检测到 FTDI 芯片（通用串口，可能是板子，请确认板型）"
                    echo ""
                    ;;
                *)
                    echo "🔍 $P: 板型未识别（可能为克隆板），上传时请手动指定 FQBN，例如:"
                    echo "   --fqbn arduino:avr:uno（Uno 克隆板）"
                    echo ""
                    ;;
            esac
        done
    fi

    # 统计板子数量（排除表头行）
    local COUNT
    COUNT=$(echo "$OUTPUT" | grep -v "^Port" | grep -c "serial" 2>/dev/null || echo "$OUTPUT" | grep -v "^Port" | grep -cE "COM|/dev/" 2>/dev/null || echo "1")

    return 0
}

# ==============================================================
# 上传固件
# ==============================================================
upload_firmware() {
    local PORT_ARG="$1"
    local FQBN_ARG="$2"

    INO_FILE=$(find "$PROJECT_DIR" -maxdepth 1 -name "*.ino" | head -1)
    PROJECT_NAME=$(basename "$INO_FILE" .ino)

    # 转换为 Windows 路径（MINGW 环境下 arduino-cli 需要）
    INO_FILE_WIN=$(normalize_path "$INO_FILE")

    section "上传固件到 $PORT_ARG ($FQBN_ARG)"

    arduino-cli upload \
        -p "$PORT_ARG" \
        --fqbn "$FQBN_ARG" \
        "$INO_FILE_WIN"

    info "上传成功！"
    echo "板载 LED 应该会闪烁 3 次（如果代码中包含此逻辑）。"
}

# ==============================================================
# 串口输出捕获（将串口数据显示在 DeepCode 对话中）
# ==============================================================
monitor_serial() {
    local PORT_ARG="$1"
    local CLI_PATH
    CLI_PATH=$(command -v arduino-cli 2>/dev/null || echo "arduino-cli")

    section "串口输出（捕获 6 秒）"

    case "$OS" in
        windows)
            powershell -Command "
                try {
                    \$port = New-Object System.IO.Ports.SerialPort '$PORT_ARG',9600,None,8,One
                    \$port.Open()
                    \$port.ReadTimeout = 6000
                    Start-Sleep 1
                    \$data = \$port.ReadExisting()
                    Start-Sleep 4
                    \$data += \$port.ReadExisting()
                    Write-Host \$data
                    if (\$port.IsOpen) { \$port.Close() }
                } catch {
                    Write-Host \"读取串口失败: $_\"
                }
            " 2>&1
            ;;
        *)
            echo "自动串口读取仅支持 Windows (PowerShell SerialPort)"
            echo "请手动运行: $CLI_PATH monitor -p $PORT_ARG"
            ;;
    esac
    echo ""
    echo "── 实时查看 ─────────────────────────────"
    echo "在 VS Code 终端运行以下命令可实时查看串口："
    echo "  $CLI_PATH monitor -p $PORT_ARG"
    echo "──────────────────────────────────────────"
    echo ""
    echo "--- 如需在对话中再抓一次，告诉我 \"再抓一次串口\" ---"
}

# ==============================================================
# 主流程
# ==============================================================

# --detect 模式：只检测板子
if $FLAG_DETECT; then
    ensure_arduino_cli
    detect_boards
    exit 0
fi

# --upload 模式：编译 + 上传
if $FLAG_UPLOAD; then
    ensure_arduino_cli
    if [ -z "$FQBN" ]; then FQBN=$(infer_fqbn); info "自动推断 FQBN: $FQBN"; fi
    ensure_core "$FQBN"
    compile_project

    # 如果指定了端口和 FQBN，直接上传
    # FQBN 未指定时自动从 diagram.json 推断（compile_project 已设置）
    if [ -z "$FQBN" ]; then
        FQBN=$(infer_fqbn)
        info "自动推断 FQBN: $FQBN"
    fi
    if [ -n "$PORT" ] && [ -n "$FQBN" ]; then
        upload_firmware "$PORT" "$FQBN"
        # 上传后自动显示串口输出
        if $FLAG_MONITOR; then
            monitor_serial "$PORT"
        fi
    else
        # 检测板子
        echo ""
        echo "检测已连接的 Arduino 板子..."
        echo "可用命令查看: arduino-cli board list"
        echo "上传命令: arduino-cli upload -p <PORT> --fqbn <FQBN> $PROJECT_DIR"
    fi

    exit 0
fi

# 默认模式：仅编译
ensure_arduino_cli
if [ -z "$FQBN" ]; then FQBN=$(infer_fqbn); info "自动推断 FQBN: $FQBN"; fi
ensure_core "$FQBN"
compile_project

section "完成"
echo "  项目: $PROJECT_DIR"
echo "  下一步: 在 VS Code 中打开项目，F1 → Wokwi: Start Simulation"
echo "  模拟确认后，运行: $0 $PROJECT_DIR --upload"
