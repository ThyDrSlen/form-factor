# ARKit Body Tracker - Expo Module

Expo module for ARKit 3D body tracking using Apple's official APIs.

## Features

- ✅ Real-world 3D coordinates in meters
- ✅ 91 tracked joints (full body, hands, spine)
- ✅ Continuous tracking at 30-60 FPS
- ✅ Built-in angle and distance calculations
- ✅ Automatic LiDAR integration on supported devices
- ✅ Session interruption handling

## Requirements

- **iOS**: 13.0+
- **Device**: iPhone XS or newer (A12 Bionic+)
- **Optimal**: iPhone 13 Pro+ with LiDAR

## Installation

This is a local Expo module. To use it:

1. Ensure `expo-module.config.json` exists
2. Add plugin to `app.json`:
   ```json
   {
     "plugins": ["./plugins/withARKitBodyTracker"]
   }
   ```
3. Prebuild:
   ```bash
   npx expo prebuild --platform ios --clean
   ```

## Usage

### Check Support

```typescript
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';

const supported = BodyTracker.isSupported();
```

### Start Tracking

```typescript
await BodyTracker.startTracking();

const interval = setInterval(() => {
  const pose = BodyTracker.getCurrentPose();
  
  if (pose) {
    console.log(`Tracking ${pose.joints.length} joints`);
    console.log(`Estimated height: ${pose.estimatedHeight}m`);
  }
}, 33); // 30 FPS
```

### Calculate Angles

```typescript
const hip = BodyTracker.findJoint(pose, 'left_upLeg');
const knee = BodyTracker.findJoint(pose, 'left_leg');
const ankle = BodyTracker.findJoint(pose, 'left_foot');

const kneeAngle = BodyTracker.calculateAngle(hip, knee, ankle);
console.log(`Knee angle: ${kneeAngle.toFixed(1)}°`);
```

### Stop Tracking

```typescript
BodyTracker.stopTracking();
```

## API Reference

### Types

```typescript
interface Joint3D {
  name: string;
  x: number;      // Meters in world space
  y: number;      // Meters in world space
  z: number;      // Meters in world space
  isTracked: boolean;
}

interface BodyPose {
  joints: Joint3D[];
  timestamp: number;
  isTracking: boolean;
  estimatedHeight?: number;
}

interface JointAngles {
  leftKnee: number;
  rightKnee: number;
  leftElbow: number;
  rightElbow: number;
  leftHip: number;
  rightHip: number;
  leftShoulder: number;
  rightShoulder: number;
}
```

### Methods

#### `BodyTracker.isSupported(): boolean`

Checks if ARBodyTrackingConfiguration is supported on the device.

#### `BodyTracker.startTracking(): Promise<void>`

Starts ARKit body tracking session.

**Throws:** Error if device doesn't support body tracking

#### `BodyTracker.getCurrentPose(): BodyPose | null`

Gets the current body pose with all tracked joints.

**Returns:** Current pose or `null` if no body detected

#### `BodyTracker.stopTracking(): void`

Stops the body tracking session.

#### `BodyTracker.calculateAngle(j1, j2, j3): number`

Calculates angle at joint `j2` formed by joints `j1` and `j3`.

**Parameters:**
- `j1`: First joint (e.g., hip)
- `j2`: Middle joint (e.g., knee) - vertex of angle
- `j3`: Third joint (e.g., ankle)

**Returns:** Angle in degrees (0-180)

#### `BodyTracker.getJointDistance(j1, j2): number`

Calculates 3D distance between two joints.

**Returns:** Distance in meters

#### `BodyTracker.findJoint(pose, name): Joint3D | undefined`

Helper to find a joint by name (case-insensitive partial match).

#### `BodyTracker.calculateAllAngles(pose): JointAngles | null`

Calculates all major joint angles for fitness tracking.

#### `BodyTracker.getSquatDepth(pose): number | null`

Calculates squat depth (hip to knee distance).

**Returns:** Depth in meters or `null`

#### `BodyTracker.checkSymmetry(left, right, threshold): boolean`

Checks if left and right angles are symmetric within threshold.

**Parameters:**
- `threshold`: Max acceptable difference in degrees (default: 10)

## Joint Names

