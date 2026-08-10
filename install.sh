#!/usr/bin/env bash
# ==============================================================
# install.sh — Arduino Wokwi Skill 安装脚本 (v0.4.3)
#
# 自动检测当前 AI 编程 Agent 类型并安装对应适配器。
#
# 用法:
#   ./install.sh                    # 自动检测 + 交互选择安装范围
#   ./install.sh --global           # 全局安装（所有项目可用）
#   ./install.sh --project          # 仅当前项目安装
#   ./install.sh --dir <path>       # 安装到指定项目目录
#   ./install.sh --agent <type>     # 强制指定 Agent 类型
#
# 支持的 Agent 类型:
#   deepcode   — DeepCode (SKILL.md)
#   claude     — Claude Code (CLAUDE.md)
#   cursor     — Cursor (.cursorrules)
#   workbuddy  — WorkBuddy (SKILL.md)
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
INSTALL_SCOPE=""   # "global" 或 "project"，空 = 交互询问

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
        --global)
            INSTALL_SCOPE="global"
            shift
            ;;
        --project)
            INSTALL_SCOPE="project"
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --global          全局安装（所有项目可用）"
            echo "  --project         仅当前项目安装"
            echo "  --dir <path>      安装到指定项目目录"
            echo "  --agent <type>    强制指定 Agent 类型 (deepcode|claude|cursor|workbuddy)"
            echo "  --dry-run         仅预览，不执行安装"
            echo "  --help, -h        显示此帮助"
            echo ""
            echo "无参数时自动检测 Agent 类型，并询问安装范围。"
            exit 0
            ;;
        *)
            error "未知参数: $1 (使用 --help 查看帮助)"
            ;;
    esac
done

# --- Agent 类型检测 ---
detect_agent() {
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
    local cwd_guess="$(pwd)"
    if [ -f "$cwd_guess/.cursorrules" ]; then
        warn "检测到已有 .cursorrules，推断为 Cursor"
        echo "cursor"
        return
    fi
    if [ -f "$cwd_guess/CLAUDE.md" ]; then
        warn "检测到已有 CLAUDE.md，推断为 Claude Code"
        echo "claude"
        return
    fi
    if [ -d "$cwd_guess/.agents" ]; then
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

# ==============================================================
# 安装范围选择（全局 vs 项目）
# ==============================================================
choose_scope() {
    # WorkBuddy 本身安装到 ~/.workbuddy/skills/（天然全局），无需询问
    if [ "$AGENT_TYPE" = "workbuddy" ]; then
        INSTALL_SCOPE="global"
        info "WorkBuddy 安装位置固定在用户目录（全局），无需选择"
        return
    fi

    if [ -n "$INSTALL_SCOPE" ]; then
        return  # 已通过 --global/--project 指定
    fi

    # 非交互环境（如 agent 自动调用、无终端输入）→ 默认全局，避免卡住
    if [ ! -t 0 ]; then
        INSTALL_SCOPE="global"
        warn "检测到非交互环境，默认使用全局安装"
        warn "如需项目安装，请使用参数: ./install.sh --project"
        return
    fi

    echo ""
    echo "选择安装范围:"
    echo ""
    echo "  1) 全局安装 — 所有项目都能使用此 Skill"
    echo "     适合长期使用、经常做硬件项目；安装一次，处处可用"
    echo ""
    echo "  2) 仅当前项目 — 只在当前目录生效"
    echo "     适合临时试用、不想影响其他项目；更轻量"
    echo ""
    read -rp "输入数字 (1/2): " choice
    case "$choice" in
        1) INSTALL_SCOPE="global" ;;
        2) INSTALL_SCOPE="project" ;;
        *) error "无效选择" ;;
    esac
}

choose_scope

# --- 根据安装范围确定目标位置 ---
if [ "$INSTALL_SCOPE" = "global" ]; then
    case "$AGENT_TYPE" in
        deepcode)  INSTALL_DIR="$HOME/.deepcode/skills" ;;
        claude)    INSTALL_DIR="$HOME/.claude" ;;
        cursor)    INSTALL_DIR="$HOME/.cursor" ;;
        workbuddy) INSTALL_DIR="$HOME/.workbuddy/skills" ;;
    esac
    info "安装范围: 全局 (所有项目可用)"
else
    if [ -z "$INSTALL_DIR" ]; then
        INSTALL_DIR="$(pwd)"
    fi
    info "安装范围: 仅当前项目 ($INSTALL_DIR)"
fi

