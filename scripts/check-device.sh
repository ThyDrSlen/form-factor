#!/bin/bash

# Check if physical device exists before running expo
DEVICE_NAME="${1:-fc}"

# Check if device exists
DEVICE_LINE=$(xcrun xctrace list devices 2>/dev/null | grep -i "${DEVICE_NAME}" | grep -v -i "mac" | head -1)

if [ -z "$DEVICE_LINE" ]; then
  echo "❌ Physical device '${DEVICE_NAME}' not found!"
  echo ""
  echo "Available iOS devices:"
  xcrun xctrace list devices 2>/dev/null | grep -i "iphone\|ipad" | grep -v -i "mac" || echo "  (none)"
  exit 1
fi

echo "✅ Physical device '${DEVICE_NAME}' found"
exit 0
