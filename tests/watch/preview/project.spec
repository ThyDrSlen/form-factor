name: WatchVisualPreview
options:
  deploymentTarget:
    watchOS: '10.0'
targets:
  WatchVisualPreview:
    type: application
    platform: watchOS
    sources:
      - ${WATCH_UI_REPO}/targets/watch-app/ContentView.swift
      - ${WATCH_UI_REPO}/targets/watch-app/WatchSessionManager.swift
      - ${WATCH_UI_REPO}/tests/watch/preview/WatchUIFixture.swift
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: dev.hermes.formfactor.watchvisualpreview
        GENERATE_INFOPLIST_FILE: YES
        INFOPLIST_KEY_WKApplication: YES
        INFOPLIST_KEY_WKWatchOnly: YES
        INFOPLIST_KEY_CFBundleDisplayName: Watch UI Fixture
        SWIFT_VERSION: '5.0'
        SWIFT_ACTIVE_COMPILATION_CONDITIONS: DEBUG WATCH_UI_PREVIEW
        CODE_SIGNING_ALLOWED: NO
        TARGETED_DEVICE_FAMILY: '4'