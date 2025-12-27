#!/bin/bash
set -euo pipefail

WATCH_SCHEME="${WATCH_SCHEME:-Form Factor Watch Watch App}"
WORKSPACE="ios/formfactoreas.xcworkspace"
DERIVED_DATA="${DERIVED_DATA:-${TMPDIR:-/tmp}/ff-watch-build}"
WATCH_SIM_NAME="${1:-Apple Watch Series 9 (45mm)}"

if [ ! -d "$WORKSPACE" ]; then
  echo "❌ Xcode workspace not found at $WORKSPACE"
  exit 1
fi

WATCH_UDID=$(xcrun simctl list devices available | grep -F "${WATCH_SIM_NAME} (" | head -1 | sed -n 's/.*(\(.*\)).*/\1/p')

if [ -z "$WATCH_UDID" ]; then
  echo "❌ Watch simulator '${WATCH_SIM_NAME}' not found."
  echo "Available watch simulators:"
  xcrun simctl list devices available | grep -E "Apple Watch" || true
  exit 1
fi

xcrun simctl boot "$WATCH_UDID" >/dev/null 2>&1 || true

echo "🏗️  Building watch app ($WATCH_SCHEME) for $WATCH_SIM_NAME..."
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$WATCH_SCHEME" \
  -configuration Debug \
  -sdk watchsimulator \
  -destination "id=$WATCH_UDID" \
  -derivedDataPath "$DERIVED_DATA" \
  build

APP_PATH=$(find "$DERIVED_DATA/Build/Products" -path "*watchsimulator*" -name "${WATCH_SCHEME}.app" -print -quit)
if [ -z "$APP_PATH" ]; then
  APP_PATH=$(find "$DERIVED_DATA/Build/Products" -path "*watchsimulator*" -name "*Watch*.app" -print -quit)
fi

if [ -z "$APP_PATH" ]; then
  echo "❌ Could not find built watch app in $DERIVED_DATA/Build/Products"
  exit 1
fi

echo "📲 Installing watch app..."
xcrun simctl install "$WATCH_UDID" "$APP_PATH"

if [ -n "${WATCH_BUNDLE_ID:-}" ]; then
  echo "🚀 Launching $WATCH_BUNDLE_ID..."
  xcrun simctl launch "$WATCH_UDID" "$WATCH_BUNDLE_ID" || true
else
  echo "ℹ️  Set WATCH_BUNDLE_ID to auto-launch (example: com.slenthekid.formfactoreas.watchkitapp)"
fi

echo "✅ Done"
