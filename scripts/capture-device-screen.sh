#!/bin/bash

# iOS Device Screenshot Automation
# Captures screenshots from connected iPhone and saves to Desktop

set -e

SCREENSHOT_DIR="$HOME/Desktop/ios-screenshots"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

echo "📱 iOS Screenshot Capture"
echo "========================"
echo ""

# Check if iPhone is connected
echo "Checking for connected devices..."
DEVICE_UDID=$(xcrun xctrace list devices 2>&1 | grep "iPhone" | grep -v "Simulator" | head -1 | sed -n 's/.*(\([^)]*\)).*/\1/p')

if [ -z "$DEVICE_UDID" ]; then
    echo "❌ No iPhone connected via USB"
    echo "   Please connect your iPhone 15 Pro and trust this computer"
    exit 1
fi

DEVICE_NAME=$(xcrun xctrace list devices 2>&1 | grep "iPhone" | grep -v "Simulator" | head -1 | sed 's/ (.*)//')
echo "✅ Found: $DEVICE_NAME"
echo "   UDID: $DEVICE_UDID"
echo ""

# Create screenshot directory
mkdir -p "$SCREENSHOT_DIR"

# Take screenshot
echo "📸 Capturing screenshot..."
xcrun simctl io "$DEVICE_UDID" screenshot "$SCREENSHOT_DIR/screenshot_$TIMESTAMP.png" 2>/dev/null || {
    # If simctl doesn't work, try idevicescreenshot (requires libimobiledevice)
    if command -v idevicescreenshot &> /dev/null; then
        idevicescreenshot -u "$DEVICE_UDID" "$SCREENSHOT_DIR/screenshot_$TIMESTAMP.png"
    else
        echo "⚠️  Installing libimobiledevice for screenshot support..."
        brew install libimobiledevice
        idevicescreenshot -u "$DEVICE_UDID" "$SCREENSHOT_DIR/screenshot_$TIMESTAMP.png"
    fi
}

echo "✅ Screenshot saved to:"
echo "   $SCREENSHOT_DIR/screenshot_$TIMESTAMP.png"
echo ""

# Open the file
open "$SCREENSHOT_DIR/screenshot_$TIMESTAMP.png"

# Optional: Copy to clipboard
if command -v osascript &> /dev/null; then
    osascript -e "set the clipboard to (read (POSIX file \"$SCREENSHOT_DIR/screenshot_$TIMESTAMP.png\") as «class PNGf»)"
    echo "📋 Screenshot copied to clipboard"
fi

echo ""
echo "💡 Tip: Run 'watch-device-screen.sh' for continuous capture"

