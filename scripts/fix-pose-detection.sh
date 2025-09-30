#!/bin/bash

# Fix Pose Detection Script
# This script ensures the VisionPoseDetector files are properly integrated

set -e

echo "🔧 Fixing pose detection..."

# Get the project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_ROOT="$PROJECT_ROOT/ios"
PROJECT_NAME="formfactoreas"

echo "📁 Project root: $PROJECT_ROOT"
echo "📱 iOS root: $IOS_ROOT"

# Ensure native files exist
echo "📋 Checking native files..."
if [ ! -f "$PROJECT_ROOT/native/VisionPoseDetector.swift" ]; then
    echo "❌ Missing native/VisionPoseDetector.swift"
    exit 1
fi

if [ ! -f "$PROJECT_ROOT/native/VisionPoseDetector.m" ]; then
    echo "❌ Missing native/VisionPoseDetector.m"
    exit 1
fi

# Copy files to iOS project
echo "📋 Copying files to iOS project..."
cp "$PROJECT_ROOT/native/VisionPoseDetector.swift" "$IOS_ROOT/$PROJECT_NAME/"
cp "$PROJECT_ROOT/native/VisionPoseDetector.m" "$IOS_ROOT/$PROJECT_NAME/"

echo "✅ Files copied successfully"

# Clean up any duplicate files
echo "🧹 Cleaning up duplicate files..."
find "$IOS_ROOT" -name "VisionPoseDetector*.m" -not -path "*/$PROJECT_NAME/VisionPoseDetector.m" -delete 2>/dev/null || true
find "$IOS_ROOT" -name "VisionPoseDetector*.swift" -not -path "*/$PROJECT_NAME/VisionPoseDetector.swift" -delete 2>/dev/null || true

echo "✅ Cleanup completed"

# Check if files are in Xcode project
echo "🔍 Checking Xcode project integration..."
if grep -q "VisionPoseDetector.swift" "$IOS_ROOT/$PROJECT_NAME.xcodeproj/project.pbxproj"; then
    echo "✅ VisionPoseDetector.swift is in Xcode project"
else
    echo "⚠️  VisionPoseDetector.swift needs to be added to Xcode project manually"
fi

if grep -q "VisionPoseDetector.m" "$IOS_ROOT/$PROJECT_NAME.xcodeproj/project.pbxproj"; then
    echo "✅ VisionPoseDetector.m is in Xcode project"
else
    echo "⚠️  VisionPoseDetector.m needs to be added to Xcode project manually"
fi

echo ""
echo "🎯 Next steps:"
echo "1. Open Xcode project: $IOS_ROOT/$PROJECT_NAME.xcworkspace"
echo "2. Add VisionPoseDetector.swift and VisionPoseDetector.m to the project if not already added"
echo "3. Ensure the files are added to the target"
echo "4. Build and run the project"
echo ""
echo "✨ Pose detection should now work!"
