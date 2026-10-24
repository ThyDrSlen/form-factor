# Watch visual fixture

Visual review only, not a test suite. Compiles the real ContentView and
WatchSessionManager in a separate simulator-only app. No WatchConnectivity
activation, paired phone, credentials, new dependencies, or production app launch.

The yellow SIMULATED badge, schematic portrait framing chart, exercise, reps and
cue are fixtures. A 0.5-second timer submits JPEGs through the real decode and
ordering path, so the rate display measures locally accepted fixture frames,
not live phone throughput. The green border makes unintended cropping visible.

With the already-installed XcodeGen:

```sh
WATCH_UI_REPO="$PWD" xcodegen generate --spec tests/watch/preview/project.spec \
  --project /tmp/form-factor-watch-visual --project-root /tmp/form-factor-watch-visual
xcodebuild -project /tmp/form-factor-watch-visual/WatchVisualPreview.xcodeproj \
  -scheme WatchVisualPreview -configuration Debug -sdk watchsimulator \
  -destination 'generic/platform=watchOS Simulator' \
  -derivedDataPath /tmp/form-factor-watch-visual/DerivedData build CODE_SIGNING_ALLOWED=NO
```

Create/use an isolated Watch simulator. Install only
`DerivedData/Build/Products/Debug-watchsimulator/WatchVisualPreview.app` there.
Launch `dev.hermes.formfactor.watchvisualpreview` with optional simctl child env:

- `SIMCTL_CHILD_WATCH_PREVIEW_PAGE=0`, `1`, `2`: mirror, current set, health.
- `SIMCTL_CHILD_WATCH_PREVIEW_EMPTY=1`: no phone reports or images.
- `SIMCTL_CHILD_WATCH_PREVIEW_CONTROLS=1`: initially reveal mirror controls.

Wait for rendering and, for the rate screenshot, one full five-second window.
Capture using `xcrun simctl io <isolated-simulator-UUID> screenshot <output.png>`.
Terminate the fixture before relaunching another scenario. Do not install this
fixture on physical devices. Production builds do not define WATCH_UI_PREVIEW.

No tests or linters were run for this visual pass. Physical Watch, live-phone
transport, VoiceOver, Dynamic Type and Crown interaction still need review after
visual approval. Native scrolling accommodates long cues and command feedback.