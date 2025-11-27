# Debugging FAQ

Common issues and solutions for development and troubleshooting.

## iOS Build Issues

### Asset Catalog Compilation Failed

**Error**: `AssetCatalogSimulatorAgent exited` or asset catalog compilation errors

**Cause**: Asset thinning enabled for Debug builds (Xcode 16.2+ issue)

**Solution**: 
- The `withDisableAssetThinning` plugin should fix this automatically
- If it persists, ensure you've run `npx expo prebuild --platform ios --clean` after adding the plugin
- Check that `./plugins/withDisableAssetThinning.js` is in your `app.json` plugins array

### CocoaPods: object version `70`

**Error**

```
ArgumentError - [Xcodeproj] Unable to find compatibility version string for object version `70`.
```

**Why it happens**

Xcode 16 bumps the project’s `objectVersion` to `70`, but the version of `xcodeproj` bundled with CocoaPods 1.16.x only knows up to 63. When Pods regenerate the workspace they fail before creating the Pods project, so `pod install` dies and `bunx expo run:ios` never finishes.

**Quick fix**

1. Open `ios/formfactoreas.xcodeproj/project.pbxproj`.
2. Change the top-level `objectVersion` back to `63`.
3. Save the file and rerun `npx pod-install` (or `cd ios && pod install`).

Once the project builds, you can open Xcode and continue working normally. Xcode may try to upgrade the format again when you add new targets—if it does, repeat the steps above or use a lightweight text replace (`rg -g "*.pbxproj" objectVersion`) to confirm the value.

**Prevention tips**

- In Xcode’s “Project Format” dropdown (File ▸ Project Settings), leave the format set to “Xcode 15.0-compatible” until CocoaPods ships a release that understands objectVersion 70.
- Avoid converting folders to the new “buildable folders” feature in Xcode 16, because that migration also updates the project format.

### Code Signing Required

**Error**: Code signing errors during build

**Cause**: Release builds require proper provisioning profiles

**Solution**: Use EAS Build for release builds instead of building locally:
```bash
eas build --platform ios --profile staging
```

### Changed Xcode Scheme to Release

**Fix in Xcode**:
1. Open `ios/formfactoreas.xcworkspace`
2. Product > Scheme > Edit Scheme...
3. Select "Run" on the left
4. Set "Build Configuration" to **Debug**
5. Click "Close"

**Or use command line**:
```bash
# These commands always use Debug
bun run ios              # For simulator
bun run ios:device       # For physical device (if connected)
```

### Module 'ExpoModulesCore' not found

**Problem**: Pods not installed correctly

**Solution**:
```bash
cd ios
pod deintegrate
pod install --repo-update
cd ..
npx expo prebuild --platform ios --clean
```

### Duplicate File References

**Error**: `Multiple commands produce conflicting outputs`

**Cause**: Xcode project has duplicate references to build resources

**Fix**:
```bash
./scripts/fix-ios-build.sh
```

### Missing React Native Headers

**Error**: `folly/Exception.h file not found`

**Cause**: CocoaPods installation is incomplete or corrupted

**Fix**:
```bash
cd ios
rm -rf Pods Podfile.lock
pod deintegrate
pod install --repo-update
cd ..
```

## ARKit Issues

### ARKit Not Supported

**Error**: Device doesn't support ARKit body tracking

**Solution**: ARKit body tracking requires iPhone XS or newer (A12 Bionic chip or later)

### ARKit Session Not Starting

**Check**:
1. Verify camera permissions are granted
2. Ensure device supports ARKit (`ARBodyTrackingConfiguration.isSupported`)
3. Check that ARKit view is mounted before starting session
4. Review console logs for specific error messages

### Tracking Interruptions

**Common causes**:
- App backgrounded
- Camera access revoked
- Low light conditions
- Multiple AR sessions conflicting

**Solution**: Handle interruptions gracefully in ARSessionDelegate

## HealthKit Sync Issues

### No Data Available

**Solution**: Tap the "Sync HealthKit Data" button to import your history

### Sync Takes Too Long

**Solution**: Start with 30 days, then sync more as needed

### Metrics Don't Match HealthKit App

**Check**: 
1. Timezone settings
2. Date range selected
3. Re-sync data to get latest values

### Sync Failed Error

**Try**:
1. Check internet connection
2. Verify Supabase is accessible
3. Check console logs for details
4. Retry sync (it's safe to re-run)

## Network & Sync Issues

### Supabase Connection Errors

**Check**:
1. Verify Supabase URL and keys in environment variables
2. Check network connectivity
3. Review Supabase project status
4. Check for rate limiting

### Offline Sync Not Working

**Verify**:
1. Local database is initialized (`localDB.init()`)
2. Network detection is working (`useNetwork()`)
3. Sync service is running (`syncService.start()`)

## General Debugging

### View Live Logs

```bash
# iOS device logs
xcrun xcode build -showBuildSettings | grep -i log

# Or use Console.app
open -a Console
# Filter by process: formfactoreas
```

### Network Debugging

```bash
# Check Supabase connectivity
curl -I https://your-supabase-url.supabase.co
```

### Performance Profiling

In Xcode:
1. Product > Profile (⌘I)
2. Select "Time Profiler" or "Allocations"
3. Record while using app
4. Analyze hotspots and memory usage

### Clean Build

```bash
# Clean derived data
rm -rf ~/Library/Developer/Xcode/DerivedData/formfactoreas-*

# Clean and rebuild
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
```

## Verification Commands

### Check Build Configuration

```bash
xcodebuild -workspace ios/formfactoreas.xcworkspace \
  -scheme formfactoreas \
  -showBuildSettings | grep "CONFIGURATION ="
```

Should show: `CONFIGURATION = Debug` for local development.

### Check Asset Thinning

```bash
xcodebuild -workspace ios/formfactoreas.xcworkspace \
  -scheme formfactoreas \
  -configuration Debug \
  -showBuildSettings | grep "ASSETCATALOG.*THINNING"
```

Should return nothing (thinning disabled) for Debug builds.

## Still Stuck?

1. Run diagnostics:
   ```bash
   ./scripts/fix-ios-build.sh
   ```

2. Capture error screenshots:
   ```bash
   ./scripts/capture-device-screen.sh
   ```

3. Check logs:
   ```bash
   npx expo start --ios --clear
   ```

4. Review relevant documentation:
   - ARKit: `docs/ARKIT_BODY_TRACKING_GUIDE.md`
   - Platform stubs: `docs/QUICK_REFERENCE_PLATFORM_STUBS.md`
   - HealthKit: `docs/HEALTHKIT_SYNC_QUICK_START.md`

