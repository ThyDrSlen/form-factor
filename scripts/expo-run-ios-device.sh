#!/bin/bash

# Wrapper for expo run:ios that checks for physical device first
DEVICE_NAME="${1:-fc}"

# Check if physical device exists BEFORE calling expo
DEVICE_LINE=$(xcrun xctrace list devices 2>/dev/null | grep -i "${DEVICE_NAME}" | grep -v -i "mac" | head -1)

if [ -z "$DEVICE_LINE" ]; then
  echo "❌ Physical device '${DEVICE_NAME}' not found!"
  echo ""
  echo "Available iOS devices:"
  xcrun xctrace list devices 2>/dev/null | grep -i "iphone\|ipad" | grep -v -i "mac" || echo "  (none)"
  echo ""
  echo "Expo will not check simulators - device must be connected."
  exit 1
fi

echo "✅ Physical device '${DEVICE_NAME}' found"
echo "🚀 Running expo run:ios..."
echo ""

# Get device UUID for expo
DEVICE_ID=$(echo "$DEVICE_LINE" | sed 's/.*(\([^)]*\))$/\1/')
if [ "$DEVICE_ID" = "$DEVICE_LINE" ] || [ -z "$DEVICE_ID" ]; then
  DEVICE_ID=$(echo "$DEVICE_LINE" | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | tail -1)
fi

# Run expo with device ID (more reliable than name)
if [ -n "$DEVICE_ID" ]; then
  npx expo run:ios --device "${DEVICE_ID}" "${@:2}"
else
  npx expo run:ios --device "${DEVICE_NAME}" "${@:2}"
fi