ARKit provides 91 joints. Key joints include:

### Core Joints
- `root` - Body root
- `hips_joint` - Hip center
- `spine_1_joint` through `spine_7_joint` - Spine segments
- `neck_1_joint` through `neck_4_joint` - Neck segments
- `head_joint` - Head

### Arms
- `left_shoulder_1_joint`, `right_shoulder_1_joint`
- `left_arm_joint`, `right_arm_joint` (upper arm)
- `left_forearm_joint`, `right_forearm_joint`
- `left_hand_joint`, `right_hand_joint`

### Legs
- `left_upLeg_joint`, `right_upLeg_joint` (thigh)
- `left_leg_joint`, `right_leg_joint` (shin)
- `left_foot_joint`, `right_foot_joint`

### Hands (detailed)
Each hand has thumb, index, middle, ring, and pinky joints.

## Coordinate System

Joints are in world space (meters):

- **X-axis**: Left (-) to Right (+)
- **Y-axis**: Down (-) to Up (+)
- **Z-axis**: Forward (-) to Backward (+)

**Example:**
```typescript
{
  x: 0.05,   // 5cm to the right
  y: 1.20,   // 1.2m above ground
  z: -0.30   // 30cm forward
}
```

## Performance Tips

1. **Frame rate**: Use 30 FPS for balance of smoothness and battery
2. **Polling**: Poll via `setInterval`, don't rely on callbacks
3. **Cleanup**: Always stop tracking when done
4. **Background**: Stop tracking when app backgrounds

## Example: Squat Tracker

```typescript
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';

function SquatTracker() {
  const [reps, setReps] = useState(0);
  const [isDown, setIsDown] = useState(false);
  
  useEffect(() => {
    BodyTracker.startTracking();
    
    const interval = setInterval(() => {
      const pose = BodyTracker.getCurrentPose();
      if (!pose) return;
      
      const angles = BodyTracker.calculateAllAngles(pose);
      if (!angles) return;
      
      const avgKneeAngle = (angles.leftKnee + angles.rightKnee) / 2;
      
      // Detect squat down
      if (avgKneeAngle < 90 && !isDown) {
        setIsDown(true);
      }
      
      // Detect squat up
      if (avgKneeAngle > 160 && isDown) {
        setIsDown(false);
        setReps(prev => prev + 1);
      }
    }, 33);
    
    return () => {
      clearInterval(interval);
      BodyTracker.stopTracking();
    };
  }, [isDown]);
  
  return <Text>Squats: {reps}</Text>;
}
```

## Troubleshooting

### "ARKit body tracking not supported"

- Ensure device is iPhone XS or newer
- Check iOS version is 13.0+
- Cannot run in simulator

### Poor tracking quality

- Ensure good lighting
- Stand 1.5-3m from device
- Show full body in frame
- Use device with LiDAR if available

### High battery drain

- Reduce polling frequency to 20-30 FPS
- Stop tracking when not needed
- Avoid continuous tracking for extended periods

## Architecture

```
┌─────────────────────────────────────┐
│  React Native / Expo App            │
│  (TypeScript)                       │
└────────────┬────────────────────────┘
             │
             │ requireNativeModule
             ▼
┌─────────────────────────────────────┐
│  ARKitBodyTracker.ts                │
│  (TypeScript wrapper + helpers)     │
└────────────┬────────────────────────┘
             │
             │ Expo Modules Core
             ▼
┌─────────────────────────────────────┐
│  ARKitBodyTrackerModule.swift       │
│  (Native Swift module)              │
└────────────┬────────────────────────┘
             │
             │ ARKit APIs
             ▼
┌─────────────────────────────────────┐
│  ARSession                          │
│  ARBodyTrackingConfiguration        │
│  ARBodyAnchor                       │
│  ARSkeleton3D                       │
└─────────────────────────────────────┘
```

## License

MIT

## Contributing

Issues and PRs welcome!

## References

- [ARKit Documentation](https://developer.apple.com/documentation/arkit)
- [ARBodyTrackingConfiguration](https://developer.apple.com/documentation/arkit/arbodytrackingconfiguration)
- [WWDC 2019: Tracking Human Body Poses](https://developer.apple.com/videos/play/wwdc2019/607/)
