#!/bin/bash
# overnight-parallel.sh — Run multiple Claude Code instances in parallel via git worktrees
#
# Usage:
#   ./scripts/overnight-parallel.sh [--max-turns N]
#
# This creates 3 isolated git worktrees and runs Claude in each simultaneously:
#   Agent 1: UX Polish           (prompts/overnight-ux.md)
#   Agent 2: ARKit Onboarding    (prompts/arkit-onboarding.md)
#   Agent 3: Health Dashboard    (prompts/health-dashboard.md)
#
# Each agent works on its own branch in its own worktree — zero conflicts.

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

MAX_TURNS=40
DATE_STAMP=$(date +%Y%m%d)
LOG_DIR="logs/overnight"
WORKTREE_BASE="../ff-overnight"

# Parse optional flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-turns)
      MAX_TURNS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ─── Validation ──────────────────────────────────────────────────────────────

if ! command -v claude &>/dev/null; then
  echo "Error: 'claude' CLI not found."
  exit 1
fi

for prompt in prompts/overnight-ux.md prompts/arkit-onboarding.md prompts/health-dashboard.md; do
  if [[ ! -f "$prompt" ]]; then
    echo "Error: Required prompt file not found: $prompt"
    exit 1
  fi
done

# ─── Setup ───────────────────────────────────────────────────────────────────

mkdir -p "$LOG_DIR"

# Ensure main is up to date
CURRENT_BRANCH=$(git branch --show-current)
if [[ -n "$(git status --porcelain)" ]]; then
  git stash push -m "overnight-parallel-auto-stash-$DATE_STAMP"
fi

git checkout main 2>/dev/null || git checkout master 2>/dev/null
git pull origin "$(git branch --show-current)" 2>/dev/null || true

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Claude Code Parallel Runner (3 agents)                     ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Agent 1: UX Polish         → prompts/overnight-ux.md      ║"
echo "║  Agent 2: ARKit Onboarding  → prompts/arkit-onboarding.md  ║"
echo "║  Agent 3: Health Dashboard  → prompts/health-dashboard.md  ║"
echo "║  Max turns per agent: $MAX_TURNS"
echo "║  Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Shared Tool Whitelist ──────────────────────────────────────────────────

ALLOWED_TOOLS=(
  "Read" "Write" "Edit" "Grep" "Glob"
  "Bash(bun run lint)" "Bash(bun run check:types)" "Bash(bun run test)"
  "Bash(git add:*)" "Bash(git commit:*)" "Bash(git diff:*)" "Bash(git status)" "Bash(git log:*)"
  "Bash(cat *)" "Bash(find *)" "Bash(head *)" "Bash(tail *)" "Bash(wc *)"
)

# ─── Agent Configuration ────────────────────────────────────────────────────

declare -A AGENTS
AGENTS[ux-polish]="prompts/overnight-ux.md"
AGENTS[arkit-onboarding]="prompts/arkit-onboarding.md"
AGENTS[health-dashboard]="prompts/health-dashboard.md"

PIDS=()
AGENT_NAMES=()

# ─── Create Worktrees and Launch Agents ─────────────────────────────────────

for agent_name in "${!AGENTS[@]}"; do
  prompt_file="${AGENTS[$agent_name]}"
  branch="claude/${agent_name}-${DATE_STAMP}"
  worktree_path="${WORKTREE_BASE}-${agent_name}"
  log_file="${LOG_DIR}/parallel-${agent_name}-$(date +%Y%m%d-%H%M%S).log"

  echo "── Setting up Agent: $agent_name ──────────────────────────────"

  # Clean up any existing worktree
  if [[ -d "$worktree_path" ]]; then
    echo "  Removing existing worktree at $worktree_path..."
    git worktree remove "$worktree_path" --force 2>/dev/null || rm -rf "$worktree_path"
  fi

  # Delete branch if it exists
  git branch -D "$branch" 2>/dev/null || true

  # Create worktree with new branch
  git worktree add "$worktree_path" -b "$branch"

  echo "  Worktree: $worktree_path"
  echo "  Branch:   $branch"
  echo "  Prompt:   $prompt_file"
  echo "  Log:      $log_file"
  echo ""

  # Copy prompt file to worktree (it may not exist there yet since prompts/ is new)
  mkdir -p "$worktree_path/prompts"
  cp "$prompt_file" "$worktree_path/prompts/"

  # Launch Claude in background
  AGENT_PROMPT=$(cat "$prompt_file")
  AGENT_SESSION=$(uuidgen)

  (
    cd "$worktree_path"
    claude -p "$AGENT_PROMPT" \
      --allowedTools "${ALLOWED_TOOLS[@]}" \
      --max-turns "$MAX_TURNS" \
      --session-id "$AGENT_SESSION" \
      --output-format json \
      2>&1 | tee "$log_file"
  ) &

  PIDS+=($!)
  AGENT_NAMES+=("$agent_name")

  echo "  Launched with PID: ${PIDS[-1]}"
  echo ""
done

# ─── Wait for All Agents ────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  All agents running. Waiting for completion..."
echo "  Monitor: tail -f ${LOG_DIR}/parallel-*.log"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

FAILED=()
for i in "${!PIDS[@]}"; do
  pid="${PIDS[$i]}"
  name="${AGENT_NAMES[$i]}"
  if wait "$pid"; then
    echo "  ✓ Agent '$name' completed successfully (PID $pid)"
  else
    echo "  ✗ Agent '$name' failed with exit code $? (PID $pid)"
    FAILED+=("$name")
  fi
done

# ─── Post-Run: Push All Branches ────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Parallel Run Complete                                      ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Finished:   $(date '+%Y-%m-%d %H:%M:%S')"

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "║  Failed:     ${FAILED[*]}"
fi

echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

for agent_name in "${!AGENTS[@]}"; do
  branch="claude/${agent_name}-${DATE_STAMP}"
  worktree_path="${WORKTREE_BASE}-${agent_name}"

  echo "── Agent: $agent_name ─────────────────────────────────────────"

  if [[ -d "$worktree_path" ]]; then
    cd "$worktree_path"
    COMMIT_COUNT=$(git log --oneline main.."$branch" 2>/dev/null | wc -l | tr -d ' ')
    echo "  Commits: $COMMIT_COUNT"

    if [[ "$COMMIT_COUNT" -gt 0 ]]; then
      git log --oneline main.."$branch" 2>/dev/null | head -5
      echo "  Pushing..."
      git push origin "$branch" 2>/dev/null && echo "  Pushed: $branch" || echo "  Push failed for $branch"
    else
      echo "  (no commits)"
    fi
    cd - >/dev/null
  fi
  echo ""
done

# ─── Cleanup Worktrees ──────────────────────────────────────────────────────

echo "── Cleanup ────────────────────────────────────────────────────"
for agent_name in "${!AGENTS[@]}"; do
  worktree_path="${WORKTREE_BASE}-${agent_name}"
  if [[ -d "$worktree_path" ]]; then
    git worktree remove "$worktree_path" --force 2>/dev/null || true
    echo "  Removed worktree: $worktree_path"
  fi
done

# Return to original branch
git checkout "$CURRENT_BRANCH" 2>/dev/null || git checkout main 2>/dev/null

echo ""
echo "Done. Review branches:"
for agent_name in "${!AGENTS[@]}"; do
  echo "  git log --oneline main..claude/${agent_name}-${DATE_STAMP}"
done
echo ""
echo "Create PRs:"
for agent_name in "${!AGENTS[@]}"; do
  echo "  gh pr create --base main --head claude/${agent_name}-${DATE_STAMP} --title \"Claude parallel: ${agent_name}\""
done
