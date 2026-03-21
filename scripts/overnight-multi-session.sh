#!/bin/bash
# overnight-multi-session.sh — Multi-pass Claude Code session with audit → fix → verify
#
# Usage:
#   ./scripts/overnight-multi-session.sh [prompt-file]
#
# Examples:
#   ./scripts/overnight-multi-session.sh prompts/overnight-ux.md
#   ./scripts/overnight-multi-session.sh prompts/offline-hardening.md
#
# This script runs 3 sequential passes:
#   Pass 1 (Audit):  Claude audits the codebase and writes findings to docs/OVERNIGHT_AUDIT.md
#   Pass 2 (Fix):    Claude reads the audit and fixes the top issues
#   Pass 3 (Verify): Claude runs linting, types, tests and writes a changelog
#
# Each pass shares a session ID for context continuity.

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

PROMPT_FILE="${1:-prompts/overnight-ux.md}"
PROMPT_NAME=$(basename "$PROMPT_FILE" .md)
SESSION="$(uuidgen)"
BRANCH="claude/multi-${PROMPT_NAME}-$(date +%Y%m%d-%H%M%S)"
REPO_ROOT=$(pwd)
LOG_DIR="${REPO_ROOT}/logs/overnight"

mkdir -p "$LOG_DIR" docs

# ─── Validation ──────────────────────────────────────────────────────────────

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Error: Prompt file not found: $PROMPT_FILE"
  echo "Available: $(ls prompts/*.md 2>/dev/null | tr '\n' ' ')"
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "Error: 'claude' CLI not found."
  exit 1
fi

# ─── Git Setup ───────────────────────────────────────────────────────────────

if [[ -n "$(git status --porcelain)" ]]; then
  STASH_NAME="overnight-multi-auto-stash-$(date +%Y%m%d-%H%M%S)"
  echo "Stashing uncommitted changes as '$STASH_NAME'. Restore with: git stash pop"
  git stash push -u -m "$STASH_NAME"
fi

git checkout main 2>/dev/null || git checkout master 2>/dev/null
git pull origin "$(git branch --show-current)" 2>/dev/null || true
git checkout -b "$BRANCH"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Claude Code Multi-Session Runner                           ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Prompt:     $PROMPT_FILE"
echo "║  Session:    $SESSION"
echo "║  Branch:     $BRANCH"
echo "║  Started:    $(date '+%Y-%m-%d %H:%M:%S')"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Shared Tool Config ─────────────────────────────────────────────────────

AUDIT_TOOLS=(
  "Read" "Write" "Grep" "Glob"
  "Bash(cat *)" "Bash(find *)" "Bash(head *)" "Bash(tail *)" "Bash(wc *)"
)

FIX_TOOLS=(
  "Read" "Write" "Edit" "Grep" "Glob"
  "Bash(bun run lint)" "Bash(bun run check:types)"
  "Bash(git add:*)" "Bash(git commit:*)" "Bash(git diff:*)" "Bash(git status)"
  "Bash(cat *)" "Bash(find *)" "Bash(head *)" "Bash(tail *)" "Bash(wc *)"
)

VERIFY_TOOLS=(
  "Read" "Write" "Edit" "Grep" "Glob"
  "Bash(bun run lint)" "Bash(bun run check:types)" "Bash(bun run test)"
  "Bash(git add:*)" "Bash(git commit:*)" "Bash(git diff:*)" "Bash(git status)" "Bash(git log:*)"
  "Bash(cat *)" "Bash(find *)" "Bash(head *)" "Bash(tail *)" "Bash(wc *)"
)



# ─── Pass 1: Audit ──────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PASS 1/3: AUDIT (max 15 turns)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

AUDIT_LOG="${LOG_DIR}/pass1-audit-$(date +%Y%m%d-%H%M%S).log"

AUDIT_PROMPT="Read the mission prompt below, then audit the codebase according to its instructions.

Write a detailed audit report to docs/OVERNIGHT_AUDIT.md with:
1. Every issue found, with file path and line number
2. Severity rating (P0/P1/P2/P3)
3. Suggested fix for each issue
4. Estimated effort per fix (small/medium/large)

Sort issues by severity (P0 first). Be thorough — check every relevant file.

--- MISSION PROMPT ---
$(cat "$PROMPT_FILE")
--- END MISSION PROMPT ---"

set +e
claude -p "$AUDIT_PROMPT" \
  --session-id "$SESSION" \
  --allowedTools "${AUDIT_TOOLS[@]}" \
  --max-turns 15 \
  --output-format json \
  2>&1 | tee "$AUDIT_LOG"
