#!/bin/bash

# Fix VisionPoseDetector Plugin Registration

set -e

echo "🔧 Fixing VisionPoseDetector Plugin"
echo "===================================="
echo ""

cd "$(dirname "$0")/.."

echo "1️⃣ Checking native module files..."
if [ ! -f "ios/formfactoreas/VisionPoseDetector.swift" ]; then
    echo "❌ VisionPoseDetector.swift missing!"
    exit 1
fi

if [ ! -f "ios/formfactoreas/VisionPoseDetector.m" ]; then
    echo "❌ VisionPoseDetector.m missing!"
    exit 1
fi

echo "✅ Native files exist"
echo ""

echo "2️⃣ Verifying .m file registration..."
cat ios/formfactoreas/VisionPoseDetector.m
echo ""

echo "3️⃣ Cleaning and rebuilding..."
rm -rf ios/build
rm -rf ~/Library/Developer/Xcode/DerivedData/formfactoreas-*

cd ios
pod install
cd ..

echo ""
echo "4️⃣ Testing in Xcode..."
echo "   Run: open ios/formfactoreas.xcworkspace"
echo "   Then: Product > Clean Build Folder"
echo "   Then: Product > Build"
echo ""

echo "5️⃣ Check these in Xcode:"
echo "   - Build Settings > Swift Compiler > Objective-C Bridging Header"
echo "     Should point to: formfactoreas/formfactoreas-Bridging-Header.h"
echo ""
echo "   - Build Phases > Compile Sources"
echo "     Should include: VisionPoseDetector.swift and VisionPoseDetector.m"
echo ""

echo "✅ Fix applied!"
echo ""
echo "Next: bun run ios:device"

