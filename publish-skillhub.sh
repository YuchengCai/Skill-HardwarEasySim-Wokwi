#!/usr/bin/env bash
# ==============================================================
# publish-skillhub.sh — 一键发布/更新 wokwi-arduino skill 到 SkillHub
# ==============================================================
# 用法:
#   ./publish-skillhub.sh                        # 仅 dry-run 预检
#   ./publish-skillhub.sh --release "变更说明"     # 正式发布/更新
#   ./publish-skillhub.sh -o <输出目录>           # 指定输出位置
#   ./publish-skillhub.sh --slug <slug>          # 覆盖 slug
#
# 前置条件:
#   - skillhub CLI 已安装并登录
#   - 安装: curl -fsSL https://skillhub.cn/install/install.sh | bash -s -- --cli-only
#   - 登录: skillhub login --key <你的API Key> --host https://api.skillhub.cn
# ==============================================================
set -euo pipefail

# --- 配置 ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_NAME="wokwi-arduino"
SLUG="workbuddy-hardwareasysim-wokwi"     # SkillHub 上已有的 slug（更新时保持不变）
DISPLAY_NAME="Wokwi Arduino Simulation"
SUMMARY="Create, compile, simulate and upload Arduino projects with Wokwi"
LICENSE="MIT"
HOMEPAGE="https://github.com/YuchengCai/Skill-HardwarEasySim-Wokwi"
TAGS="[arduino, wokwi, embedded, simulation, hardware]"
SKILLHUB_HOST="https://api.skillhub.cn"

# 发布目录（默认 D 盘工具目录，可 -o 覆盖）
PUBLISH_ROOT="${PUBLISH_ROOT:-D:/tool/skillhub-publish}"
OUT_DIR=""
CHANGELOG=""
DO_RELEASE=false

# --- 颜色输出 ---
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
section() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

# --- 解析参数 ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --release) DO_RELEASE=true; CHANGELOG="$2"; shift 2 ;;
        -o|--output) OUT_DIR="$2"; shift 2 ;;
        --slug) SLUG="$2"; shift 2 ;;
        -h|--help)
            echo "用法: ./publish-skillhub.sh [选项]"
            echo ""
            echo "  --release \"变更说明\"   正式发布/更新（默认仅 dry-run 预检）"
            echo "  -o, --output <目录>    指定输出目录"
            echo "  --slug <slug>         覆盖 slug（默认 $SLUG）"
            echo "  -h, --help            帮助"
            exit 0 ;;
        *) error "未知参数: $1" ;;
    esac
done

# ==============================================================
# 1. 检查 skillhub CLI
# ==============================================================
section "检查 skillhub CLI"
if command -v skillhub &>/dev/null; then
    CLI="skillhub"
elif [ -f "/d/tool/skillhub-cli/skillhub" ]; then
    CLI="/d/tool/skillhub-cli/skillhub"
else
    error "未找到 skillhub CLI。安装: curl -fsSL https://skillhub.cn/install/install.sh | bash -s -- --cli-only"
fi
info "CLI: $CLI"
"$CLI" --version 2>/dev/null | head -1 || error "CLI 不可用"

# ==============================================================
# 2. 检查登录态
# ==============================================================
section "检查登录态"
if ! "$CLI" auth whoami 2>&1 | grep -q "userId"; then
    echo ""
    echo "❌ 未登录 SkillHub。请先执行:"
    echo "   skillhub login --key <你的API Key> --host $SKILLHUB_HOST"
    exit 1
fi
"$CLI" auth whoami 2>&1 | head -3

# ==============================================================
# 3. 提取 WorkBuddy 版（SKILL.md + scripts/ + references/）
# ==============================================================
section "提取 WorkBuddy 版"
if [ -z "$OUT_DIR" ]; then
    OUT_DIR="$PUBLISH_ROOT/$SKILL_NAME"
fi
cd "$SCRIPT_DIR"   # 先切离目标目录，避免占用导致删除失败
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp "$SCRIPT_DIR/adapters/workbuddy/SKILL.md" "$OUT_DIR/SKILL.md"
cp -r "$SCRIPT_DIR/scripts" "$OUT_DIR/scripts"
# 移除开发期脚本（不进运行时包：回归测试 / 一次性数据提取 / 一次性翻译）
rm -f "$OUT_DIR/scripts/run-tests.js" "$OUT_DIR/scripts/extract-components.py" "$OUT_DIR/scripts/fill-zh.py"
cp -r "$SCRIPT_DIR/references" "$OUT_DIR/references"
info "已提取到: $OUT_DIR"
find "$OUT_DIR" -type f | sort

# ==============================================================
# 4. 提取版本号（从 workbuddy/SKILL.md 标题 vX.Y.Z）
# ==============================================================
VERSION=$(grep -oE "v[0-9]+\.[0-9]+\.[0-9]+" "$SCRIPT_DIR/adapters/workbuddy/SKILL.md" | head -1 | tr -d 'v')
if [ -z "$VERSION" ]; then
    error "无法从 SKILL.md 提取版本号"
fi
info "版本号: $VERSION"

# ==============================================================
# 5. 注入 SkillHub frontmatter
# ==============================================================
section "注入 SkillHub frontmatter (slug: $SLUG, version: $VERSION)"
python - "$OUT_DIR/SKILL.md" "$SLUG" "$VERSION" "$DISPLAY_NAME" "$SUMMARY" "$LICENSE" "$HOMEPAGE" "$TAGS" <<'PY'
import sys
path, slug, version, display_name, summary, license_, homepage, tags = sys.argv[1:9]
with open(path, encoding="utf-8") as f:
    content = f.read()

# 定位 frontmatter 结束（第二个 ---）
fm_end = content.index("---", content.index("---") + 3)

extra = (
    f"slug: {slug}\n"
    f"version: \"{version}\"\n"
    f"displayName: {display_name}\n"
    f"summary: {summary}\n"
    f"license: {license_}\n"
    f"homepage: {homepage}\n"
    f"tags: {tags}\n"
)
new_content = content[:fm_end] + extra + content[fm_end:]
with open(path, "w", encoding="utf-8") as f:
    f.write(new_content)
print("frontmatter 注入完成")
PY

# ==============================================================
# 6. dry-run 预检
# ==============================================================
section "dry-run 预检"
DRY_OUTPUT=$("$CLI" publish "$OUT_DIR" --dry-run 2>&1) || true
echo "$DRY_OUTPUT"
if ! echo "$DRY_OUTPUT" | grep -q "Dry-run passed"; then
    error "预检失败，请检查上面的错误"
fi

# ==============================================================
# 7. 正式发布（仅 --release）
# ==============================================================
if $DO_RELEASE; then
    section "正式发布 (slug: $SLUG@$VERSION)"
    if [ -z "$CHANGELOG" ]; then
        CHANGELOG="v$VERSION 更新"
    fi
    "$CLI" publish "$OUT_DIR" --changelog "$CHANGELOG" 2>&1 | tail -5
    info "发布完成！"
else
    echo ""
    info "预检通过。正式发布请执行:"
    echo "  $0 --release \"变更说明\""
fi
