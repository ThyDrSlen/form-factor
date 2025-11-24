# Apple Watch Companion App Setup Guide

To control the Form Factor recording and tracking from your Apple Watch, you need to add a Watch App target to your iOS project. Since this requires Xcode configuration that cannot be fully automated, please follow these steps.

## Prerequisites

1.  Ensure you have run `bun install` to install `react-native-watch-connectivity`.
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

1.  In Xcode's Project Navigator (left sidebar), find the `FormFactorWatch Watch App` folder.
2.  Delete the default files: `FormFactorWatchApp.swift` and `ContentView.swift`.
3.  Drag and drop the files from `native/watch-app/` into this folder in Xcode.
    *   `native/watch-app/FormFactorWatchApp.swift`
    *   `native/watch-app/ContentView.swift`
    *   `native/watch-app/WatchSessionManager.swift`
4.  When prompted:
    *   Check **"Copy items if needed"**.
    *   Ensure **"FormFactorWatch Watch App"** target is checked.
    *   Click **Finish**.

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

## Troubleshooting

*   **"WCSession is not supported"**: Ensure you are running on a device or simulator pair, not just a generic simulator.
*   **"iPhone not reachable"**: Ensure the iOS app is running in the foreground on the paired phone.
