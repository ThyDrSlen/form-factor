# ARKit Body Tracker Architecture

## 🏗️ System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Native App                              │
│                  (app/(tabs)/scan-arkit.tsx)                     │
│                                                                   │
│  import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker'     │
│  BodyTracker.isSupported()  ← You call this                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │ Metro bundler resolves import
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              TypeScript Wrapper Layer                            │
│         lib/arkit/ARKitBodyTracker.ios.ts                       │
│                                                                   │
│  import { requireNativeModule } from 'expo-modules-core'        │
│  const ARKitBodyTracker = requireNativeModule('ARKitBodyTracker')│
│                          ▲                                        │
│                          │ Looks up by name                      │
└──────────────────────────┼───────────────────────────────────────┘
                           │
                           │ Expo Modules Core bridge
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Expo Module Registry                             │
│              (Auto-discovery via autolinking)                    │
│                                                                   │
│  Scans: modules/arkit-body-tracker/                             │
│    ├─ package.json          ← Marks it as a package             │
│    ├─ expo-module.config.json ← Declares iOS platform           │
│    └─ ios/                                                       │
│        └─ ARKitBodyTrackerModule.swift                          │
│                          ▲                                        │
│                          │ Registers with name                   │
└──────────────────────────┼───────────────────────────────────────┘
                           │
                           │ Module name: "ARKitBodyTracker"
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Native Swift Module                            │
│        ios/ARKitBodyTrackerModule.swift                         │
│                                                                   │
│  public class ARKitBodyTrackerModule: Module {                  │
│    public func definition() -> ModuleDefinition {               │
│      Name("ARKitBodyTracker")  ← THIS NAME MUST MATCH          │
│                                                                   │
│      Function("isSupported") { () -> Bool in                    │
│        return ARBodyTrackingConfiguration.isSupported           │
│      }                           ▲                               │
│    }                             │                               │
│  }                               │ Uses Apple's ARKit            │
└──────────────────────────────────┼───────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Apple ARKit Framework                       │
│                                                                   │
│  ARBodyTrackingConfiguration                                    │
│  ARSession                                                       │
│  ARBodyAnchor                                                    │
│  ARSkeleton3D                                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📞 Call Flow: TypeScript → Swift

```
USER CALLS:                  BodyTracker.isSupported()
                                      │
                                      ▼
TYPESCRIPT WRAPPER:          ARKitBodyTracker.isSupported()
  (ARKitBodyTracker.ios.ts)           │
                                      │ JSI Bridge
                                      ▼
EXPO MODULES CORE:           [Looks up "ARKitBodyTracker"]
                                      │
                                      │ Finds registered module
                                      ▼
SWIFT MODULE:                ARKitBodyTrackerModule
  (Module.swift)                      │
                                      │ Calls Function("isSupported")
                                      ▼
SWIFT FUNCTION:              return ARBodyTrackingConfiguration.isSupported
                                      │
                                      │ Apple's ARKit API
                                      ▼
APPLE ARKIT:                 Checks hardware capabilities
                                      │
                                      │ Returns Bool
                                      ▼
                             true or false
                                      │
                                      │ Back through bridge
                                      ▼
TYPESCRIPT:                  returns boolean to your app
```

---

## 📁 File Structure & Responsibilities

```
form-factor-eas/
│
├── app/(tabs)/
│   └── scan-arkit.tsx          ← YOUR APP CODE
│       └── Calls: BodyTracker.isSupported()
│
├── lib/arkit/
│   ├── ARKitBodyTracker.ios.ts ← TYPESCRIPT WRAPPER (iOS)
│   │   └── requireNativeModule('ARKitBodyTracker')
│   │
│   ├── ARKitBodyTracker.web.ts ← TYPESCRIPT STUB (Web)
│   │   └── Throws "not supported" on web
│   │
│   └── ARKitBodyTracker.ts     ← DEFAULT EXPORT
│       └── Metro auto-picks .ios.ts or .web.ts
│
├── modules/arkit-body-tracker/  ← LOCAL EXPO MODULE
│   ├── package.json             ← Makes it discoverable
│   │   └── "name": "arkit-body-tracker"
│   │
│   ├── expo-module.config.json  ← Platform declaration
│   │   └── "platforms": ["ios"]
│   │
│   ├── index.ts                 ← Empty (native-only module)
│   │
│   └── ios/
│       └── ARKitBodyTrackerModule.swift  ← NATIVE CODE
│           └── Name("ARKitBodyTracker")  ← Registration name
│
└── package.json                 ← Links local module
    └── "arkit-body-tracker": "file:./modules/arkit-body-tracker"
```

---

## 🔍 How Module Discovery Works

### 1. **Autolinking Discovery** (During `expo prebuild`)

