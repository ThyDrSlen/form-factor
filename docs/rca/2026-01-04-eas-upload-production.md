# RCA: EAS production upload failed (2026-01-04)

## Impact
- Production CI/CD run failed on `main` after merge, blocking the pipeline.
- Failure occurred before iOS submission, so no App Store upload was performed.

## Timeline
- 2026-01-04: CI/CD Pipeline run `20699358695` failed on job `Local production upload`.

## Root Cause
- Workflow ran `bunx eas upload --platform ios --profile production --local --non-interactive`.
- `eas upload` does not accept `--profile` or `--local`, causing the CLI to exit with:
  `Unexpected arguments: --profile, production, --local`.

## Fix
- Removed the `Local production upload` job.
- Replaced with local build + submit in production deploy:
  - `eas build --platform ios --profile production --local --non-interactive`
  - `eas submit --platform ios --profile production --path <ipa> --non-interactive`
- Updated production deploy runner to `macos-latest` so local iOS builds can run.

## Prevention
- Avoid `eas upload` for iOS production flows; use `eas build --local` + `eas submit`.
- Keep workflow steps aligned with supported EAS CLI flags.

## Evidence / Commands
- `gh run list --limit 5`
- `gh run view 20699358695 --log | rg -n "eas upload|Unexpected arguments" -C 2`
- `rg -n "eas (upload|submit|build)" .github/workflows/ci-cd.yml`
