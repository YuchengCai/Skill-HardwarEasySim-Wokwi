#!/usr/bin/env bash
# ==============================================================
# install.sh — Arduino Wokwi Skill 安装脚本 (v0.3.2)
#
# 自动检测当前 AI 编程 Agent 类型并安装对应适配器。
#
# 用法:
#   ./install.sh                    # 自动检测并安装
#   ./install.sh --dir <path>       # 安装到指定项目目录
#   ./install.sh --agent <type>     # 强制指定 Agent 类型
#
# 支持的 Agent 类型:
#   deepcode   — DeepCode (安装 SKILL.md 到 .agents/skills/)
#   claude     — Claude Code (安装 CLAUDE.md 到项目根目录)
#   cursor     — Cursor (安装 .cursorrules 到项目根目录)
#   workbuddy  — WorkBuddy (安装 SKILL.md 到 ~/.workbuddy/skills/)
#
# 可选参数:
#   --dry-run  — 仅显示将要执行的操作，不实际安装
#   --help     — 显示帮助信息
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

# --- 检测 install.sh 自身位置 ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_NAME="wokwi-arduino"

# --- 默认值 ---
INSTALL_DIR=""
FORCE_AGENT=""
DRY_RUN=false

# --- 解析参数 ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --agent)
            FORCE_AGENT="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --dir <path>       安装到指定项目目录"
            echo "  --agent <type>     强制指定 Agent 类型 (deepcode|claude|cursor)"
            echo "  --dry-run          仅预览，不执行安装"
            echo "  --help, -h         显示此帮助"
            echo ""
            echo "无参数时自动检测当前 Agent 类型。"
            exit 0
            ;;
        *)
            error "未知参数: $1 (使用 --help 查看帮助)"
            ;;
    esac
done

# --- 确定目标目录 ---
if [ -z "$INSTALL_DIR" ]; then
    # 如果未指定 --dir，使用当前工作目录
    INSTALL_DIR="$(pwd)"
fi

if [ ! -d "$INSTALL_DIR" ]; then
    error "目标目录不存在: $INSTALL_DIR"
fi

info "目标目录: $INSTALL_DIR"

# --- Agent 类型检测 ---
detect_agent() {
    # 如果用户强制指定了类型，直接使用
    if [ -n "$FORCE_AGENT" ]; then
        echo "$FORCE_AGENT"
        return
    fi

    # 检测 DeepCode
    if [ -n "${DEEPCODE:-}" ] || [ -n "${DEEPCODE_SESSION:-}" ]; then
        echo "deepcode"
        return
    fi

    # 检测 Claude Code
    if [ -n "${CLAUDE_CODE:-}" ]; then
        echo "claude"
        return
    fi

    # 检测 Cursor
    if [ -n "${CURSOR:-}" ]; then
        echo "cursor"
        return
    fi

    # 检测 WorkBuddy
    if [ -d "$HOME/.workbuddy" ]; then
        warn "检测到 ~/.workbuddy，推断为 WorkBuddy"
        echo "workbuddy"
        return
    fi

    # 检测工作目录中已有的配置文件
    if [ -f "$INSTALL_DIR/.cursorrules" ]; then
        warn "检测到已有 .cursorrules，推断为 Cursor"
        echo "cursor"
        return
    fi
    if [ -f "$INSTALL_DIR/CLAUDE.md" ]; then
        warn "检测到已有 CLAUDE.md，推断为 Claude Code"
        echo "claude"
        return
    fi
    if [ -d "$INSTALL_DIR/.agents" ]; then
        warn "检测到已有 .agents 目录，推断为 DeepCode"
        echo "deepcode"
        return
    fi

    # 无法自动检测
    echo ""
}

section "检测 AI Agent 类型"

AGENT_TYPE=$(detect_agent)

if [ -z "$AGENT_TYPE" ]; then
    echo "无法自动检测当前 AI Agent 类型。"
    echo ""
    echo "请选择:"
    echo "  1) DeepCode"
    echo "  2) Claude Code"
    echo "  3) Cursor"
    echo "  4) WorkBuddy"
    echo ""
    read -rp "输入数字 (1/2/3/4): " choice
    case "$choice" in
        1) AGENT_TYPE="deepcode" ;;
        2) AGENT_TYPE="claude" ;;
        3) AGENT_TYPE="cursor" ;;
        4) AGENT_TYPE="workbuddy" ;;
        *) error "无效选择" ;;
    esac
fi

info "检测到 Agent 类型: $AGENT_TYPE"

