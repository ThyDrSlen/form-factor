# iOS Build & Debug Guide

## 🚨 Current Issues & Fixes

### Issue 1: Duplicate File References

**Error**: `Multiple commands produce conflicting outputs`

**Cause**: Xcode project has duplicate references to build resources.

**Fix**:
```bash
./scripts/fix-ios-build.sh
```

### Issue 2: Missing React Native Headers

**Error**: `folly/Exception.h file not found`

**Cause**: CocoaPods installation is incomplete or corrupted.

**Fix**:
```bash
cd ios
rm -rf Pods Podfile.lock
pod deintegrate
pod install --repo-update
cd ..
```

### Issue 3: Complex Native Module Setup

**Current**: Requires `.m` files and bridging headers.

**Why**: `react-native-vision-camera` frame processors need Objective-C registration.

**Better Solution**: Use ARKit body tracking instead (see `docs/ARKIT_BODY_TRACKING_GUIDE.md`).

## 📱 Screenshot Automation

### One-Time Setup

Install screenshot tool:
```bash
brew install libimobiledevice
```

### Quick Capture

Take a single screenshot:
```bash
./scripts/capture-device-screen.sh
```

This will:
- ✅ Detect your connected iPhone 15 Pro
- 📸 Capture current screen
- 💾 Save to `~/Desktop/ios-screenshots/`
- 📋 Copy to clipboard
- 🖼️ Open the image automatically

### Continuous Monitoring

Watch your device in real-time:
```bash
./scripts/watch-device-screen.sh
```

Options:
- Press ENTER to capture manually
- Auto-capture every 5 seconds
- Screenshots saved with timestamp and counter

### QuickTime Screen Recording (Alternative)

For video debugging:
```bash
# Open QuickTime Player
open -a "QuickTime Player"
# File > New Movie Recording > Camera dropdown > Select iPhone
```

## 🔧 Complete Build Fix Process

### Step 1: Clean Everything
```bash
# Clean iOS build artifacts
rm -rf ios/build
rm -rf ios/Pods
rm -rf ~/Library/Developer/Xcode/DerivedData/formfactoreas-*

# Clean Metro cache
rm -rf node_modules/.cache
rm -rf .expo
```

### Step 2: Reinstall Dependencies
```bash
# Reinstall npm packages
bun install

# Reinstall iOS pods
cd ios
pod deintegrate
pod install --repo-update
cd ..
```

### Step 3: Rebuild iOS Project
```bash
# Clean rebuild with Expo
npx expo prebuild --platform ios --clean

# Or use the automated script
./scripts/fix-ios-build.sh
```

### Step 4: Build in Xcode

```bash
# Open workspace (not .xcodeproj!)
open ios/formfactoreas.xcworkspace
```

In Xcode:
1. Select your iPhone 15 Pro from device dropdown
2. Product > Clean Build Folder (⌘⇧K)
3. Product > Build (⌘B)
4. Product > Run (⌘R)

## 🐛 Common Issues & Solutions

### "No connected devices"

**Problem**: iPhone not detected.

**Solutions**:
1. Check cable connection (use official Apple cable)
2. Trust this computer on iPhone (Settings > General > Device Management)
3. Restart Xcode and iPhone
4. Check: `xcrun xctrace list devices`

### "Code signing required"

**Problem**: Missing development certificate.

**Solution**:
1. Xcode > Preferences > Accounts
2. Add your Apple ID
3. Download development certificate
4. Select your team in project settings

### "Module 'ExpoModulesCore' not found"

**Problem**: Pods not installed correctly.

**Solution**:
```bash
cd ios
pod deintegrate
pod install --repo-update
cd ..
npx expo prebuild --platform ios --clean
```

### "VisionCamera" frame processor errors

**Problem**: Complex frame processor setup.

**Solution**: Use ARKit body tracking instead (see `docs/ARKIT_BODY_TRACKING_GUIDE.md`).

## 📊 Debug Tips

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

## 🎯 Testing on Device

### Build and Run
```bash
# Quick development build
bun run ios --device

# Or in Xcode
# Select device > ⌘R
```

### Install via EAS
```bash
# Create development build
eas build --platform ios --profile development

# Install on device
# Scan QR code from build output
```

## 🔄 Migration to Simplified Vision Setup

If you're tired of the complex `.m` file setup:

1. **Read the guide**:
   ```bash
   cat docs/ARKIT_BODY_TRACKING_GUIDE.md
   ```

2. **Benefits**:
   - ✅ No Objective-C files
   - ✅ No bridging headers
   - ✅ Simpler debugging
   - ✅ Faster builds
   - ✅ Easier CI/CD

3. **Trade-off**: 
   - Frame rate: 30fps → 5-10fps
   - Still sufficient for form feedback!

## 📚 Resources

- [Apple Vision Framework Docs](https://developer.apple.com/documentation/vision)
- [WWDC23: 3D Body Pose](https://developer.apple.com/videos/play/wwdc2023/10176/)
- [Expo Native Modules](https://docs.expo.dev/modules/overview/)
- [iOS Debugging Guide](https://developer.apple.com/documentation/xcode/debugging)

## 🆘 Still Stuck?

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

4. Share outputs in your team chat or GitHub issue

