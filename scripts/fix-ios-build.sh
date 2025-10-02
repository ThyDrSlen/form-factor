#!/bin/bash

# Fix iOS Build Issues
# This script addresses duplicate references and missing dependencies

set -e  # Exit on error

echo "🔧 iOS Build Fix Script"
echo "======================="
echo ""

# Change to project root
cd "$(dirname "$0")/.."

echo "1️⃣ Cleaning build artifacts..."
rm -rf ios/build
rm -rf ios/Pods
rm -rf ios/Podfile.lock
rm -rf ~/Library/Developer/Xcode/DerivedData/formfactoreas-*
echo "✅ Build artifacts cleaned"
echo ""

echo "2️⃣ Generating React Native files..."
# Generate the required files before pod install
npx expo prebuild --platform ios --no-install
echo "✅ React Native files generated"
echo ""

echo "3️⃣ Reinstalling CocoaPods dependencies..."
cd ios
pod deintegrate || true  # Remove all traces of CocoaPods
pod install --repo-update
cd ..
echo "✅ CocoaPods reinstalled"
echo ""

echo "4️⃣ Clearing Metro bundler cache..."
rm -rf node_modules/.cache
rm -rf .expo
rm -rf /tmp/metro-*
rm -rf /tmp/haste-map-*
echo "✅ Metro cache cleared"
echo ""

echo "5️⃣ Verifying Xcode project structure..."
# Check for duplicate file references
DUPLICATES=$(grep -c "SplashScreen.storyboard in Resources" ios/formfactoreas.xcodeproj/project.pbxproj || echo "0")
if [ "$DUPLICATES" -gt "1" ]; then
    echo "⚠️  Found $DUPLICATES references to SplashScreen.storyboard"
    echo "   Running expo prebuild to fix..."
    npx expo prebuild --platform ios --clean
else
    echo "✅ No duplicate references found"
fi
echo ""

echo "6️⃣ Checking React Native headers..."
if [ -d "ios/Pods/Headers/Public/React-Core" ]; then
    echo "✅ React Native headers found"
else
    echo "❌ React Native headers missing - reinstalling pods..."
    cd ios
    pod install --repo-update
    cd ..
fi
echo ""

echo "✅ All fixes applied!"
echo ""
echo "Next steps:"
echo "1. Open Xcode: open ios/formfactoreas.xcworkspace"
echo "2. Select your device (iPhone 15 Pro)"
echo "3. Product > Clean Build Folder (Shift+Cmd+K)"
echo "4. Product > Build (Cmd+B)"
echo ""
echo "Or run: bun run ios"

