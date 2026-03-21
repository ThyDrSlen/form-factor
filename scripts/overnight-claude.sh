#!/bin/bash
# overnight-claude.sh — Run Claude Code headless overnight on a single prompt
#
# Usage:
#   ./scripts/overnight-claude.sh [prompt-file] [--max-turns N] [--branch-prefix PREFIX]
#
# Examples:
#   ./scripts/overnight-claude.sh prompts/overnight-ux.md
#   ./scripts/overnight-claude.sh prompts/workout-logging.md --max-turns 60
#   ./scripts/overnight-claude.sh prompts/test-coverage.md --branch-prefix "claude/tests"
#
# Default: prompts/overnight-ux.md, 50 turns, branch prefix "claude/overnight"

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

if [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
  echo "Usage: $0 [prompt-file] [--max-turns N] [--branch-prefix PREFIX]"
  echo ""
  echo "Available prompts:"
  ls -1 prompts/*.md 2>/dev/null || echo "  (none)"
  exit 0
fi

PROMPT_FILE="${1:-prompts/overnight-ux.md}"
MAX_TURNS=50
BRANCH_PREFIX="claude/overnight"

shift 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-turns)
      MAX_TURNS="$2"
      shift 2
      ;;
    --branch-prefix)
      BRANCH_PREFIX="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Derive branch name from prompt file
PROMPT_NAME=$(basename "$PROMPT_FILE" .md)
BRANCH="${BRANCH_PREFIX}-${PROMPT_NAME}-$(date +%Y%m%d)"
LOG_DIR="logs/overnight"
LOG_FILE="${LOG_DIR}/claude-${PROMPT_NAME}-$(date +%Y%m%d-%H%M%S).log"

# ─── Validation ──────────────────────────────────────────────────────────────

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Error: Prompt file not found: $PROMPT_FILE"
  echo ""
  echo "Available prompts:"
  ls -1 prompts/*.md 2>/dev/null || echo "  (none found in prompts/)"
  exit 1
fi

# Check claude CLI is available
if ! command -v claude &>/dev/null; then
  echo "Error: 'claude' CLI not found. Install Claude Code first."
  echo "  https://docs.anthropic.com/en/docs/claude-code"
  exit 1
fi

# ─── Setup ───────────────────────────────────────────────────────────────────

mkdir -p "$LOG_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Claude Code Overnight Runner                               ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Prompt:     $PROMPT_FILE"
echo "║  Branch:     $BRANCH"
echo "║  Max turns:  $MAX_TURNS"
echo "║  Log file:   $LOG_FILE"
echo "║  Started:    $(date '+%Y-%m-%d %H:%M:%S')"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Git Setup ───────────────────────────────────────────────────────────────

# Ensure we're on a clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Warning: Working tree has uncommitted changes. Stashing..."
  git stash push -m "overnight-claude-auto-stash-$(date +%Y%m%d-%H%M%S)"
fi

# Create fresh branch from main
CURRENT_BRANCH=$(git branch --show-current)
git checkout main 2>/dev/null || git checkout master 2>/dev/null
git pull origin "$(git branch --show-current)" 2>/dev/null || true
git checkout -b "$BRANCH"

echo "Created branch: $BRANCH (from $(git log --oneline -1))"
echo ""

# ─── Allowed Tools (Security Layer) ─────────────────────────────────────────
#
# Whitelisted tools — Claude can ONLY use these:
#   - Read/Write/Edit/Grep/Glob: full filesystem access
#   - Bash(bun run lint): linting
#   - Bash(bun run check:types): type checking
#   - Bash(bun run test*): test suite
#   - Bash(git add/commit/diff/status): version control
#   - Bash(cat/find/head/tail/wc): read-only file inspection
#
# NOT allowed (critical safety):
#   - No rm, no sudo, no bun install, no network calls
#   - No modifying .env, ios/, android/, supabase/migrations/
#

ALLOWED_TOOLS=(
  "Read"
  "Write"
  "Edit"
  "Grep"
  "Glob"
  "Bash(bun run lint)"
  "Bash(bun run lint:*)"
  "Bash(bun run check:types)"
  "Bash(bun run test)"
  "Bash(bun run test:*)"
  "Bash(git add:*)"
  "Bash(git commit:*)"
  "Bash(git diff:*)"
  "Bash(git status)"
  "Bash(git log:*)"
  "Bash(cat *)"
  "Bash(find *)"
  "Bash(head *)"
  "Bash(tail *)"
  "Bash(wc *)"
)

# Build --allowedTools argument
TOOLS_ARG=""
for tool in "${ALLOWED_TOOLS[@]}"; do
  TOOLS_ARG="$TOOLS_ARG \"$tool\""
done

# ─── Run Claude Code ────────────────────────────────────────────────────────

echo "Starting Claude Code (headless)..."
echo "Monitor progress: tail -f $LOG_FILE"
echo ""

eval claude -p \"\$\(cat \"$PROMPT_FILE\"\)\" \
  --allowedTools $TOOLS_ARG \
  --max-turns "$MAX_TURNS" \
  --output-format json \
  2>&1 | tee "$LOG_FILE"

EXIT_CODE=$?

# ─── Post-Run ───────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Overnight Run Complete                                     ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Exit code:  $EXIT_CODE"
echo "║  Finished:   $(date '+%Y-%m-%d %H:%M:%S')"
echo "║  Branch:     $BRANCH"
echo "║  Log:        $LOG_FILE"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Show what Claude did
echo "── Changes Summary ──────────────────────────────────────────"
git log --oneline main.."$BRANCH" 2>/dev/null || echo "(no commits)"
echo ""
git diff --stat main.."$BRANCH" 2>/dev/null || echo "(no changes)"
echo ""

# Push the branch
if git log --oneline main.."$BRANCH" 2>/dev/null | grep -q .; then
  echo "Pushing branch to origin..."
  git push origin "$BRANCH"
  echo ""
  echo "Create PR:"
  echo "  gh pr create --base main --head $BRANCH \\"
  echo "    --title \"Claude overnight: $PROMPT_NAME\" \\"
  echo "    --body \"Automated improvements from overnight Claude Code session using $PROMPT_FILE\""
else
  echo "No commits were made. Branch not pushed."
fi

exit $EXIT_CODE
