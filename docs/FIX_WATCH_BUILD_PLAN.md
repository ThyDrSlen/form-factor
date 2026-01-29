# Fix Watch App Build - Complete Plan

## Current Status
✅ Code fixes pushed:
- Watch target name fixed (`FormFactorWatchApp`)
- Health usage descriptions added (`NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`)
- `WKApplication` set (modern watchOS app lifecycle)
- `ARCHS = "$(ARCHS_STANDARD)"` added for arm64_32 support

❌ Blocking issue:
- Broken provisioning profile `1764354199639` still exists on Apple Developer Portal
- EAS keeps downloading it during builds, causing certificate mismatch

## Root Cause
The provisioning profile `1764354199639` was created with an old/expired certificate. Even though you deleted it from EAS dashboard, it still exists on **Apple Developer Portal**, so EAS downloads it during builds.

## Fix Steps

### Step 1: Delete Profile from Apple Developer Portal
1. Go to: https://developer.apple.com/account/resources/profiles/list
2. Filter by: **Ad Hoc** distribution type
3. Search for: `1764354199639` or `com.slenthekid.formfactoreas.preview`
4. **Delete** the profile with UUID `1764354199639`

### Step 2: Force Regenerate Credentials
```bash
bunx eas credentials --platform ios
```
Select:
- Profile: **preview**
- **"All: Set up all the required credentials to build your project"**

This will create NEW profiles on Apple's servers with the correct certificate.

### Step 3: Test Local Preview Build
```bash
bunx eas build --platform ios --profile preview --local --non-interactive
```
Should succeed now with new credentials.

### Step 4: Merge PR
Once local build works, merge `fix/watch-app-target-name` to `main`.

### Step 5: GitHub Actions Will Work
- **PR builds**: Only run `eas config` (validation) - ✅ Already passing
- **Staging (develop)**: Uses cloud build (`eas build --auto-submit`) - ✅ Will work
- **Production (main)**: Uses local build - ⚠️ Will fail until Step 1-2 are done

## Alternative: Use Cloud Builds for Production
If you can't delete the profile from Apple Developer Portal, modify `.github/workflows/ci-cd.yml` line 276:

**Change from:**
```yaml
eas build --platform ios --profile production --local --non-interactive --output build/production.ipa
```

**Change to:**
```yaml
eas build --platform ios --profile production --auto-submit --non-interactive
```

Cloud builds use EAS-managed credentials and won't hit the broken profile issue.

## Verification Checklist
- [ ] Profile `1764354199639` deleted from Apple Developer Portal
- [ ] New credentials created via `eas credentials`
- [ ] Local preview build succeeds
- [ ] PR merged to main
- [ ] GitHub Actions production build succeeds (or switched to cloud build)