# --- 安装函数 ---
install_deepcode() {
    local target_dir="$INSTALL_DIR/.agents/skills/$SKILL_NAME"
    local adapter_path="$SCRIPT_DIR/adapters/deepcode/SKILL.md"

    section "安装到 DeepCode (.agents/skills/)"

    if $DRY_RUN; then
        echo "  将创建: $target_dir/"
        echo "  将复制: $adapter_path → $target_dir/SKILL.md"
        echo "  将创建符号链接: $target_dir/core → $SCRIPT_DIR/core"
        return
    fi

    mkdir -p "$target_dir"
    cp "$adapter_path" "$target_dir/SKILL.md"

    # 链接 core/ 目录，这样模板更新会同步
    if [ -L "$target_dir/core" ] || [ -d "$target_dir/core" ]; then
        warn "core/ 已存在，跳过链接"
    else
        ln -s "$SCRIPT_DIR/core" "$target_dir/core"
    fi

    info "已安装到 $target_dir"
    echo ""
    echo "  SKILL.md → $target_dir/SKILL.md"
    echo "  core/    → $target_dir/core (符号链接)"
    echo ""
    echo "下次 DeepCode 会话将自动加载此 Skill。"
    echo "如果 DeepCode 已在运行，请重启以生效。"
}

install_claude() {
    local target_file="$INSTALL_DIR/CLAUDE.md"
    local adapter_path="$SCRIPT_DIR/adapters/claude/CLAUDE.md"

    section "安装到 Claude Code (CLAUDE.md)"

    if $DRY_RUN; then
        echo "  将追加到: $target_file"
        return
    fi

    if [ -f "$target_file" ]; then
        warn "CLAUDE.md 已存在，将追加内容"
        echo "" >> "$target_file"
        echo "---" >> "$target_file"
        echo "" >> "$target_file"
        cat "$adapter_path" >> "$target_file"
        info "已追加到 $target_file"
    else
        cp "$adapter_path" "$target_file"
        info "已创建 $target_file"
    fi

    echo ""
    echo "Claude Code 将自动读取项目根目录的 CLAUDE.md。"
}

install_cursor() {
    local target_file="$INSTALL_DIR/.cursorrules"
    local adapter_path="$SCRIPT_DIR/adapters/cursor/.cursorrules"

    section "安装到 Cursor (.cursorrules)"

    if $DRY_RUN; then
        echo "  将追加到: $target_file"
        return
    fi

    if [ -f "$target_file" ]; then
        warn ".cursorrules 已存在，将追加内容"
        echo "" >> "$target_file"
        echo "# --- wokwi-arduino skill ---" >> "$target_file"
        cat "$adapter_path" >> "$target_file"
        info "已追加到 $target_file"
    else
        cp "$adapter_path" "$target_file"
        info "已创建 $target_file"
    fi

    echo ""
    echo "Cursor 将自动读取项目根目录的 .cursorrules。"
}

install_workbuddy() {
    local target_dir="$HOME/.workbuddy/skills/$SKILL_NAME"
    local adapter_path="$SCRIPT_DIR/adapters/workbuddy/SKILL.md"

    section "安装到 WorkBuddy (~/.workbuddy/skills/)"

    if $DRY_RUN; then
        echo "  将创建: $target_dir/"
        echo "  将复制: $adapter_path → $target_dir/SKILL.md"
        echo "  将复制: $SCRIPT_DIR/core → $target_dir/core"
        return
    fi

    mkdir -p "$target_dir"
    cp "$adapter_path" "$target_dir/SKILL.md"
    cp -r "$SCRIPT_DIR/core" "$target_dir/core"

    info "已安装到 $target_dir"
    echo ""
    echo "  SKILL.md → $target_dir/SKILL.md"
    echo "  core/    → $target_dir/core"
    echo ""
    echo "注意: 首次使用前需配置 Playwright MCP (见 SKILL.md)"
    echo "重启 WorkBuddy 会话后生效。"
}

# --- 执行安装 ---
case "$AGENT_TYPE" in
    deepcode) install_deepcode ;;
    claude)   install_claude ;;
    cursor)   install_cursor ;;
    workbuddy) install_workbuddy ;;
    *)        error "不支持的 Agent 类型: $AGENT_TYPE" ;;
esac

# --- 安装后说明 ---
section "安装完成"

echo "Arduino Wokwi Skill ($SKILL_NAME) 已准备就绪！"
echo ""
echo "下次对话时，你可以通过以下方式激活此 Skill:"
echo ""
echo "  - 提及关键词: arduino, wokwi, uno, 单片机"
echo "  - 手动触发:   @wokwi, #wokwi 等标记"
echo "  - 文件检测:   项目中包含 .ino / wokwi.toml / diagram.json"
echo ""
echo "编译项目:"
echo "  ./core/scripts/compile.sh <项目目录>"