if [ ! -d "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR"
fi

# ==============================================================
# 安装函数
# ==============================================================
install_deepcode() {
    local target_dir
    if [ "$INSTALL_SCOPE" = "global" ]; then
        target_dir="$HOME/.deepcode/skills/$SKILL_NAME"
    else
        target_dir="$INSTALL_DIR/.agents/skills/$SKILL_NAME"
    fi
    local adapter_path="$SCRIPT_DIR/adapters/deepcode/SKILL.md"

    section "安装到 DeepCode ($target_dir)"

    if $DRY_RUN; then
        echo "  将创建: $target_dir/"
        echo "  将复制: $adapter_path → $target_dir/SKILL.md"
        echo "  将创建符号链接: $target_dir/scripts → $SCRIPT_DIR/scripts"
        echo "  将创建符号链接: $target_dir/references → $SCRIPT_DIR/references"
        return
    fi

    mkdir -p "$target_dir"
    cp "$adapter_path" "$target_dir/SKILL.md"

    # 链接 scripts/ + references/ 目录，这样模板更新会同步
    for SUB in scripts references; do
        if [ -L "$target_dir/$SUB" ] || [ -d "$target_dir/$SUB" ]; then
            warn "$SUB/ 已存在，跳过链接"
        else
            ln -s "$SCRIPT_DIR/$SUB" "$target_dir/$SUB"
        fi
    done

    info "已安装到 $target_dir"
    echo ""
    echo "  SKILL.md    → $target_dir/SKILL.md"
    echo "  scripts/    → $target_dir/scripts (符号链接)"
    echo "  references/ → $target_dir/references (符号链接)"
    echo ""
    if [ "$INSTALL_SCOPE" = "global" ]; then
        echo "全局安装：所有 DeepCode 项目都会自动加载此 Skill。"
    else
        echo "项目安装：仅当前项目会加载此 Skill。"
    fi
    echo "如果 DeepCode 已在运行，请重启以生效。"
}

install_claude() {
    local target_file
    if [ "$INSTALL_SCOPE" = "global" ]; then
        target_file="$HOME/.claude/CLAUDE.md"
    else
        target_file="$INSTALL_DIR/CLAUDE.md"
    fi
    local adapter_path="$SCRIPT_DIR/adapters/claude/CLAUDE.md"

    section "安装到 Claude Code ($target_file)"

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
    if [ "$INSTALL_SCOPE" = "global" ]; then
        echo "全局安装：所有 Claude Code 项目都会自动读取。"
    else
        echo "项目安装：Claude Code 将自动读取项目根目录的 CLAUDE.md。"
    fi
}

install_cursor() {
    local target_file
    if [ "$INSTALL_SCOPE" = "global" ]; then
        target_file="$HOME/.cursor/rules/.cursorrules"
    else
        target_file="$INSTALL_DIR/.cursorrules"
    fi
    local adapter_path="$SCRIPT_DIR/adapters/cursor/.cursorrules"

    section "安装到 Cursor ($target_file)"

    if $DRY_RUN; then
        echo "  将追加到: $target_file"
        return
    fi

    mkdir -p "$(dirname "$target_file")"
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
    if [ "$INSTALL_SCOPE" = "global" ]; then
        echo "全局安装：所有 Cursor 项目都会自动读取（需要 Cursor 0.46+ 支持全局规则）。"
    else
        echo "项目安装：Cursor 将自动读取项目根目录的 .cursorrules。"
    fi
}

install_workbuddy() {
    local target_dir="$HOME/.workbuddy/skills/$SKILL_NAME"
    local adapter_path="$SCRIPT_DIR/adapters/workbuddy/SKILL.md"

    section "安装到 WorkBuddy (~/.workbuddy/skills/)"

    if $DRY_RUN; then
        echo "  将创建: $target_dir/"
        echo "  将复制: $adapter_path → $target_dir/SKILL.md"
        echo "  将复制: $SCRIPT_DIR/scripts → $target_dir/scripts"
        echo "  将复制: $SCRIPT_DIR/references → $target_dir/references"
        return
    fi

    mkdir -p "$target_dir"
    cp "$adapter_path" "$target_dir/SKILL.md"
    cp -r "$SCRIPT_DIR/scripts" "$target_dir/scripts"
    cp -r "$SCRIPT_DIR/references" "$target_dir/references"

    info "已安装到 $target_dir"
    echo ""
    echo "  SKILL.md    → $target_dir/SKILL.md"
    echo "  scripts/    → $target_dir/scripts"
    echo "  references/ → $target_dir/references"
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
echo "  ./scripts/compile.sh <项目目录>"
