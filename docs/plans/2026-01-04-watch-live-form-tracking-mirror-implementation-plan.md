# Watch Live Form Tracking Mirror (Hybrid) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Re-enable iPhone ↔︎ Apple Watch connectivity and mirror live form-tracking state (plus a low-FPS camera preview) on a 2-screen watch app: **Mirror** + **Metrics**.

**Architecture:** Add a small iOS Expo native module wrapping `WCSession` for bi-directional messaging + status events. Provide a `lib/watch-connectivity.ios.ts` wrapper to match existing call sites. Extend `app/(tabs)/scan-arkit.tsx` to publish structured tracking payloads (throttled) and keep the existing frame snapshot mirroring. Update the existing SwiftUI watch app to render Mirror and Metrics screens using the mirrored tracking payload.

**Tech Stack:** Expo SDK 54, Expo Modules (`expo-modules-core`), Swift (`WatchConnectivity`), SwiftUI (watchOS), React Native / Expo Router.

---

### Task 1: Add a new Expo module scaffold (`ff-watch-connectivity`)

**Files:**
- Create: `modules/ff-watch-connectivity/package.json`
- Create: `modules/ff-watch-connectivity/expo-module.config.json`
- Create: `modules/ff-watch-connectivity/ff-watch-connectivity.podspec`
- Create: `modules/ff-watch-connectivity/index.ts`
- Create: `modules/ff-watch-connectivity/ios/FFWatchConnectivityModule.swift`
- Modify: `package.json`

**Step 1: Create module package metadata**

Create `modules/ff-watch-connectivity/package.json`:
```json
{
  "name": "ff-watch-connectivity",
  "version": "0.1.0",
  "main": "index.ts",
  "license": "MIT",
  "private": true,
  "peerDependencies": {
    "expo": "*",
    "react": "*",
    "react-native": "*"
  },
  "devDependencies": {
    "expo-modules-core": "*"
  }
}
```

**Step 2: Add Expo module config**

Create `modules/ff-watch-connectivity/expo-module.config.json`:
```json
{
  "name": "ff-watch-connectivity",
  "platforms": ["apple"],
  "apple": {
    "modules": ["FFWatchConnectivityModule"],
    "podspecPath": "ff-watch-connectivity.podspec"
  }
}
```

**Step 3: Add podspec**

Create `modules/ff-watch-connectivity/ff-watch-connectivity.podspec`:
```ruby
require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ff-watch-connectivity'
  s.version        = package['version']
  s.summary        = package['description'] || 'WatchConnectivity bridge for Form Factor'
  s.description    = package['description'] || 'Expo module wrapping WCSession messaging and state'
  s.license        = package['license']
  s.author         = package['author'] || 'Form Factor'
  s.homepage       = package['homepage'] || 'https://github.com/slenthekid/form-factor'
  s.platforms      = { :ios => '14.0' }
  s.swift_version  = '5.4'
  s.source         = { :path => '.' }
  s.module_name    = 'ff_watch_connectivity'
  s.static_framework = true

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity'

  s.source_files = [
    'ios/FFWatchConnectivityModule.swift'
  ]

  s.preserve_paths = ['*.podspec', 'expo-module.config.json']
end
```

**Step 4: Add a minimal `index.ts`**

Create `modules/ff-watch-connectivity/index.ts`:
```ts
export {};
```

**Step 5: Add module dependency**

Modify `package.json` dependencies to include:
```json
"ff-watch-connectivity": "file:modules/ff-watch-connectivity"
```

**Step 6: Install deps**

Run: `bun install`
Expected: `bun.lock` updates (local workspace package linked).

---

### Task 2: Implement the iOS native module (`WCSession`) + events

**Files:**
- Modify: `modules/ff-watch-connectivity/ios/FFWatchConnectivityModule.swift`

**Step 1: Define event names + module name**

Use these event names (namespaced to avoid collisions):
- `FFWatchConnectivity.message`
- `FFWatchConnectivity.reachability`
- `FFWatchConnectivity.paired`
- `FFWatchConnectivity.installed`

**Step 2: Implement module skeleton**

