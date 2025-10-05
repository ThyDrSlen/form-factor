# Debug: "Device Not Supported" on iPhone 15 Pro

iPhone 15 Pro **definitely supports ARKit** (A17 Pro chip). The issue is the native module isn't loading.

## Step 1: Run the App & Check Console

```bash
bunx expo run:ios --device
```

### What to Look For in Console:

**When app launches, you should see:**
```
[ARKitBodyTracker] Attempting to load native module...
[ARKitBodyTracker] Native module loaded successfully: true
[ARKitBodyTracker] Available methods: ["isSupported", "startTracking", ...]
```

**When you navigate to scan-arkit screen:**
```
[BodyTracker] isSupported() called
[BodyTracker] ARKitBodyTracker module exists: true
[BodyTracker] Calling native isSupported()...
[BodyTracker] Native isSupported() returned: true
```

---

## Scenario A: Module Not Loading

**If you see:**
```
[ARKitBodyTracker] Failed to load native module: Error: ...
[BodyTracker] ARKitBodyTracker module exists: false
```

**This means:** Native code wasn't compiled into the app.

**Fix:**
```bash
# Must rebuild native code
bunx expo prebuild --clean --platform ios
cd ios && pod install && cd ..
bunx expo run:ios --device
```

---

## Scenario B: isSupported Returns False

**If you see:**
```
[BodyTracker] ARKitBodyTracker module exists: true
[BodyTracker] Native isSupported() returned: false
```

**This means:** You're running in **simulator** (ARKit doesn't work in simulator).

**Fix:**
```bash
# MUST use physical device
bunx expo run:ios --device

# NOT this (simulator):
bunx expo run:ios
```

---

## Scenario C: Still Showing "Device Not Supported"

**Possible causes:**

### 1. Running an old build
```bash
# Delete app from device
# Then rebuild:
rm -rf ios/build
bunx expo prebuild --clean --platform ios
cd ios && pod install && cd ..
bunx expo run:ios --device
```

### 2. Module not linked in Xcode

Check if module is in Expo modules:
```bash
cd ios
grep -r "ARKitBodyTracker" .
```

Should find references in:
- `Pods/Target Support Files/`
- `ExpoModulesProvider.swift`

If not found, module isn't linked. Rebuild from step 1.

### 3. Wrong iOS version

Check device iOS version:
```
Settings > General > About > Software Version
```

Requires iOS 14.0+. iPhone 15 Pro ships with iOS 17, so this shouldn't be the issue.

### 4. Dev build vs production build

Make sure you're running a development build:
```bash
# Development build (correct)
bunx expo run:ios --device

# NOT expo go (won't work with native modules)
bunx expo start
```

---

## Quick Diagnostic Commands

Run these to verify setup:

```bash
# 1. Check if native module file exists
ls -la modules/arkit-body-tracker/ios/ARKitBodyTrackerModule.swift

# 2. Check if expo module config exists
cat modules/arkit-body-tracker/expo-module.config.json

# 3. Check if iOS project includes the module
cd ios
grep -l "ARKitBodyTracker" Podfile
cd ..

# 4. Verify pod is installed
cd ios
pod list | grep arkit-body-tracker
cd ..
```

---

## Nuclear Option: Complete Clean Rebuild

If nothing works, try this:

```bash
# 1. Clean everything
rm -rf ios
rm -rf node_modules
rm -rf .expo

# 2. Reinstall
bun install

# 3. Prebuild iOS from scratch
bunx expo prebuild --clean --platform ios

# 4. Install pods
cd ios
rm -rf Pods Podfile.lock build
pod install
cd ..

# 5. Run on device
bunx expo run:ios --device
```

---

## What the Logs Tell You

### ✅ Module loaded correctly:
```
[ARKitBodyTracker] Native module loaded successfully: true
[BodyTracker] ARKitBodyTracker module exists: true
[BodyTracker] Native isSupported() returned: true
```
→ Should work! If still showing error, check scan-arkit.tsx logic.

### ❌ Module not loaded:
```
[ARKitBodyTracker] Failed to load native module
```
→ Need to rebuild: `bunx expo prebuild --clean`

### ❌ Module loaded but not supported:
```
[BodyTracker] Native isSupported() returned: false
```
→ Running in simulator. Must use physical device.

---

## Share Your Console Output

Run the app and copy the first 50 lines of console output, especially lines containing:
- `[ARKitBodyTracker]`
- `[BodyTracker]`
- Any errors or warnings

This will tell us exactly what's wrong!
