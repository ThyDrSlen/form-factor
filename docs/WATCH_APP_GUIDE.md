# Apple Watch Companion App Setup Guide

To control the Form Factor recording and tracking from your Apple Watch, you need to add a Watch App target to your iOS project. Since this requires Xcode configuration that cannot be fully automated, please follow these steps.

## Prerequisites

1.  Ensure you have run `bun install`.
2.  Ensure you have run `bun run ios` at least once to generate the `ios/` folder.

## Step 1: Add Watch App Target in Xcode

1.  Open the workspace in Xcode:
    ```bash
    xcodebuild -workspace ios/formfactoreas.xcworkspace
    # OR
    open ios/formfactoreas.xcworkspace
    ```
2.  Go to **File > New > Target...**
3.  Select **watchOS** tab and choose **App**. Click **Next**.
4.  **Product Name**: `FormFactorWatch`
5.  **Bundle Identifier**: It should automatically be `com.slenthekid.formfactoreas.watchkitapp`.
6.  **Interface**: `SwiftUI`
7.  **Life Cycle**: `SwiftUI App`
8.  **Language**: `Swift`
9.  **Project**: `formfactoreas`
10. **Embed in Application**: `formfactoreas`
11. Click **Finish**.
12. If asked to "Activate" the scheme, click **Activate**.

## Step 2: Replace Source Code

1.  In Xcode's Project Navigator (left sidebar), find the `Form Factor Watch Watch App` folder.
2.  Delete the default files if they exist.
3.  The watch app sources now live in the repo under:
    *   `ios/Form Factor Watch Watch App/FormFactorWatchApp.swift`
    *   `ios/Form Factor Watch Watch App/ContentView.swift`
    *   `ios/Form Factor Watch Watch App/WatchSessionManager.swift`
4.  If Xcode doesn't pick them up automatically, drag those files into the watch app group and ensure the **"Form Factor Watch Watch App"** target is checked.

## Step 3: Configure Info.plist and Capabilities

1.  In Xcode, select the `FormFactorWatch Watch App` target.
2.  Go to the **Info** tab.
3.  Ensure `WKCompanionAppBundleIdentifier` is set to `com.slenthekid.formfactoreas` (or `.dev` if running in dev mode).
4.  Go to the **Signing & Capabilities** tab.
5.  Click **+ Capability** and add **HealthKit**.
    *   This is required to keep the app alive during workouts.
6.  Also add **Background Modes** and check:
    *   **Remote notifications**

## Step 4: Run

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

## Step 5: Camera Mirror Preview (Low FPS)

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