PASS1_EXIT=${PIPESTATUS[0]}
set -e

echo ""
if [[ "$PASS1_EXIT" -eq 0 ]]; then
  echo "Pass 1 complete. Audit written to docs/OVERNIGHT_AUDIT.md"
else
  echo "Pass 1 finished with exit code $PASS1_EXIT (audit may be incomplete)"
fi
echo ""

# ─── Pass 2: Fix ────────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PASS 2/3: FIX (max 30 turns)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

FIX_LOG="${LOG_DIR}/pass2-fix-$(date +%Y%m%d-%H%M%S).log"

FIX_PROMPT="Read docs/OVERNIGHT_AUDIT.md that you just created in the previous pass.

Fix the top 10 highest-impact issues (P0 and P1 first).

For each fix:
1. Make the code change
2. Run \`bun run lint\` to verify
3. Run \`bun run check:types\` to verify
4. Commit with a descriptive message: feat(scope): description or fix(scope): description

Work through them one at a time. If a fix would take more than 5 minutes, skip it and note why.
Do NOT modify supabase/ migrations, ios/ or android/ native code, or .env files."

set +e
claude -p "$FIX_PROMPT" \
  --session-id "$SESSION" \
  --allowedTools "${FIX_TOOLS[@]}" \
  --max-turns 30 \
  --output-format json \
  2>&1 | tee "$FIX_LOG"
PASS2_EXIT=${PIPESTATUS[0]}
set -e

echo ""
if [[ "$PASS2_EXIT" -eq 0 ]]; then
  echo "Pass 2 complete."
else
  echo "Pass 2 finished with exit code $PASS2_EXIT (some fixes may have failed)"
fi
echo ""

# ─── Pass 3: Verify ─────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PASS 3/3: VERIFY (max 10 turns)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

VERIFY_LOG="${LOG_DIR}/pass3-verify-$(date +%Y%m%d-%H%M%S).log"

VERIFY_PROMPT="Final verification pass. Run these checks and fix any failures:

1. \`bun run lint\` — fix any lint errors
2. \`bun run check:types\` — fix any type errors
3. \`bun run test\` — fix any test regressions (do NOT delete failing tests)

After all checks pass, write a changelog to docs/OVERNIGHT_CHANGELOG.md with:
- Summary of all changes made
- List of commits (from git log)
- Any issues that were skipped and why
- Recommendations for manual review

Commit the changelog as the final commit."

set +e
claude -p "$VERIFY_PROMPT" \
  --session-id "$SESSION" \
  --allowedTools "${VERIFY_TOOLS[@]}" \
  --max-turns 10 \
  --output-format json \
  2>&1 | tee "$VERIFY_LOG"
PASS3_EXIT=${PIPESTATUS[0]}
set -e

OVERALL_EXIT=0
if [[ "$PASS1_EXIT" -ne 0 ]] || [[ "$PASS2_EXIT" -ne 0 ]] || [[ "$PASS3_EXIT" -ne 0 ]]; then
  OVERALL_EXIT=1
fi

# ─── Post-Run ───────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Multi-Session Run Complete                                 ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Session:    $SESSION"
echo "║  Branch:     $BRANCH"
echo "║  Finished:   $(date '+%Y-%m-%d %H:%M:%S')"
echo "║  Pass 1:     exit $PASS1_EXIT (audit)"
echo "║  Pass 2:     exit $PASS2_EXIT (fix)"
echo "║  Pass 3:     exit $PASS3_EXIT (verify)"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Logs:                                                      ║"
echo "║    Pass 1: $AUDIT_LOG"
echo "║    Pass 2: $FIX_LOG"
echo "║    Pass 3: $VERIFY_LOG"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Show summary
echo "── Commits ────────────────────────────────────────────────────"
git log --oneline main.."$BRANCH" 2>/dev/null || echo "(no commits)"
echo ""
echo "── Stats ──────────────────────────────────────────────────────"
git diff --stat main.."$BRANCH" 2>/dev/null || echo "(no changes)"
echo ""

# Push
if git log --oneline main.."$BRANCH" 2>/dev/null | grep -q .; then
  echo "Pushing branch..."
  git push origin "$BRANCH"
  echo ""
  echo "Create PR:"
  echo "  gh pr create --base main --head $BRANCH \\"
  echo "    --title \"Claude multi-session: $PROMPT_NAME\" \\"
  echo "    --body \"Multi-pass overnight run (audit → fix → verify) using $PROMPT_FILE\""
fi

exit "$OVERALL_EXIT"