```
expo prebuild
     │
     ├─ Scans package.json dependencies
     │  └─ Finds: "arkit-body-tracker": "file:./modules/..."
     │
     ├─ Checks: modules/arkit-body-tracker/expo-module.config.json
     │  └─ Sees: "platforms": ["ios"]
     │
     └─ Adds to ios/Podfile:
        pod 'arkit-body-tracker', :path => '../modules/arkit-body-tracker'
```

### 2. **Runtime Registration** (When app launches)

```
App Launches
     │
     ├─ Expo Modules Core initializes
     │  └─ Scans all pods with expo-module.config.json
     │
     ├─ Finds ARKitBodyTrackerModule.swift
     │  └─ Reads: Name("ARKitBodyTracker")
     │
     └─ Registers in module registry:
        "ARKitBodyTracker" → ARKitBodyTrackerModule instance
```

### 3. **Module Lookup** (When you call it)

```
requireNativeModule('ARKitBodyTracker')
     │
     ├─ Searches module registry
     │  └─ Key: "ARKitBodyTracker"
     │
     ├─ Finds: ARKitBodyTrackerModule instance
     │  └─ Returns: JavaScript proxy object
     │
     └─ Your TypeScript code can now call:
        - ARKitBodyTracker.isSupported()
        - ARKitBodyTracker.startTracking()
        - etc.
```

---

## 🧪 Testing Options Explained

### **Option 1: Full Stack Test** (What you're doing now)
```
React Native App → TypeScript → Bridge → Swift → ARKit
                   [Tests entire flow]
```
**Pros:** Tests real integration  
**Cons:** Hard to debug, requires full rebuild

---

### **Option 2: Xcode Direct Test** (Recommended)
```
Xcode Debugger → Swift → ARKit
                [Skips JS layer]
```
**How:**
1. `bun run test:swift` (opens Xcode)
2. Set breakpoint in ARKitBodyTrackerModule.swift line 32
3. Run app (⌘R)
4. Navigate to ARKit screen
5. Breakpoint hits → inspect variables

**Pros:** See exact Swift values  
**Cons:** Still need app running

---

### **Option 3: Swift Unit Tests** (Fastest)
```
XCTest → Swift Module Functions
        [No app needed]
```
**How:**
1. Open Xcode
2. Press ⌘U (run tests)
3. See results instantly

**Pros:** Fast, isolated  
**Cons:** Can't test ARKit hardware (no camera in tests)

---

### **Option 4: Console Test** (Quick verification)
```
AppDelegate → Swift function → Print to console
             [One function call]
```
**How:**
Add to AppDelegate.swift:
```swift
ARKitTest.testBodyTrackingSupport()
```

**Pros:** Quick, no test setup  
**Cons:** Manual, not automated

---

## 🎯 Current Problem: Module Not Found

```
ERROR: requireNativeModule('ARKitBodyTracker')
       └─ Module registry lookup FAILS
          └─ Why?

Possible causes:
1. ❌ Module not registered (prebuild didn't run)
2. ❌ Name mismatch (TypeScript vs Swift)
3. ❌ Module not compiled into app
4. ❌ Metro cache has old code
```

**The fix we did:**
```
✅ Fixed expo-module.config.json
✅ Created package.json for module
✅ Linked in main package.json
✅ Cleared Metro cache
✅ Ran prebuild to regenerate iOS project
✅ Rebuilt app
```

---

## 🔑 Key Concept: Name Matching

**These MUST match exactly:**

```typescript
// TypeScript side
requireNativeModule('ARKitBodyTracker')
                    └────────┬────────┘
                             │
                             │ This string...
                             ▼
```

```swift
// Swift side
Name("ARKitBodyTracker")  ← ...must match this!
     └────────┬────────┘
              │
              └─ Registration name in module registry
```

If they don't match → "Cannot find native module" error!

---

## 📊 Debugging Checklist

```
□ Module file exists: modules/arkit-body-tracker/ios/ARKitBodyTrackerModule.swift
□ Module has Name("ARKitBodyTracker") in definition
□ package.json links module: "arkit-body-tracker": "file:..."
□ expo-module.config.json exists
□ Ran: npx expo prebuild --platform ios --clean
□ Rebuilt app with: bun run ios
□ Metro cache cleared
□ TypeScript imports from correct path
□ No typos in module name
```

---

## 🚀 Next Steps for Debugging

### See if module is registered:
```bash
# View iOS logs in real-time
bun run logs:ios

# Look for:
# [ARKitBodyTracker] Attempting to load native module...
# [ARKitBodyTracker] Native module loaded successfully: true
```

### Debug in Xcode:
```bash
bun run test:swift
# Set breakpoint at line 32 in isSupported()
# Run app (⌘R)
# Does breakpoint hit? → Module is registered ✅
# Doesn't hit? → Module not found ❌
```