Create `modules/ff-watch-connectivity/ios/FFWatchConnectivityModule.swift`:
```swift
import ExpoModulesCore
import Foundation
import WatchConnectivity

public final class FFWatchConnectivityModule: Module, WCSessionDelegate {
  private let session: WCSession? = WCSession.isSupported() ? WCSession.default : nil
  private let moduleEventPrefix = "FFWatchConnectivity"

  private var eventMessage: String { "\(moduleEventPrefix).message" }
  private var eventReachability: String { "\(moduleEventPrefix).reachability" }
  private var eventPaired: String { "\(moduleEventPrefix).paired" }
  private var eventInstalled: String { "\(moduleEventPrefix).installed" }

  public func definition() -> ModuleDefinition {
    Name("FFWatchConnectivity")
    Events(eventMessage, eventReachability, eventPaired, eventInstalled)

    OnCreate {
      self.session?.delegate = self
      self.session?.activate()
      self.emitStatus()
    }

    Function("sendMessage") { (payload: [String: Any]) in
      guard let s = self.session, s.isReachable else { return }
      s.sendMessage(payload, replyHandler: nil, errorHandler: nil)
    }

    Function("updateApplicationContext") { (context: [String: Any]) in
      guard let s = self.session else { return }
      do {
        try s.updateApplicationContext(context)
      } catch {
        // best-effort
      }
    }

    AsyncFunction("getReachability") { (promise: Promise) in
      promise.resolve(self.session?.isReachable ?? false)
    }

    AsyncFunction("getIsPaired") { (promise: Promise) in
      promise.resolve(self.session?.isPaired ?? false)
    }

    AsyncFunction("getIsWatchAppInstalled") { (promise: Promise) in
      promise.resolve(self.session?.isWatchAppInstalled ?? false)
    }
  }

  private func emitStatus() {
    guard let s = session else { return }
    sendEvent(eventReachability, ["reachable": s.isReachable])
    sendEvent(eventPaired, ["paired": s.isPaired])
    sendEvent(eventInstalled, ["installed": s.isWatchAppInstalled])
  }

  // MARK: WCSessionDelegate

  public func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    emitStatus()
  }

  public func sessionReachabilityDidChange(_ session: WCSession) {
    sendEvent(eventReachability, ["reachable": session.isReachable])
  }

  public func sessionWatchStateDidChange(_ session: WCSession) {
    sendEvent(eventPaired, ["paired": session.isPaired])
    sendEvent(eventInstalled, ["installed": session.isWatchAppInstalled])
  }

  public func session(_ session: WCSession, didReceiveMessage message: [String : Any]) {
    sendEvent(eventMessage, message)
  }

  public func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String : Any]) {
    // optional: forward context updates back into JS if desired
    sendEvent(eventMessage, applicationContext)
  }

  public func sessionDidBecomeInactive(_ session: WCSession) {}

  public func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
    emitStatus()
  }
}
```

**Step 3: Typecheck JS (no runtime)**

Run: `bun run check:types`
Expected: exit 0.

---

### Task 3: Add iOS JS wrapper `lib/watch-connectivity.ios.ts`

**Files:**
- Create: `lib/watch-connectivity.ios.ts`
- (Optional) Create: `lib/watch-connectivity/payload.ts`
- (Optional) Create: `tests/unit/lib/watch-connectivity-payload.test.ts`

**Step 1: Add a small payload sanitizer (pure JS, testable)**

Create `lib/watch-connectivity/payload.ts`:
```ts
export function sanitizeForNative(value: unknown): any {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(sanitizeForNative).filter((v) => v !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      const next = sanitizeForNative(v);
      if (next !== undefined) out[k] = next;
    }
    return out;
  }
  return value;
}
```

**Step 2: Implement `lib/watch-connectivity.ios.ts`**

Create `lib/watch-connectivity.ios.ts`:
```ts
import { requireNativeModule } from 'expo-modules-core';
import { sanitizeForNative } from './watch-connectivity/payload';

type WatchEventName = 'message' | 'reachability' | 'paired' | 'installed';

const Native = requireNativeModule('FFWatchConnectivity');

const EVENT_MAP: Record<WatchEventName, string> = {
  message: 'FFWatchConnectivity.message',
  reachability: 'FFWatchConnectivity.reachability',
  paired: 'FFWatchConnectivity.paired',
  installed: 'FFWatchConnectivity.installed',
};

export const watchEvents = {
  addListener: (event: WatchEventName, cb: (arg: any) => void) => {
    const nativeEventName = EVENT_MAP[event];
    const sub = Native.addListener(nativeEventName, (payload: any) => {
      if (event === 'message') return cb(payload ?? {});
      if (event === 'reachability') return cb(!!payload?.reachable);
      if (event === 'paired') return cb(!!payload?.paired);
      if (event === 'installed') return cb(!!payload?.installed);
      return cb(payload);
    });
    return () => sub?.remove?.();
  },
  on: (event: WatchEventName, cb: (arg: any) => void) => {
    return (watchEvents as any).addListener(event, cb);
  },
};

export const sendMessage = (message: any) => {
  const payload = sanitizeForNative(message);
  if (!payload) return;
  Native.sendMessage(payload);
};

export const updateApplicationContext = (context: any) => {
  const payload = sanitizeForNative(context) ?? {};
  Native.updateApplicationContext(payload);
};

let latestWatchContext: Record<string, any> = {};

export function updateWatchContext(patch: Record<string, any>) {
  latestWatchContext = { ...latestWatchContext, ...(patch ?? {}) };
  updateApplicationContext(latestWatchContext);
}

export function getLatestWatchContext() {
  return latestWatchContext;
}

export const getReachability = () => Native.getReachability();
export const getIsPaired = () => Native.getIsPaired();
export const getIsWatchAppInstalled = () => Native.getIsWatchAppInstalled();
```

**Step 3: Add unit tests for sanitizer**

Create `tests/unit/lib/watch-connectivity-payload.test.ts`:
```ts
import { sanitizeForNative } from '@/lib/watch-connectivity/payload';

describe('sanitizeForNative', () => {
  it('drops undefined keys recursively', () => {
    expect(
      sanitizeForNative({ a: 1, b: undefined, c: { d: undefined, e: 2 } })
    ).toEqual({ a: 1, c: { e: 2 } });
  });

  it('filters undefined array items', () => {
    expect(sanitizeForNative([1, undefined, 2])).toEqual([1, 2]);
  });
});
```

