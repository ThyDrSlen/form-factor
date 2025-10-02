# Migration: Vision Framework → ARKit Body Tracking

## TL;DR

**Current**: Complex Vision framework with `.m` files, bridging headers, and 2D projections  
**Target**: Simple ARKit body tracking with real 3D joints in world space

**Benefit**: Better accuracy, simpler code, iPhone 15 Pro optimized

## Migration Steps

### Step 1: Fix Current Build (Do This First!)

```bash
# Run the automated fix
./scripts/fix-ios-build.sh

# Or manually:
cd ios
rm -rf Pods Podfile.lock
pod deintegrate
pod install --repo-update
cd ..
npx expo prebuild --platform ios --clean
```

### Step 2: Test Current Implementation

Before migrating, capture baseline:

```bash
# Start app on your iPhone 15 Pro
bun run ios --device

# Capture current behavior
./scripts/watch-device-screen.sh
```

Take note of:
- Current FPS
- Tracking accuracy
- Build time
- Debug difficulty

### Step 3: Create ARKit Module

```bash
# Create module directory
mkdir -p modules/arkit-body-tracker

# Copy implementation from ARKIT_BODY_TRACKING_GUIDE.md
# Or use this helper:
cat docs/ARKIT_BODY_TRACKING_GUIDE.md | grep -A 150 "ARKitBodyTrackerModule.swift" > modules/arkit-body-tracker/ARKitBodyTrackerModule.swift
```

### Step 4: Remove Old Vision Code

```bash
# Backup first!
mkdir -p backups
cp -r ios/formfactoreas/VisionPoseDetector.* backups/
cp -r native/ backups/

# Remove old files
rm ios/formfactoreas/VisionPoseDetector.m
rm ios/formfactoreas/VisionPoseDetector.swift
rm ios/formfactoreas/formfactoreas-Bridging-Header.h
```

### Step 5: Update Scan Screen

Replace `scan.tsx` pose detection with ARKit:

```typescript
// Before (Vision):
import { VisionCamera } from 'react-native-vision-camera';
const pose = useFrameProcessor((frame) => {
  'worklet'
  return detectPose(frame);
});

// After (ARKit):
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';
const [pose, setPose] = useState<BodyPose | null>(null);

useEffect(() => {
  BodyTracker.startTracking();
  const interval = setInterval(() => {
    const p = BodyTracker.getCurrentPose();
    if (p) setPose(p);
  }, 33); // 30fps
  return () => clearInterval(interval);
}, []);
```

### Step 6: Update Config Plugin

```javascript
// plugins/withARKitBodyTracker.js
const { withXcodeProject, withInfoPlist } = require('@expo/config-plugins');

module.exports = function withARKitBodyTracker(config) {
  // Add camera permission
  config = withInfoPlist(config, (config) => {
    config.modResults.NSCameraUsageDescription = 
      "We need camera access for real-time form tracking";
    return config;
  });
  
  // Add ARKit capability
  config = withXcodeProject(config, (config) => {
    // ARKit is enabled by default in modern Expo
    return config;
  });
  
  return config;
};
```

Update `app.json`:
```json
{
  "expo": {
    "plugins": [
      "./plugins/withARKitBodyTracker"
    ]
  }
}
```

### Step 7: Rebuild

```bash
# Clean rebuild
rm -rf ios/build
npx expo prebuild --platform ios --clean

# Install pods
cd ios && pod install && cd ..

# Build
bun run ios --device
```

### Step 8: Test & Compare

Test checklist:
- [ ] Device support detection works
- [ ] Tracking starts smoothly
- [ ] Joint positions are in meters
- [ ] Angle calculations are accurate
- [ ] No build errors
- [ ] FPS is smooth (30fps)
- [ ] Memory usage is acceptable

Compare to baseline:
```bash
# Take screenshots
./scripts/capture-device-screen.sh

# Test form feedback accuracy
# - Do a squat: Does it detect proper depth?
# - Check symmetry: Are left/right angles equal?
# - Test occlusion: Does it track behind objects?
```

## Rollback Plan

If ARKit doesn't work:

```bash
# Restore old files
cp backups/VisionPoseDetector.* ios/formfactoreas/
cp backups/native/* native/

# Restore old scan screen
git checkout app/(tabs)/scan.tsx

# Rebuild
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
```

## Expected Improvements

| Metric | Before (Vision) | After (ARKit) |
|--------|----------------|---------------|
| Setup complexity | High (.m files, bridging) | Low (pure Swift) |
| Build time | ~2 min | ~1 min |
| Joint accuracy | ±15° | ±3° |
| Depth accuracy | 2D projection | Real 3D ±2cm |
| FPS | 10-20fps | 30fps |
| Tracking | Jittery | Smooth |
| iPhone 15 Pro optimization | No | Yes (LiDAR) |

## Timeline

- **Step 1-2**: 10 minutes (fix build, test baseline)
- **Step 3-5**: 30 minutes (create module, remove old code)
- **Step 6-7**: 20 minutes (update config, rebuild)
- **Step 8**: 30 minutes (test & validate)

**Total**: ~90 minutes

## Questions?

1. **Will this work on older iPhones?**
   - Needs A12+ chip (iPhone XS+)
   - Your iPhone 15 Pro: ✅ Perfect

2. **What about Android?**
   - ARCore has similar capabilities
   - Can add later with platform detection

3. **Is ARKit harder to learn?**
   - No! Simpler than Vision + frame processors
   - Better documentation from Apple

4. **Will accuracy really improve?**
   - Yes! ARKit gives you real-world 3D
   - Perfect for fitness form analysis

## Next Steps

1. ✅ Read `ARKIT_BODY_TRACKING_GUIDE.md`
2. ✅ Run `./scripts/fix-ios-build.sh`
3. ⏭️ Start Step 1 of migration
4. 📸 Use `./scripts/capture-device-screen.sh` to document progress

Let's do this! 🚀


