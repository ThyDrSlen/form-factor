#!/bin/bash

# Get local IP address
LOCAL_IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || echo "localhost")
DEVICE_NAME="${1:-fc}"

echo "🔧 Building and installing on device: ${DEVICE_NAME}"
echo ""

# Check if device exists BEFORE doing anything else
DEVICE_LINE=$(xcrun xctrace list devices 2>/dev/null | grep -i "${DEVICE_NAME}" | grep -v -i "mac" | head -1)

if [ -z "$DEVICE_LINE" ]; then
  echo "❌ Device '${DEVICE_NAME}' not found!"
  echo ""
  echo "Available iOS devices:"
  xcrun xctrace list devices 2>/dev/null | grep -i "iphone\|ipad" | grep -v -i "mac" | head -10
  echo ""
  echo "Available simulators:"
  xcrun simctl list devices | grep -E "iPhone|iPad" | grep -v "unavailable" | head -5
  exit 1
fi

echo "✅ Device '${DEVICE_NAME}' found"
echo ""

# Check if Metro is running
if ! lsof -ti :8081 > /dev/null 2>&1; then
  echo "⚠️  Metro bundler is not running!"
  echo "   Start it with: bun run start:devclient --lan"
  echo "   Then run this command again."
  exit 1
fi

echo "✅ Metro bundler is running"
echo "📡 Metro URL: exp://${LOCAL_IP}:8081"
echo ""

# Build the app
echo "📦 Building app..."
xcodebuild \
  -workspace ios/formfactoreas.xcworkspace \
  -scheme formfactoreas \
  -configuration Debug \
  -sdk iphoneos26.1 \
  -destination "name=${DEVICE_NAME}" \
  build

if [ $? -ne 0 ]; then
  echo "❌ Build failed!"
  exit 1
fi

echo ""
echo "✅ Build succeeded!"
echo ""

# Find the built app
APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData/formfactoreas-*/Build/Products/Debug-iphoneos -name "formfactoreas.app" -type d 2>/dev/null | head -1)

if [ -z "$APP_PATH" ]; then
  echo "⚠️  Could not find built app."
  echo "   Please install manually via Xcode:"
  echo "   1. Open: ios/formfactoreas.xcworkspace"
  echo "   2. Select device 'fc' as destination"
  echo "   3. Press ⌘R to build and run"
  exit 1
fi

echo "📱 Installing app on device '${DEVICE_NAME}'..."
echo "   App: $APP_PATH"

# Extract device ID from the line we already found
DEVICE_ID=$(echo "$DEVICE_LINE" | sed 's/.*(\([^)]*\))$/\1/')

if [ "$DEVICE_ID" = "$DEVICE_LINE" ] || [ -z "$DEVICE_ID" ]; then
  DEVICE_ID=$(echo "$DEVICE_LINE" | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | tail -1)
fi

if [ -z "$DEVICE_ID" ]; then
  echo "⚠️  Could not find device ID. Using device name..."
  DEVICE_ID="${DEVICE_NAME}"
fi

echo "   Device ID: ${DEVICE_ID}"

# Try to install using xcrun devicectl
if command -v xcrun > /dev/null 2>&1; then
  echo "   Installing via xcrun devicectl..."
  xcrun devicectl device install app --device "${DEVICE_ID}" "$APP_PATH" 2>&1
  
  if [ $? -eq 0 ]; then
    echo ""
    echo "✅ App installed successfully!"
    echo ""
    echo "📱 The app should auto-connect to Metro at: exp://${LOCAL_IP}:8081"
    echo "   If it shows 'No script URL', shake device → Configure Bundler → Enter: exp://${LOCAL_IP}:8081"
    exit 0
  else
    echo "⚠️  devicectl install failed."
  fi
fi

# Fallback: Instructions for manual install
echo ""
echo "⚠️  Automatic install failed. Please install via Xcode:"
echo "   1. Open: ios/formfactoreas.xcworkspace"
echo "   2. Product → Destination → Select '${DEVICE_NAME}'"
echo "   3. Press ⌘R (or Product → Run)"
echo ""
echo "   Or use this command to open Xcode:"
echo "   open ios/formfactoreas.xcworkspace"
