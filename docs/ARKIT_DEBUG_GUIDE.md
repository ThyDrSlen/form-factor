# ARKit Body Tracking - Debug Guide

## Problem: Static Skeleton Not Updating

If your skeleton appears but doesn't track your body movements, follow this checklist:

---

## Step 1: Check Console Logs

After adding debug logging, run the app and check for these messages:

### Expected Log Sequence:

```
[ARKit] Component mounted, checking support...
[ARKit] Support check result: true
[ARKit] startTracking called
[ARKit] Body tracking is supported, starting session...
[ARKit] Creating new AR session
[ARKit] Running AR session with body tracking configuration
[ARKit] AR session started successfully
[ARKit] Pose data: null  (initially, until body detected)
[ARKit] Body detected! Updating body anchor. Tracked: true
[ARKit] getCurrentPose: Body anchor found, extracting joints...
[ARKit] Pose data: 29 joints
[ARKit] First joint: { name: "root", x: 0.05, y: 0.95, z: -1.2, isTracked: true }
```

### Common Issues:

**If you see:** `Support check result: false`
- **Cause:** Device doesn't support ARKit body tracking
- **Solution:** Requires iPhone XS or newer (A12 Bionic+)

**If you see:** `getCurrentPose: No body anchor available` repeatedly
- **Cause:** ARKit can't detect a body in the camera view
- **Solutions:**
  - Stand 1-3 meters from device
  - Ensure good lighting
  - Make sure entire body is visible
  - Point camera at yourself (back camera)
  - Try moving slowly

**If no ARKit logs appear at all:**
- **Cause:** Native module not loaded
- **Solution:** Rebuild app (see Step 2)

---

## Step 2: Rebuild Native Code

The native Swift module needs to be compiled into the app:

```bash
# Clean and rebuild
cd ios
rm -rf Pods Podfile.lock build
cd ..

# Prebuild with Expo
npx expo prebuild --clean --platform ios

# Install pods
cd ios
pod install
cd ..

# Run on device (ARKit doesn't work in simulator)
npx expo run:ios --device
```

**⚠️ ARKit body tracking ONLY works on physical devices, never in simulator!**

---

## Step 3: Verify Permissions

### Check Camera Permission:

1. When app launches, it should prompt for camera access
2. Grant camera permission
3. If you denied it, go to Settings > Privacy > Camera > form-factor-eas → Enable

### Check Info.plist:

Your `app.json` should have (already configured):

```json
"ios": {
  "infoPlist": {
    "NSCameraUsageDescription": "We need camera access to scan your form...",
  }
}
```

---

## Step 4: Test Device Compatibility

Run this test to verify your device:

```typescript
// Add to scan-arkit.tsx temporarily
useEffect(() => {
  const checkDevice = async () => {
    try {
      const supported = BodyTracker.isSupported();
      console.log('=== DEVICE CHECK ===');
      console.log('Platform:', Platform.OS);
      console.log('ARKit supported:', supported);
      
      if (supported) {
        console.log('✅ Device is compatible');
        console.log('Starting tracking test...');
        await BodyTracker.startTracking();
        console.log('✅ Tracking started');
        
        setTimeout(() => {
          const pose = BodyTracker.getCurrentPose();
          console.log('Pose after 3s:', pose);
          if (!pose) {
            console.warn('⚠️ No body detected. Stand in front of camera.');
          }
        }, 3000);
      } else {
        console.log('❌ Device incompatible');
      }
    } catch (error) {
      console.error('❌ Error:', error);
    }
  };
  
  checkDevice();
}, []);
```

---

## Step 5: Verify Joint Name Matching

The skeleton might not render if joint names don't match. Add this debug:

```typescript
// In scan-arkit.tsx, add to the polling interval:
if (currentPose) {
  console.log('Available joints:', currentPose.joints.map(j => j.name));
  
  // Check if expected joints exist
  const testJoints = ['hips_joint', 'spine_4', 'neck_1', 'left_shoulder'];
  testJoints.forEach(name => {
    const joint = BodyTracker.findJoint(currentPose, name);
    console.log(`Joint ${name}:`, joint ? 'FOUND' : 'MISSING');
  });
}
```

**Expected joint names:**
```
root
hips_joint
spine_1_joint, spine_2_joint, ..., spine_7_joint
neck_1_joint, neck_2_joint, neck_3_joint, neck_4_joint
head_joint
left_shoulder_1_joint, left_arm_joint, left_forearm_joint, left_hand_joint
right_shoulder_1_joint, right_arm_joint, right_forearm_joint, right_hand_joint
left_upLeg_joint, left_leg_joint, left_foot_joint
right_upLeg_joint, right_leg_joint, right_foot_joint
```

If joints have different names (e.g., `leftShoulder` vs `left_shoulder_1_joint`), update the skeleton drawing code to match.

---

## Step 6: Test Coordinate Conversion

The skeleton might be rendering off-screen if coordinate conversion is wrong:

```typescript
// Add to drawLine function:
const drawLine = (from: string, to: string, color: string = '#4C8CFF') => {
  const j1 = findJoint(from);
  const j2 = findJoint(to);
  
  if (j1 && j2 && j1.isTracked && j2.isTracked) {
    const x1 = 0.5 + j1.x / 2;
    const y1 = 0.5 - j1.y / 2;
    const x2 = 0.5 + j2.x / 2;
    const y2 = 0.5 - j2.y / 2;
    
    // Debug first joint conversion
    if (from === 'hips_joint') {
      console.log('Hip joint world space:', j1);
      console.log('Hip joint screen space:', { x1, y1 });
      console.log('Should be 0-1 range. Is it?', x1 >= 0 && x1 <= 1 && y1 >= 0 && y1 <= 1);
    }
    
    return <Line ... />;
  }
};
```

