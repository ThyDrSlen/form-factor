#!/bin/bash

# Continuous iOS Device Screen Monitoring
# Automatically captures screenshots when you press ENTER or every N seconds

set -e

SCREENSHOT_DIR="$HOME/Desktop/ios-screenshots"
INTERVAL=5  # seconds between auto-captures (set to 0 to disable)

echo "📱 iOS Screen Monitor"
echo "===================="
echo ""

# Check if iPhone is connected
DEVICE_UDID=$(xcrun xctrace list devices 2>&1 | grep "iPhone" | grep -v "Simulator" | head -1 | sed -n 's/.*(\([^)]*\)).*/\1/p')

if [ -z "$DEVICE_UDID" ]; then
    echo "❌ No iPhone connected"
    exit 1
fi

DEVICE_NAME=$(xcrun xctrace list devices 2>&1 | grep "iPhone" | grep -v "Simulator" | head -1 | sed 's/ (.*)//')
echo "✅ Connected: $DEVICE_NAME"
echo ""

mkdir -p "$SCREENSHOT_DIR"

# Check for libimobiledevice
if ! command -v idevicescreenshot &> /dev/null; then
    echo "📦 Installing screenshot tool..."
    brew install libimobiledevice
fi

echo "Press ENTER to capture screenshot (Ctrl+C to exit)"
if [ "$INTERVAL" -gt "0" ]; then
    echo "Auto-capturing every $INTERVAL seconds..."
fi
echo ""

COUNTER=0
while true; do
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    FILENAME="$SCREENSHOT_DIR/capture_${COUNTER}_${TIMESTAMP}.png"
    
    # Capture screenshot
    idevicescreenshot -u "$DEVICE_UDID" "$FILENAME" 2>/dev/null && {
        echo "📸 [$COUNTER] Saved: capture_${COUNTER}_${TIMESTAMP}.png"
        COUNTER=$((COUNTER + 1))
    } || {
        echo "⚠️  Screenshot failed (device may be locked)"
    }
    
    if [ "$INTERVAL" -gt "0" ]; then
        sleep "$INTERVAL"
    else
        # Wait for user input
        read -r
    fi
done

