#!/bin/bash

# Measure and record wall-clock time for expo run:ios builds
# Usage:
#   ./scripts/measure-ios-run.sh [device_name] [-- extra expo args]
# Examples:
#   ./scripts/measure-ios-run.sh               # defaults to device "fc"
#   ./scripts/measure-ios-run.sh "iPhone 15 Pro"
#   ./scripts/measure-ios-run.sh fc -- --configuration Debug

set -o pipefail

DEVICE_NAME="${1:-fc}"
# Support passing extra args to expo after a -- separator
EXTRA_ARGS=()
shift 1 || true
if [[ "$1" == "--" ]]; then
  shift 1
  EXTRA_ARGS=("$@")
fi

METRICS_FILE="scripts/ios-build-times.csv"
START_TS=$(date +%s)
START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
EXPO_VERSION=$(bunx --bun expo --version 2>/dev/null || echo "unknown")
XCODE_VERSION=$(xcodebuild -version 2>/dev/null | tr '\n' ' ' | sed 's/  */ /g' | sed 's/ $//')

printf "\n⏱️  Starting iOS run: %s (device=\"%s\")\n" "$START_ISO" "$DEVICE_NAME"

# Run the build
bunx --bun expo run:ios --device "$DEVICE_NAME" --no-build-cache --no-bundler "${EXTRA_ARGS[@]}"
EXIT_CODE=$?

END_TS=$(date +%s)
DURATION=$((END_TS-START_TS))

# Write CSV header if file doesn't exist
if [ ! -f "$METRICS_FILE" ]; then
  echo "timestamp,device,exit_code,duration_seconds,branch,commit,expo_version,xcode_version" > "$METRICS_FILE"
fi

echo "$START_ISO,$DEVICE_NAME,$EXIT_CODE,$DURATION,$BRANCH,$COMMIT,\"$EXPO_VERSION\",\"$XCODE_VERSION\"" >> "$METRICS_FILE"

if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ Completed in ${DURATION}s"
else
  echo "❌ Failed in ${DURATION}s (exit=$EXIT_CODE)"
fi

echo "📄 Metrics appended to $METRICS_FILE"

exit $EXIT_CODE
