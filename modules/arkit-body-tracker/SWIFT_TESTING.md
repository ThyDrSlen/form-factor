# Testing Swift Module in Isolation

## Method 1: Quick Test in AppDelegate

**Steps:**
1. Open Xcode workspace:
   ```bash
   open ios/formfactoreas.xcworkspace
   ```

2. Navigate to `AppDelegate.swift` (or `AppDelegate.mm`)

3. Add at the top:
   ```swift
   import ARKit
   ```

4. Add test in `application(_:didFinishLaunchingWithOptions:)`:
   ```swift
   // Test ARKit support
   print("=== ARKit Test ===")
   let supported = ARBodyTrackingConfiguration.isSupported
   print("Body tracking supported: \(supported)")
   print("Device: \(UIDevice.current.model)")
   ```

5. Build and run (⌘R)

6. Check Xcode console for output

---

## Method 2: Unit Tests

**Steps:**
1. Open Xcode workspace:
   ```bash
   open ios/formfactoreas.xcworkspace
   ```

2. Create test target (if doesn't exist):
   - File → New → Target
   - Choose "Unit Testing Bundle"
   - Name: `formfactoreas-Tests`

3. Add test file:
   - Copy `ARKitBodyTrackerModuleTests.swift` to test target
   - Make sure it's added to test target membership

4. Run tests:
   - Product → Test (⌘U)
   - Or click diamond icon next to test functions

5. View results in Test Navigator (⌘6)

---

## Method 3: Swift Playground

**Steps:**
1. Open Xcode workspace

2. Create new playground:
   - File → New → Playground
   - Choose "iOS" → "Blank"
   - Save in `modules/arkit-body-tracker/ios/`

3. Add framework imports:
   ```swift
   import ARKit
   import PlaygroundSupport
   
   // Test ARKit
   ARBodyTrackingConfiguration.isSupported
   ```

4. Run playground (⌘⇧↩)

**Note:** Playgrounds don't have camera access, so you can only test API availability

---

## Method 4: Standalone Console App

**Steps:**
1. Create new Xcode project:
   - File → New → Project
   - macOS → Command Line Tool
   - Name: `ARKitTest`

2. Copy module Swift code

3. Replace AppKit with UIKit simulator

4. Test individual functions

---

## Method 5: Debug Directly in Xcode

**Best for debugging the actual module in your app:**

1. Open workspace:
   ```bash
   open ios/formfactoreas.xcworkspace
   ```

2. Find `ARKitBodyTrackerModule.swift` in Project Navigator

3. Set breakpoints in:
   - `isSupported()` function
   - `startTracking()` function
   - `getCurrentPose()` function

4. Build and run (⌘R)

5. In your React Native app, navigate to the ARKit screen

6. Debugger will pause at breakpoints

7. Inspect variables in Debug Area (⌘⇧Y)

---

## Quick Verification Script

Run this to check if module is properly linked:

```bash
cd ios
grep -r "ARKitBodyTracker" . --include="*.pbxproj"
```

Should show the module files in the Xcode project.

---

## Troubleshooting

### Module not found in Xcode
```bash
# Regenerate project
cd ..
npx expo prebuild --platform ios --clean
```

### Can't import ARKit
- Check deployment target is iOS 13.0+
- Verify running on device or iOS 13+ simulator

### Tests fail with "not supported"
- Normal in simulator (no camera)
- Test on real device for full testing

---

## Expected Behavior

**On Simulator:**
- `isSupported()` → `false` (no camera/sensors)
- Module should still load without errors

**On iPhone XS or newer:**
- `isSupported()` → `true`
- Can start tracking and get poses

**On older iPhones:**
- `isSupported()` → `false`
- Module loads but tracking unavailable