**Step 4: Run tests**

Run: `bun run test tests/unit/lib/watch-connectivity-payload.test.ts`
Expected: PASS.

---

### Task 4: Publish live tracking state from `Scan` to the watch (throttled)

**Files:**
- Modify: `app/(tabs)/scan-arkit.tsx`

**Step 1: Define a lightweight tracking payload**

Include:
- `isTracking`, `mode`, `phase`, `reps`, `primaryCue`
- selected metrics:
  - pullup: `avgElbowDeg`, `avgShoulderDeg`, `headToHand`
  - pushup: `avgElbowDeg`, `hipDropRatio`

**Step 2: Implement a throttled publisher**

Add a ref for last publish time and last signature; publish at ~4Hz max.

Pseudo-code to implement:
```ts
const lastWatchPublishRef = React.useRef(0);
const lastWatchSignatureRef = React.useRef<string | null>(null);

useEffect(() => {
  if (Platform.OS !== 'ios') return;
  if (!watchPaired || !watchInstalled) return;

  const now = Date.now();
  if (now - lastWatchPublishRef.current < 250) return;

  const reps = detectionMode === 'pullup' ? repCount : pushUpReps;
  const phase = detectionMode === 'pullup' ? pullUpPhase : pushUpPhase;
  const metrics =
    detectionMode === 'pullup'
      ? {
          avgElbowDeg: pullUpMetrics?.avgElbow ?? null,
          avgShoulderDeg: pullUpMetrics?.avgShoulder ?? null,
          headToHand: pullUpMetrics?.headToHand ?? null,
        }
      : {
          avgElbowDeg: pushUpMetrics?.avgElbow ?? null,
          hipDropRatio: pushUpMetrics?.hipDrop ?? null,
        };

  const payload = {
    v: 1,
    type: 'tracking',
    ts: now,
    isTracking: !!isTracking,
    reps,
    tracking: {
      isTracking: !!isTracking,
      mode: detectionMode,
      phase,
      reps,
      primaryCue: primaryCue ?? null,
      metrics,
    },
  };

  const signature = JSON.stringify(payload.tracking);
  if (signature === lastWatchSignatureRef.current) return;
  lastWatchSignatureRef.current = signature;
  lastWatchPublishRef.current = now;

  // Application context is the “latest state” lane.
  updateWatchContext(payload);
}, [
  watchPaired,
  watchInstalled,
  detectionMode,
  isTracking,
  repCount,
  pushUpReps,
  pullUpPhase,
  pushUpPhase,
  pullUpMetrics,
  pushUpMetrics,
  primaryCue,
]);
```

**Step 3: Keep existing Start/Stop command listener intact**

Ensure `watchEvents.addListener('message', ...)` continues to handle `command: "start" | "stop"`.

**Step 4: Typecheck**

Run: `bun run check:types`
Expected: exit 0.

---

### Task 5: Update watch UI to two screens: Mirror + Metrics

**Files:**
- Modify: `ios/Form Factor Watch Watch App/WatchSessionManager.swift`
- Modify: `ios/Form Factor Watch Watch App/ContentView.swift`

**Step 1: Expand session state to include tracking fields**

In `WatchSessionManager.swift`, add published fields:
- `mode: String?`
- `phase: String?`
- `primaryCue: String?`
- `metrics: [String: Double]` (or optional typed struct)

Update `handleIncoming(_:)` to prefer:
- `tracking` nested payload if present, else fall back to top-level keys.

**Step 2: Add a `TabView`**

In `ContentView.swift`, implement:
- `TabView { MirrorView(); MetricsView() }`
- MirrorView:
  - existing image
  - overlay: reps + phase + cue
- MetricsView:
  - large reps
  - phase + cue
  - 2–3 metric lines based on what’s present

**Step 3: Manual watch simulator verification**

Run: `bun run watch:install "Apple Watch Series 9 (45mm)"`
Expected: watch app installs and launches (if `WATCH_BUNDLE_ID` set).

Then (manual):
- Run iOS app, open Scan, begin tracking
- Confirm watch updates reps/phase/cue and shows mirror frames when enabled.

---

### Task 6: Update docs

**Files:**
- Modify: `docs/WATCH_APP_GUIDE.md`

**Step 1: Update “Camera Mirror Preview” section**
- Mention the watch now shows **Mirror + Metrics** screens.
- Mention live tracking state is mirrored (reps/phase/cues) and mirror frames remain low FPS.

---

### Task 7: Full verification sweep

**Step 1: Run unit tests**

Run: `bun run test`
Expected: PASS.

**Step 2: Run lint + types**

Run: `bun run lint && bun run check:types`
Expected: exit 0.

**Step 3: iOS build sanity (manual)**
- Build/run `bun run ios` (or device build) and verify the Scan screen loads.
- Confirm no runtime errors from `requireNativeModule('FFWatchConnectivity')` on iOS.

