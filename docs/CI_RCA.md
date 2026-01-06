# CI RCA - patch-package failure on GitHub Actions

## Incident summary

On 2025-12-27, GitHub Actions CI failed during `bun install` because `patch-package` could not apply `patches/expo-modules-core+3.0.20.patch`. Local installs and EAS builds were successful, but CI jobs failed early, blocking the pipeline.

## Impact

- PR CI runs failed at dependency install.
- No production deploy impact (failure happened before deploy jobs).

## Detection

- Failure observed in GH Actions log for the PR run.
- Error: `Failed to apply patch for package expo-modules-core` during `patch-package`.

## Root cause

Bun’s cached install on GitHub Actions was restoring `node_modules` with hardlinked files. This caused `patch-package` to see a mismatched/mutable tree and fail to apply the expo-modules-core patch, even though the patch file itself was valid.

## Resolution

- Forced Bun to use `--backend=copyfile` in CI to avoid hardlink-based installs.
- Bumped the Bun cache key (`v2` -> `v3`) to invalidate old cached artifacts.

## Verification

- Re-ran the GitHub Actions workflow; all jobs completed successfully, including Build Preview.

## Prevention / Follow-ups

- Keep Bun cache keys versioned so cache changes are explicit.
- Prefer `--backend=copyfile` in CI when patch-package is used.
- Document CI RCA patterns for quick diagnosis and remediation.

## Timeline (UTC)

- 2025-12-27: CI failures observed in PR run.
- 2025-12-27: Workflow updated to use copyfile backend and new cache key.
- 2025-12-27: CI rerun completed successfully.
