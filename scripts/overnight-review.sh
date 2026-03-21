#!/bin/bash
# overnight-review.sh — Morning review helper for overnight Claude Code runs
#
# Usage:
#   ./scripts/overnight-review.sh                    # Review all overnight branches
#   ./scripts/overnight-review.sh claude/ux-polish   # Review specific branch
#   ./scripts/overnight-review.sh --create-prs       # Auto-create PRs for all branches
#
# Shows: commit log, diff stats, CI status, and optionally creates PRs.

set -euo pipefail

CREATE_PRS=false
SPECIFIC_BRANCH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --create-prs)
      CREATE_PRS=true
      shift
      ;;
    *)
      SPECIFIC_BRANCH="$1"
      shift
      ;;
  esac
done

# ─── Find Overnight Branches ────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Overnight Claude Code — Morning Review                     ║"
echo "║  $(date '+%Y-%m-%d %H:%M:%S')"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

if [[ -n "$SPECIFIC_BRANCH" ]]; then
  BRANCHES=("$SPECIFIC_BRANCH")
else
  # Find all claude/* branches
  mapfile -t BRANCHES < <(git branch -r --list 'origin/claude/*' 2>/dev/null | sed 's|origin/||;s|^[[:space:]]*||')

  if [[ ${#BRANCHES[@]} -eq 0 ]]; then
    # Also check local branches
    mapfile -t BRANCHES < <(git branch --list 'claude/*' 2>/dev/null | sed 's|^[[:space:]]*||;s|^\* //')
  fi

  if [[ ${#BRANCHES[@]} -eq 0 ]]; then
    echo "No claude/* branches found."
    echo ""
    echo "Expected branches like:"
    echo "  claude/overnight-ux-20260321"
    echo "  claude/ux-polish-20260321"
    echo "  claude/arkit-onboarding-20260321"
    exit 0
  fi
fi

echo "Found ${#BRANCHES[@]} branch(es) to review:"
for b in "${BRANCHES[@]}"; do
  echo "  - $b"
done
echo ""

# ─── Review Each Branch ─────────────────────────────────────────────────────

for branch in "${BRANCHES[@]}"; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Branch: $branch"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Commits
  echo "── Commits ──────────────────────────────────────────────────"
  COMMIT_COUNT=$(git log --oneline main.."$branch" 2>/dev/null | wc -l | tr -d ' ')
  echo "  Total: $COMMIT_COUNT commits"
  echo ""

  if [[ "$COMMIT_COUNT" -gt 0 ]]; then
    git log --oneline --no-walk=unsorted main.."$branch" 2>/dev/null | while read -r line; do
      echo "  $line"
    done
    echo ""

    # Diff stats
    echo "── File Changes ─────────────────────────────────────────────"
    git diff --stat main.."$branch" 2>/dev/null | tail -1
    echo ""
    git diff --stat main.."$branch" 2>/dev/null | head -20
    echo ""

    # Files changed breakdown
    echo "── Change Categories ────────────────────────────────────────"
    ADDED=$(git diff --diff-filter=A --name-only main.."$branch" 2>/dev/null | wc -l | tr -d ' ')
    MODIFIED=$(git diff --diff-filter=M --name-only main.."$branch" 2>/dev/null | wc -l | tr -d ' ')
    DELETED=$(git diff --diff-filter=D --name-only main.."$branch" 2>/dev/null | wc -l | tr -d ' ')
    echo "  Added:    $ADDED files"
    echo "  Modified: $MODIFIED files"
    echo "  Deleted:  $DELETED files"
    echo ""

    # Safety check: any forbidden file changes?
    echo "── Safety Check ─────────────────────────────────────────────"
    FORBIDDEN=$(git diff --name-only main.."$branch" 2>/dev/null | grep -E '^(\.env|supabase/migrations|ios/|android/)' || true)
    if [[ -n "$FORBIDDEN" ]]; then
      echo "  ⚠ WARNING: Forbidden files were modified:"
      echo "$FORBIDDEN" | while read -r f; do echo "    - $f"; done
    else
      echo "  ✓ No forbidden files modified (env, migrations, native code)"
    fi
    echo ""

    # Check for audit/changelog docs
    echo "── Generated Documentation ──────────────────────────────────"
    for doc in docs/OVERNIGHT_AUDIT.md docs/OVERNIGHT_CHANGELOG.md; do
      if git show "$branch:$doc" &>/dev/null; then
        echo "  ✓ $doc exists"
      else
        echo "  - $doc not found"
      fi
    done
    echo ""
  else
    echo "  (no commits on this branch)"
    echo ""
  fi

  # Create PR if requested
  if [[ "$CREATE_PRS" == true ]] && [[ "$COMMIT_COUNT" -gt 0 ]]; then
    echo "── Creating PR ────────────────────────────────────────────"

    # Build PR body
    PR_BODY="## Overnight Claude Code Session

**Branch:** \`$branch\`
**Commits:** $COMMIT_COUNT
**Files changed:** Added $ADDED, Modified $MODIFIED, Deleted $DELETED

### Commits
$(git log --oneline main.."$branch" 2>/dev/null)

### Review Checklist
- [ ] No forbidden file changes (env, migrations, native code)
- [ ] Lint passes: \`bun run lint\`
- [ ] Types pass: \`bun run check:types\`
- [ ] Tests pass: \`bun run test\`
- [ ] Changes match the prompt's intent
- [ ] No regressions in existing functionality"

    PR_TITLE="Claude overnight: $(echo "$branch" | sed 's|claude/||;s|-[0-9]*$||')"

    if command -v gh &>/dev/null; then
      PR_URL=$(gh pr create \
        --base main \
        --head "$branch" \
        --title "$PR_TITLE" \
        --body "$PR_BODY" \
        2>/dev/null) || true

      if [[ -n "$PR_URL" ]]; then
        echo "  Created PR: $PR_URL"
      else
        echo "  PR already exists or creation failed"
      fi
    else
      echo "  gh CLI not found. Install with: brew install gh"
    fi
    echo ""
  fi
done

# ─── Log Files ───────────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Overnight Logs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ -d "logs/overnight" ]]; then
  echo ""
  ls -lah logs/overnight/*.log 2>/dev/null | while read -r line; do
    echo "  $line"
  done
  echo ""
  echo "Read logs:"
  echo "  cat logs/overnight/<logfile>.log | jq '.result' 2>/dev/null || cat logs/overnight/<logfile>.log"
else
  echo "  No logs found in logs/overnight/"
fi
echo ""

# ─── Quick Commands ──────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Quick Commands"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  # View full diff for a branch"
echo "  git diff main..claude/branch-name"
echo ""
echo "  # Cherry-pick specific commits"
echo "  git cherry-pick <commit-hash>"
echo ""
echo "  # Create PRs for all branches"
echo "  ./scripts/overnight-review.sh --create-prs"
echo ""
echo "  # Delete all overnight branches"
echo "  git branch --list 'claude/*' | xargs git branch -D"
echo ""
