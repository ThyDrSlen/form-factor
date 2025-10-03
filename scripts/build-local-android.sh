#!/bin/bash

# Local Android Build Script (No Expo Servers)
# Builds completely offline using native Gradle tools

set -e

echo "🏗️  Local Android Build (No EAS)"
echo "================================"
echo ""

cd "$(dirname "$0")/.."

# Configuration
BUILD_TYPE="${1:-aab}"  # aab or apk

echo "📋 Configuration:"
echo "   Build Type: $BUILD_TYPE"
echo ""

# 1. Generate native Android project
echo "1️⃣ Generating native Android project..."
bunx expo prebuild --platform android --clean
echo "✅ Android project generated"
echo ""

# 2. Build based on type
cd android

if [ "$BUILD_TYPE" = "apk" ]; then
  echo "2️⃣ Building APK..."
  ./gradlew assembleRelease
  
  if [ -f "app/build/outputs/apk/release/app-release.apk" ]; then
    APK_SIZE=$(ls -lh app/build/outputs/apk/release/app-release.apk | awk '{print $5}')
    echo "✅ APK built: android/app/build/outputs/apk/release/app-release.apk ($APK_SIZE)"
  else
    echo "❌ APK build failed"
    exit 1
  fi
else
  echo "2️⃣ Building AAB (Android App Bundle)..."
  ./gradlew bundleRelease
  
  if [ -f "app/build/outputs/bundle/release/app-release.aab" ]; then
    AAB_SIZE=$(ls -lh app/build/outputs/bundle/release/app-release.aab | awk '{print $5}')
    echo "✅ AAB built: android/app/build/outputs/bundle/release/app-release.aab ($AAB_SIZE)"
  else
    echo "❌ AAB build failed"
    exit 1
  fi
fi

cd ..

echo ""
echo "🎉 Build Complete!"
echo ""
echo "📦 Outputs:"
if [ "$BUILD_TYPE" = "apk" ]; then
  echo "   APK: android/app/build/outputs/apk/release/app-release.apk"
  echo ""
  echo "📲 Install on device:"
  echo "   adb install android/app/build/outputs/apk/release/app-release.apk"
else
  echo "   AAB: android/app/build/outputs/bundle/release/app-release.aab"
  echo ""
  echo "📤 Upload to Play Console:"
  echo "   https://play.google.com/console"
fi
