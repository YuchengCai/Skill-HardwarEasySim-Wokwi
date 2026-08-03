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
    if command -v arduino-cli &>/dev/null; then
        info "arduino-cli 已安装"
        return 0
    fi

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
        arduino-cli config init >/dev/null 2>&1 || true
        info "arduino-cli 安装成功"
    else
        error "arduino-cli 安装失败"
    fi
}

# ==============================================================
# 安装 Uno 核心（如缺失）
# ==============================================================
ensure_uno_core() {
    if arduino-cli core list 2>/dev/null | grep -q "arduino:avr"; then
        info "arduino:avr 核心已安装"
        return 0
    fi

    section "安装 Arduino Uno 核心"
    arduino-cli core update-index >/dev/null 2>&1
    arduino-cli core install arduino:avr
    info "arduino:avr 核心安装完成"
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

    section "编译 $PROJECT_NAME"
    arduino-cli compile \
        --fqbn arduino:avr:uno \
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
    ensure_uno_core
    compile_project

    # 如果指定了端口和 FQBN，直接上传
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
ensure_uno_core
compile_project

section "完成"
echo "  项目: $PROJECT_DIR"
echo "  下一步: 在 VS Code 中打开项目，F1 → Wokwi: Start Simulation"
echo "  模拟确认后，运行: $0 $PROJECT_DIR --upload"
