# EAS Build Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Spend EAS build credits only on deployment branches (`main`, and optionally `develop`) by removing PR-time EAS builds and relying on local Husky `pre-push` checks instead.

**Architecture:** Keep CI changes localized to `.github/workflows/ci-cd.yml` so PRs run only free checks (lint/types/tests/EAS config validation), while `main` continues to run the paid `eas build`/deploy. Keep (and document) the existing Husky `pre-push` hook that runs `scripts/ci_local.py --quick` to catch CI failures locally before pushing.

**Tech Stack:** Expo Application Services (EAS), GitHub Actions, Husky hooks, `bun`/`bunx`, Python (`scripts/ci_local.py`), repository docs (README/docs/plans).

### Task 1: Document the new build policy for the team

**Files:**
- Modify: `README.md:1-40` (add policy note near contribution or build sections)
- Modify: `docs/CI-CD.md` (update pipeline docs to remove PR preview builds)
- Modify: `docs/plans/2026-01-03-eas-build-optimization-plan.md`

**Step 1: Draft policy copy referencing hook-run requirement**
```markdown
## EAS Build Policy
- `eas build` does **not** run for pull requests; paid builds happen on `main` after merge.
- Every PR must pass the Husky `pre-push` hook locally (runs `python3 scripts/ci_local.py --quick`).
- Pushes that fail the local hook should be resolved locally before opening/merging PRs.
```

**Step 2: Insert copy into `README.md` near existing build instructions**
- Add the policy block after the “Building locally” section so contributors see it before running EAS.
- Mention the Husky `pre-push` hook explicitly and reference `scripts/ci_local.py` (and the new `bun run ci:push` alias from Task 4).

**Step 3: Update CI/CD docs to match the new reality**
- Remove/adjust the “Preview Build (`build-preview`)” section in `docs/CI-CD.md`.
- Update the “Workflow Triggers” table so PRs run quality checks only (no EAS build).

**Step 4: Record the documentation change in the current plan file**
```markdown
- Document policy in README to remind authors to run the hook.
- Refer readers to the Husky hook in Task 3.
```
- Done: Added the EAS Build Policy block to `README.md` and removed the PR preview build section from `docs/CI-CD.md`.

**Step 5: Verify formatting and staging**
Run: `git diff -- README.md`
Expected: policy block renders as intended.

**Step 6: Check git status and commit when ready**
Run: `git status -sb`
Expected: shows doc updates only (README + CI docs + plan).

### Task 2: Keep the paid `eas build` workflow strictly to `main` pushes

**Files:**
- Modify: `.github/workflows/ci-cd.yml`

**Step 1: Remove PR-time EAS preview builds**
- Delete the `build-preview` job (the PR-only job that runs `eas build --platform ios --profile preview --non-interactive`).
- Keep the `pull_request` trigger so PRs still run `quality` + `build-check` (free checks).

**Step 2: Document in workflow comments why PR preview builds were removed**
- Add a comment near the removed section (or at the top) like: `# credit savings: no EAS builds on PR; rely on local pre-push + CI quality checks`.

**Step 3: Confirm `main` behavior stays intact**
- Ensure `deploy-production` still runs on `push` to `main` and continues to call `eas build --profile production` as before.
- (Optional) Decide whether `develop` staging builds (`deploy-staging`) should remain automatic or be moved to manual.

**Step 4: Validate the workflow change locally**
Run: `rg -n 'eas build --platform ios --profile preview' .github/workflows/ci-cd.yml`
Expected: no matches (preview build removed).

**Step 5: Review git diff**
Run: `git diff .github/workflows/ci-cd.yml`
Expected: `build-preview` removed; other jobs unchanged.

### Task 3: Ensure Husky `pre-push` runs the same checks as CI

**Files:**
- Modify: `.husky/pre-push`
- Modify: `scripts/ci_local.py` (only if needed to match CI expectations after Task 2)

**Step 1: Confirm the current `pre-push` hook runs local CI**
Run: `cat .husky/pre-push`
Expected: it runs `python3 scripts/ci_local.py --quick` unless `CI_LOCAL_SKIP=1`.

**Step 2: Add always-on `eas build --local` for iOS preview**
- Add a local iOS preview build to `.husky/pre-push` so every push does a full preview build locally (no EAS cloud build credits).
- Include a skip flag for emergencies without bypassing CI checks: `CI_LOCAL_SKIP_EAS_PREVIEW_LOCAL=1 git push`.
- Expected: after local CI passes, it runs `bunx eas build --platform ios --profile preview --local --non-interactive --output build/eas-preview.ipa` (macOS only).

**Step 3: Ensure the local script remains aligned with CI**
- `scripts/ci_local.py` claims to mirror `.github/workflows/ci-cd.yml` and should stay true after removing `build-preview`.
- If any steps are too slow for `pre-push`, prefer making them optional via flags/env vars (don’t silently remove coverage).

**Step 4: Document failure handling**
- In the hook, if `python3 scripts/ci_local.py --quick` exits non-zero, the push should abort (Husky default).
- Ensure the push aborts (Husky default). No extra commands needed.

**Step 5: Run the hook manually to prove it fails when commands fail**
Run: `python3 scripts/ci_local.py --quick`
Expected: prints steps; exit status non-zero if any command fails.

**Step 6: Capture `git diff` of hook and script changes**
Run: `git diff .husky/pre-push scripts/ci_local.py`
Expected: new command references and hook messages show up.

### Task 4: Provide a quick command for manual verification without pushing

**Files:**
- Modify: `package.json: scripts`

**Step 1: Add script aliases for local CI**
```json
"ci:push": "python3 scripts/ci_local.py --quick",
"ci:full": "python3 scripts/ci_local.py"
```

**Step 2: Mention these scripts in README (Task 1)**
- Recommend `bun run ci:push` before pushing and `bun run ci:full` before merging large native changes.

**Step 3: Run the script as a smoke check**
Run: `bun run ci:push`
Expected: commands execute, final message prints; exit 0 if all succeed.

**Step 4: Stage and review changes**
Run: `git add package.json && git diff --staged`
Expected: only script aliases added/updated.

**Step 5: Update README if needed to mention this manual command**
- Ensure the policy block references `bun run ci:push` / `bun run ci:full`.

**Step 6: Add a one-shot preview upload+submit helper**
Run: `git diff scripts/eas-local-preview-submit.sh`
Expected: new script runs `bunx eas build --local`, then `bunx eas upload` and `bunx eas submit` using the same artifact; document `bun run preview:local:submit`.


Plan complete and saved to `docs/plans/2026-01-03-eas-build-optimization-plan.md`. Two execution options:
1. Subagent-Driven (this session) – I’d use `superpowers:subagent-driven-development` with fresh subagents for each task plus reviews.
2. Parallel Session (separate) – open a new session/worktree that uses `superpowers:executing-plans` to follow the plan end-to-end.
Which approach do you want?
