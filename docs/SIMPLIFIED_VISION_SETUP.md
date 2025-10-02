# Simplified Apple Vision Framework Setup

## Why Simplify?

The current setup uses `react-native-vision-camera` with custom frame processors, which requires:
- Complex Objective-C bridge files (.m)
- Manual Xcode project modifications
- Bridging headers
- CocoaPods integration challenges

**Better approach**: Use Expo's native module system with a simpler Swift-only implementation.

## Option 1: Expo Config Plugin (Recommended for MVP)

Use Expo's built-in camera with a simpler native module:

```typescript
// lib/vision/SimplePoseDetector.ts
import { NativeModules } from 'react-native';

const { SimplePoseDetector } = NativeModules;

export interface Joint3D {
  name: string;
  x: number;
  y: number;
  z: number;
  confidence: number;
}

export interface PoseResult {
  joints: Joint3D[];
  timestamp: number;
  is3D: boolean;
}

export async function detectPoseInImage(
  imageUri: string
): Promise<PoseResult | null> {
  try {
    return await SimplePoseDetector.detectPose(imageUri);
  } catch (error) {
    console.error('Pose detection failed:', error);
    return null;
  }
}
```

### Swift Implementation (Cleaner)

```swift
// ios/SimplePoseDetectorModule.swift
import ExpoModulesCore
import Vision
import CoreImage

public class SimplePoseDetectorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SimplePoseDetector")
    
    AsyncFunction("detectPose") { (imageUri: String) -> [String: Any]? in
      return self.detectPose(from: imageUri)
    }
  }
  
  private func detectPose(from imageUri: String) -> [String: Any]? {
    guard let url = URL(string: imageUri),
          let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
      return nil
    }
    
    // Use VNDetectHumanBodyPose3DRequest for iOS 17+
    if #available(iOS 17.0, *) {
      return detect3DPose(cgImage: cgImage)
    } else {
      return detect2DPose(cgImage: cgImage)
    }
  }
  
  @available(iOS 17.0, *)
  private func detect3DPose(cgImage: CGImage) -> [String: Any]? {
    let request = VNDetectHumanBodyPose3DRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    
    do {
      try handler.perform([request])
      guard let observation = request.results?.first else { return nil }
      
      var joints: [[String: Any]] = []
      let jointNames: [VNHumanBodyPose3DObservation.JointName] = [
        .root, .rightHip, .rightKnee, .rightAnkle,
        .leftHip, .leftKnee, .leftAnkle,
        .spine, .centerShoulder, .centerHead, .topHead,
        .leftShoulder, .leftElbow, .leftWrist,
        .rightShoulder, .rightElbow, .rightWrist
      ]
      
      for jointName in jointNames {
        if let point = try? observation.recognizedPoint(jointName) {
          let position = point.localPosition.columns.3
          joints.append([
            "name": "\(jointName)",
            "x": Double(position.x) + 0.5,
            "y": 0.5 - Double(position.y),
            "z": Double(position.z),
            "confidence": 0.9
          ])
        }
      }
      
      return [
        "joints": joints,
        "timestamp": Date().timeIntervalSince1970,
        "is3D": true
      ]
    } catch {
      return nil
    }
  }
  
  private func detect2DPose(cgImage: CGImage) -> [String: Any]? {
    // 2D fallback implementation
    let request = VNDetectHumanBodyPoseRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    
    do {
      try handler.perform([request])
      guard let observation = request.results?.first else { return nil }
      
      var joints: [[String: Any]] = []
      let allPoints = try observation.recognizedPoints(.all)
      
      for (jointName, point) in allPoints where point.confidence > 0.3 {
        joints.append([
          "name": "\(jointName)",
          "x": Double(point.location.x),
          "y": 1.0 - Double(point.location.y),
          "z": 0.0,
          "confidence": Double(point.confidence)
        ])
      }
      
      return [
        "joints": joints,
        "timestamp": Date().timeIntervalSince1970,
        "is3D": false
      ]
    } catch {
      return nil
    }
  }
}
```

### Expo Config Plugin

```javascript
// plugins/withSimplePoseDetector.js
const { withXcodeProject } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

module.exports = function withSimplePoseDetector(config) {
  return withXcodeProject(config, async (config) => {
    const modulePath = path.join(
      config.modRequest.projectRoot,
      'modules/simple-pose-detector'
    );
    
    // Ensure module directory exists
    if (!fs.existsSync(modulePath)) {
      fs.mkdirSync(modulePath, { recursive: true });
    }
    
    // Copy Swift file
    const swiftContent = `// See SIMPLIFIED_VISION_SETUP.md for implementation`;
    fs.writeFileSync(
      path.join(modulePath, 'SimplePoseDetectorModule.swift'),
      swiftContent
    );
    
    return config;
  });
};
```

### app.json Configuration

```json
{
  "expo": {
    "plugins": [
      [
        "./plugins/withSimplePoseDetector.js"
      ]
    ]
  }
}
```

## Option 2: Use Expo Camera with Image Capture

Even simpler - use Expo Camera to capture frames, save to temp file, then process:

```typescript
// In your scan screen
import { Camera } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import { detectPoseInImage } from '@/lib/vision/SimplePoseDetector';

// Capture frame
const photo = await camera.takePictureAsync({
  quality: 0.7,
  skipProcessing: true,
});

// Detect pose
const pose = await detectPoseInImage(photo.uri);
```

## Benefits of Simplified Approach

1. **No Objective-C**: Pure Swift with Expo modules
2. **No Bridging Headers**: Expo handles the bridge automatically  
3. **No Manual Xcode Edits**: Config plugin handles everything
4. **Easier Debugging**: Clear error messages and stack traces
5. **Better Performance**: Direct image processing instead of frame-by-frame

## Migration Steps

1. Remove `react-native-vision-camera` dependency
2. Remove current `VisionPoseDetector.m` and `VisionPoseDetector.swift`
3. Create Expo module as shown above
4. Update `scan.tsx` to use new API
5. Run `npx expo prebuild --clean`

## Performance Comparison

| Approach | Pros | Cons |
|----------|------|------|
| Current (Frame Processor) | Real-time 30fps | Complex setup, hard to debug |
| Simplified (Image Capture) | Simple, reliable | ~5-10fps (still sufficient for form feedback) |

For MVP and form feedback, 5-10fps is perfectly adequate!