**Expected values:**
- World space: `x: -0.5 to 0.5`, `y: 0 to 2.0`, `z: -2.0 to 0`
- Screen space: `x: 0 to 1`, `y: 0 to 1`

If coordinates are outside 0-1 range, adjust the conversion formula.

---

## Step 7: Test with Simpler Visualization

Replace complex skeleton with basic test:

```typescript
{bodyPose && bodyPose.joints.length > 0 && (
  <View style={StyleSheet.absoluteFill}>
    <Text style={{ color: 'white', fontSize: 24, margin: 20 }}>
      TRACKING: {bodyPose.joints.length} joints detected
    </Text>
    
    {/* Draw just one joint to test */}
    <View
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: 'red',
        transform: [
          { translateX: bodyPose.joints[0].x * 100 },
          { translateY: -bodyPose.joints[0].y * 100 },
        ],
      }}
    />
  </View>
)}
```

If the red dot moves with your body, coordinate conversion is working. If it's stuck, there's a rendering issue.

---

## Step 8: Common Fixes

### Fix 1: ARSession Not Starting

```swift
// In ARKitBodyTrackerModule.swift, verify delegate is set:
self.arSession?.delegate = self  // Must be BEFORE .run()
```

### Fix 2: Body Not Detected

ARKit needs:
- ✅ Physical device (not simulator)
- ✅ Back camera pointed at full body
- ✅ 1-3 meters distance
- ✅ Good lighting
- ✅ Person standing still initially
- ✅ Entire body visible (head to feet)

### Fix 3: Module Not Found

```typescript
// Check if module loads:
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';

console.log('BodyTracker module:', BodyTracker);
console.log('isSupported method:', BodyTracker.isSupported);

// Should print object with methods, not undefined
```

If undefined, module didn't link. Rebuild from Step 2.

### Fix 4: Coordinates Off-Screen

Try different conversion formulas:

```typescript
// Option 1 (current):
const x = 0.5 + joint.x / 2;
const y = 0.5 - joint.y / 2;

// Option 2 (if body appears too small):
const x = 0.5 + joint.x;
const y = 0.5 - joint.y;

// Option 3 (if body appears cut off):
const x = (joint.x + 2) / 4;  // -2 to 2 → 0 to 1
const y = 1 - (joint.y / 2);   // 0 to 2 → 1 to 0
```

---

## Step 9: Known Limitations

### iOS Version Requirements:
- **iOS 17+**: Full 3D tracking (VNDetectHumanBodyPose3DRequest)
- **iOS 14-16**: 2D tracking fallback
- **iOS < 14**: Not supported

### Device Requirements:
- **iPhone 15 Pro**: ✅ Best (LiDAR + A17 Pro)
- **iPhone 12-15**: ✅ Excellent (A14-A16)
- **iPhone XS-11**: ✅ Good (A12-A13)
- **iPhone X or older**: ❌ Not supported

### Environmental Requirements:
- ⚠️ Requires good lighting (ARKit uses camera + ML)
- ⚠️ Plain background helps detection
- ⚠️ Initial detection takes 1-2 seconds
- ⚠️ Occlusion (body parts hidden) reduces accuracy

---

## Step 10: Still Not Working?

Run this comprehensive test:

```typescript
// ComprehensiveTest.tsx
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';

export const runComprehensiveTest = async () => {
  console.log('=== COMPREHENSIVE ARKIT TEST ===');
  
  // Test 1: Module loaded
  console.log('Test 1: Module loaded?', BodyTracker !== undefined);
  
  // Test 2: Support check
  const supported = BodyTracker.isSupported();
  console.log('Test 2: Device supported?', supported);
  
  if (!supported) {
    console.error('STOP: Device incompatible');
    return;
  }
  
  // Test 3: Start tracking
  try {
    await BodyTracker.startTracking();
    console.log('Test 3: Tracking started ✅');
  } catch (error) {
    console.error('Test 3: Failed to start', error);
    return;
  }
  
  // Test 4: Get pose after 5 seconds
  setTimeout(() => {
    const pose = BodyTracker.getCurrentPose();
    console.log('Test 4: Pose data?', pose ? '✅' : '❌');
    
    if (pose) {
      console.log('  - Joints:', pose.joints.length);
      console.log('  - First joint:', pose.joints[0]);
      console.log('  - Tracking?', pose.isTracking);
    } else {
      console.error('  ISSUE: No pose detected after 5s');
      console.error('  - Stand in front of camera');
      console.error('  - Entire body visible');
      console.error('  - 1-3 meters away');
    }
    
    // Test 5: Stop tracking
    BodyTracker.stopTracking();
    console.log('Test 5: Tracking stopped ✅');
  }, 5000);
};
```

Run in your app:
```typescript
import { runComprehensiveTest } from './ComprehensiveTest';

useEffect(() => {
  runComprehensiveTest();
}, []);
```

---

## Quick Checklist

Before asking for help, verify:

- [ ] Running on **physical iPhone XS or newer** (not simulator)
- [ ] **Camera permission granted**
- [ ] App **rebuilt** after adding native module (`npx expo prebuild --clean`)
- [ ] **Pods installed** (`cd ios && pod install`)
- [ ] **Console logs show** ARKit starting successfully
- [ ] **Standing 1-3 meters** from camera
- [ ] **Full body visible** in camera view
- [ ] **Good lighting** in room
- [ ] **Back camera** pointing at you
- [ ] Waited **2-3 seconds** after pressing "Start Tracking"

If all checked and still not working, share your console logs! 📱
