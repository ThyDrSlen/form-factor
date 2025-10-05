# Fix: ARKit Module Not Loading

## The Problem

`bunx expo prebuild --clean` generates the iOS project, but it doesn't:
- ❌ Install pods (native dependencies)
- ❌ Compile native code
- ❌ Install app on device

## Complete Fix (Run ALL These Steps)

```bash
# 1. Prebuild (you already did this)
bunx expo prebuild --clean --platform ios

# 2. Install CocoaPods dependencies (REQUIRED!)
cd ios
pod install
cd ..

# 3. Rebuild and install app on device (REQUIRED!)
bunx expo run:ios --device
```

## Why All 3 Steps Are Needed

| Step | What It Does | Required? |
|------|--------------|-----------|
| `bunx expo prebuild --clean` | Generates Xcode project | ✅ Yes |
| `cd ios && pod install` | Installs native dependencies | ✅ Yes |
| `bunx expo run:ios --device` | Compiles Swift code & installs app | ✅ Yes |

## One Command to Do Everything

```bash
bunx expo prebuild --clean --platform ios && cd ios && pod install && cd .. && bunx expo run:ios --device
```

Or broken down:
```bash
# Step 1: Generate iOS project
bunx expo prebuild --clean --platform ios

# Step 2: Install pods
cd ios && pod install && cd ..

# Step 3: Build and install on device
bunx expo run:ios --device
```

## Common Mistakes

### ❌ Mistake 1: Only running prebuild
```bash
bunx expo prebuild --clean  # Not enough!
```

**Missing:** pod install + rebuild

### ❌ Mistake 2: Running on simulator
```bash
bunx expo run:ios  # Will build for simulator
```

**Fix:** Add `--device` flag

### ❌ Mistake 3: Using Expo Go
```bash
bunx expo start  # Opens in Expo Go (can't load native modules)
```

**Fix:** Must use development build (`bunx expo run:ios --device`)

## Verify It Worked

After running all 3 steps, check the console when the app launches:

**Before (broken):**
```
[ARKitBodyTracker] Failed to load native module: Error: ...
[BodyTracker] Native module not loaded - returning false
```

**After (working):**
```
[ARKitBodyTracker] Attempting to load native module...
[ARKitBodyTracker] Native module loaded successfully: true
[ARKitBodyTracker] Available methods: ["isSupported", "startTracking", ...]
```

## If Still Not Working

### Check 1: Did pods install?
```bash
ls ios/Pods/Target\ Support\ Files/ | grep ExpoModulesProvider
```

Should show: `ExpoModulesProvider`

### Check 2: Is the app actually rebuilt?
```bash
# Check app build time
ls -lt ios/build/Build/Products/Debug-iphoneos/*.app
```

Build time should be recent (within last few minutes).

### Check 3: Are you running the new build?
- Delete app from device manually
- Run `bunx expo run:ios --device` again
- Watch it install the app

### Check 4: Module exists?
```bash
ls modules/arkit-body-tracker/ios/
```

Should show: `ARKitBodyTrackerModule.swift`

## Nuclear Option

If nothing works:

```bash
# 1. Delete everything
rm -rf ios
rm -rf node_modules
rm -rf .expo

# 2. Reinstall
bun install

# 3. Prebuild
bunx expo prebuild --clean --platform ios

# 4. Install pods
cd ios
pod install
cd ..

# 5. Build and run
bunx expo run:ios --device
```

This will take ~5-10 minutes but guarantees a clean build.
