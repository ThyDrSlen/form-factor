# Apple Watch Companion App Setup Guide

To control the Form Factor recording and tracking from your Apple Watch, the Watch App target is generated via `@bacons/apple-targets` during prebuild. Do not create the target manually in Xcode—`expo prebuild` will overwrite manual changes inside `ios/`.

## Prerequisites

1.  Ensure you have run `bun install`.
2.  Run `npx expo prebuild -p ios --clean` after changing watch targets or native config (you can still use `bun run ios` to generate `ios/`).

## Step 1: Watch Target Configuration

1.  Target config lives in `targets/watch-app/expo-target.config.js`.
2.  Watch sources live in the repo under:
    *   `targets/watch-app/FormFactorWatchApp.swift`
    *   `targets/watch-app/ContentView.swift`
    *   `targets/watch-app/WatchSessionManager.swift`
3.  Watch assets live under `targets/watch-app/Assets.xcassets`.
4.  `targets/watch-app/Info.plist` defines `WKCompanionAppBundleIdentifier` and must stay aligned with `com.slenthekid.formfactoreas`.

## Step 2: Sync in Xcode

1.  Open the workspace in Xcode:
    ```bash
    xcodebuild -workspace ios/formfactoreas.xcworkspace
    # OR
    open ios/formfactoreas.xcworkspace
    ```
2.  Confirm the `Form Factor Watch Watch App` target exists after prebuild.
3.  In **Signing & Capabilities**, verify **HealthKit** and **Background Modes > Remote notifications** are enabled (HealthKit is set via the target entitlements).

## Step 3: Run

1.  Select the `FormFactorWatch Watch App` scheme in the top toolbar.
2.  Select a Simulator pair (e.g., iPhone 15 Pro + Apple Watch Series 9).
3.  Click Run (Play button).

### Optional: Install on a Watch Simulator via Script

```bash
bun run watch:install "Apple Watch Series 9 (45mm)"
```

Set `WATCH_BUNDLE_ID` if you want the script to auto-launch the app:

```bash
WATCH_BUNDLE_ID=com.slenthekid.formfactoreas.watchkitapp bun run watch:install
```

For physical devices, installing the iOS app on the paired iPhone will also install the watch app.

## Step 4: Camera Mirror Preview (Low FPS)

The watch app supports a lightweight camera mirror by streaming snapshots from the iPhone, and also mirrors live tracking state (reps / phase / cues + key metrics).

1.  Open the **Scan** tab on the iPhone.
2.  Tap the **watch** icon (top-right controls) to enable Watch Mirror.
3.  Keep the iPhone app in the foreground and the watch reachable.

**Notes / limitations**

*   This is a low-FPS, compressed preview intended for quick framing.
*   Swipe between the **Mirror** and **Metrics** screens on the watch.
*   Mirroring uses ARKit back-camera tracking frames (no VisionCamera preview fallback).

## Troubleshooting

*   **"WCSession is not supported"**: Ensure you are running on a device or simulator pair, not just a generic simulator.
*   **"iPhone not reachable"**: Ensure the iOS app is running in the foreground on the paired phone.
