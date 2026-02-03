# RCA: EAS production build failed (non-interactive credentials) (2026-02-03)

## Impact
- Production CI/CD run on `main` failed during the iOS production build step.
- No TestFlight submission or OTA update was performed in that run.

## Timeline
- 2026-02-03: CI/CD Pipeline run `21613426543` failed on job `Deploy to Production`.

## Root Cause
- The workflow ran `eas build --platform ios --profile production --auto-submit --non-interactive`.
- EAS attempted to use **remote** credentials and detected multiple targets (iOS + watch).
- The watch target (`Form Factor Watch Watch App`) did not have an existing provisioning profile on the Expo server.
- In non-interactive mode, EAS cannot create or validate missing credentials, so it exited with:
  `Failed to set up credentials. Credentials are not set up. Run this command again in interactive mode.`

## Fix
- Switched production iOS builds to **local credentials** via `credentialsSource: "local"`.
- Added a CI step to write `credentials.json` and provisioning files from GitHub Secrets.
- Ensured required secrets are present before running the production build.

## Prevention
- Keep all target provisioning profiles stored as GitHub Secrets and generated at build time.
- If new targets are added, update the credentials step and secrets immediately.
- Optionally run an interactive `eas credentials` session when targets change to validate remote credentials.

## Evidence / Commands
- `gh run list --branch main --limit 5`
- `gh run view 21613426543 --log | rg -n "Failed to set up credentials|non-interactive" -C 2`
- `rg -n "credentialsSource|Build and submit iOS production" eas.json .github/workflows/ci-cd.yml`
