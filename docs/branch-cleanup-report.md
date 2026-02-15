# Branch Cleanup Report

**Generated:** 2026-02-14  
**Target:** Consolidate leftover work, merge to main, delete stale branches

**Note:** Cherry-picks from `feat/approval-pass-cleanup-pr` and `codex/fix-gha-unit-tests` had conflicts with evolved main; the work is largely already merged or requires manual resolution. This report documents branch state for cleanup.

---

## Summary

| Category | Count | Action |
|----------|-------|--------|
| **Already merged (safe to delete)** | 15+ | Delete locally |
| **Has unique leftover work** | 4–6 | Consolidate into one branch |
| **Stale / duplicate chains** | Several | Delete after consolidation |

---

## 1. Branches Already Merged via PR (Safe to Delete)

These branches had their work merged via PRs. The diff with main is either empty or only shows branch-is-behind (no unique content).

| Branch | Merged as PR | Notes |
|--------|--------------|-------|
| `feat/mediapipe-shadow-packaging-pr` | #93 | ✅ 0 files differ – fully merged |
| `feat/core-fusion-camera-watch-airpods-pr` | #88 | Core fusion code merged; may have `.sisyphus/` evidence only |
| `feat/ci-cd-hardening-plan` | #87 | CI workflow merged |
| `fix/ci-app-code-gating` | #89 | App code gating merged |
| `feat/playwright-docker-bun-testing-pr` | #85 | Playwright e2e merged |
| `fix/pr85-e2e-webserver` | #85 | Same chain as above |
| `fix/pr85-e2e-webserver-2` | #85 | Same chain |
| `fix/pr85-e2e-webserver-3` | #85 | Same chain (latest in chain) |
| `feat/social-graph-sharing-foundation` | #84 | Social graph merged |
| `fix/ut-home-social-provider` | #83 | Home feed tab spec merged |
| `feat/pose-shadow-adapter-pipeline` | #82 | Mediapipe shadow merged |
| `feat/pullup-shadow-false-rep-quickwins-pr` | #86 | Pull-up false rep fix merged |
| `feat/form-factor-approval-pass` | #91 | Approval pass merged |

---

## 2. Branches with Unique Leftover Work (Consolidate)

These have commits that appear to add content not yet in main:

| Branch | Commits ahead | Unique content |
|--------|---------------|----------------|
| `feat/approval-pass-cleanup-pr` | 3 | `.sisyphus/plans/auth-stability-quick-wins.md`, realtime form engine smoothing, workout insights modal, reset-password flow |
| `feat/video-feed-ui-refresh` | 1 | `feat(ui): refresh video feed and comments with modern tailwind styled components` |
| `feat/video-comments-profile-ui` | 1 | `fix(deps): patch MCP tunnel dependency` |
| `feat/realtime-workout-engine` | 2 | Merge of pose-shadow-adapter + realtime workout engine |
| `codex/fix-gha-unit-tests` | 1 | `Address patch-package warning` |
| `docs/read-me-update` | 1 | Same as fix/ut-home-social-provider (61584df) |

**Note:** `feat/approval-pass-cleanup-pr` has the most substantial unique work (auth, insights, form engine). `feat/video-feed-ui-refresh` and `feat/video-comments-profile-ui` are older branches and may conflict heavily with main.

---

## 3. Stale / Duplicate Branches (Delete After Consolidation)

- `fix/pr85-e2e-webserver`, `fix/pr85-e2e-webserver-2`, `fix/pr85-e2e-webserver-3` – same work, PR #85 merged
- `fix/social-stash-qa-conflict-recovery` – conflict recovery branch
- `fix/watch-app-target-name`, `feat/expo-watch-targets` – watch-related PRs merged
- `docs/read-me-update` – overlaps with fix/ut-home-social-provider (same commit)
- `chore/progress-checkpoint` and many `codex/*`, `docs/*`, `error-cleanup-pass1`, etc. – already merged

---

## 4. Recommended Consolidation Plan

### Step 1: Create consolidation branch

```bash
git checkout main
git pull form-factor main
git checkout -b chore/consolidate-leftover-work
```

### Step 2: Cherry-pick or merge unique commits (in priority order)

1. **feat/approval-pass-cleanup-pr** – 3 commits (auth, insights, form engine)
2. **codex/fix-gha-unit-tests** – 1 commit (patch-package)
3. **feat/video-feed-ui-refresh** – 1 commit (if still desired)
4. **feat/video-comments-profile-ui** – 1 commit (MCP patch, if still desired)

Resolve conflicts as you go. `feat/realtime-workout-engine` may already be covered by main (#82, #93).

### Step 3: Open PR and merge

### Step 4: Delete stale branches (after merge)

```bash
# Delete local branches (run after consolidation is merged)
git checkout main
git pull form-factor main

# Merged via PR - safe to delete
git branch -d feat/mediapipe-shadow-packaging-pr
git branch -d feat/core-fusion-camera-watch-airpods-pr
git branch -d feat/ci-cd-hardening-plan
git branch -d fix/ci-app-code-gating
git branch -d feat/playwright-docker-bun-testing-pr
git branch -d fix/pr85-e2e-webserver fix/pr85-e2e-webserver-2 fix/pr85-e2e-webserver-3
git branch -d feat/social-graph-sharing-foundation
git branch -d fix/ut-home-social-provider
git branch -d feat/pose-shadow-adapter-pipeline
git branch -d feat/pullup-shadow-false-rep-quickwins-pr
git branch -d feat/form-factor-approval-pass

# After consolidation PR merged
git branch -d feat/approval-pass-cleanup-pr
git branch -d codex/fix-gha-unit-tests
git branch -d docs/read-me-update
git branch -d feat/video-feed-ui-refresh
git branch -d feat/video-comments-profile-ui
git branch -d feat/realtime-workout-engine

# Prune remote-tracking refs
git fetch form-factor --prune
```

---

## 5. Quick Reference: Main PR History

```
#93 - workout session (mediapipe-shadow-packaging-pr)
#92 - pull-up tracking
#91 - form-factor approval pass
#89 - fix(ci) app_code (fix/ci-app-code-gating)
#88 - fusion pipeline (feat/core-fusion-camera-watch-airpods-pr)
#87 - ci harden (feat/ci-cd-hardening-plan)
#86 - pullup false reps (feat/pullup-shadow-false-rep-quickwins-pr)
#85 - Playwright e2e (fix/pr85-e2e-webserver-3, feat/playwright-docker-bun-testing-pr)
#84 - social graph (feat/social-graph-sharing-foundation)
#83 - fix tests (fix/ut-home-social-provider)
#82 - mediapipe shadow (feat/pose-shadow-adapter-pipeline)
```
