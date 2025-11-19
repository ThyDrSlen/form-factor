# TestFlight Release Runbook

Use this runbook whenever you need to ship a fresh TestFlight build. It captures the commands, order, and environment expectations for the `form-factor-eas` app using the EAS **staging** profile.

## 0. Prerequisites
- `bun install` already run, repo on the correct branch, clean git status
- Expo CLI + EAS CLI installed and authenticated as `slenthekid`
- Apple Developer Program access and App Store Connect app record (`com.slenthekid.formfactoreas`)
- All required secrets set in Expo (`EXPO_TOKEN`, `SUPABASE_STAGING_URL`, `SUPABASE_STAGING_ANON_KEY`, etc.)

Quick verifications:
```bash
eas whoami
expo whoami
```

## 1. Prepare the build
1. Pull latest changes and resolve any merge conflicts.
2. Bump version metadata:
   - `app.json` → `expo.version` (semver)  
   - `app.json` → `expo.ios.buildNumber` (monotonic integer)  
   - Bump `expo.android.versionCode` too if Android build will follow.
3. Update release notes/CHANGELOG if needed.
4. Run sanity checks locally:
   ```bash
   bun run lint
   bun run check:types
   ```

## 2. Kick off the local TestFlight build
Prefer local builds to skip the Expo runner queue and drop the artifact into `./build/formfactoreas-staging.ipa`
```bash
mkdir -p build
eas build \
  --platform ios \
  --profile staging \
  --local \
  --output build/formfactoreas-staging.ipa \
  --non-interactive
```

What this does:
- Uses the `staging` profile defined in `eas.json` (Release configuration + staging Supabase env vars).
- Runs the full EAS build toolchain on your Mac (Xcode 16+, cocoapods, etc.).
- Outputs the signed `.ipa` at `./build/formfactoreas-staging.ipa`.

Monitor from the CLI (even for local builds):
```bash
eas build:list
```

## 3. Submit the local artifact to TestFlight
Local builds can’t auto-submit, so pass the `.ipa` you just produced to `eas submit`:
```bash
eas submit \
  --platform ios \
  --path build/formfactoreas-staging.ipa \
  --apple-team-id NCTLNFGC6G
```

- Apple typically needs ~5–10 minutes of processing before the build appears as “Ready to Test”.
- If submission fails, re-run the same command after resolving the credential or metadata issue.
- Use `eas submit:list` to confirm the upload status.

## 4. Enable testers
1. App Store Connect → Your App → TestFlight.
2. Select the newly processed build (`Ready to Test`).
3. Add it to an external testing group or create a new one.
4. Provide beta release notes (what changed, what to verify).
5. Share the invite link or add tester emails.

## 5. Post-build checklist
- Tag or note the commit that produced the build.
- Verify Supabase staging endpoints function on-device.
- Monitor TestFlight crash reports and feedback.
- If issues surface, patch and repeat `eas build --platform ios --profile staging --auto-submit`.

## Quick Command Reference
```bash
eas build:configure        # regenerate metadata if config changed
eas build:cancel <id>      # cancel a stuck build
eas whoami && expo whoami  # double-check auth context
```

Keeping these steps documented ensures everyone follows the same release path and avoids missed bumps, secrets, or credential prompts.
