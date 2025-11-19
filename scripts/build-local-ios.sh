#!/bin/bash

# Local iOS Build Script (No Expo Servers)
# Builds completely offline using native Xcode tools

set -e

echo "🏗️  Local iOS Build (No EAS)"
echo "============================"
echo ""

cd "$(dirname "$0")/.."

# Configuration
BUILD_TYPE="${1:-release}"  # release or debug
SCHEME="formfactoreas"
WORKSPACE="ios/${SCHEME}.xcworkspace"
ARCHIVE_PATH="build/${SCHEME}.xcarchive"
EXPORT_PATH="build"
EXPORT_OPTIONS="scripts/ExportOptions.plist"

echo "📋 Configuration:"
echo "   Build Type: $BUILD_TYPE"
echo "   Scheme: $SCHEME"
echo ""

# 1. Generate native iOS project
echo "1️⃣ Generating native iOS project..."
bunx expo prebuild --platform ios --clean
echo "✅ iOS project generated"
echo ""

# 2. Install CocoaPods dependencies
echo "2️⃣ Installing CocoaPods dependencies..."
cd ios
pod install
cd ..
echo "✅ Pods installed"
echo ""

# 3. Build archive
echo "3️⃣ Building iOS archive..."
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  archive \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM=NCTLNFGC6G \
  | grep -A 5 "error:" || true

if [ ! -d "$ARCHIVE_PATH" ]; then
  echo "❌ Archive failed"
  exit 1
fi
echo "✅ Archive created: $ARCHIVE_PATH"
echo ""

# 4. Export IPA
echo "4️⃣ Exporting IPA..."
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates \
  | grep -A 5 "error:" || true

if [ -f "$EXPORT_PATH/$SCHEME.ipa" ]; then
  IPA_SIZE=$(ls -lh "$EXPORT_PATH/$SCHEME.ipa" | awk '{print $5}')
  echo "✅ IPA exported: $EXPORT_PATH/$SCHEME.ipa ($IPA_SIZE)"
else
  echo "❌ Export failed"
  exit 1
fi
echo ""

echo "🎉 Build Complete!"
echo ""
echo "📦 Outputs:"
echo "   Archive: $ARCHIVE_PATH"
echo "   IPA: $EXPORT_PATH/$SCHEME.ipa"
echo ""

if [ -n "$API_KEY" ] && [ -n "$API_ISSUER" ]; then
  echo "📤 Uploading to TestFlight..."
  xcrun altool --upload-app \
    --file "$EXPORT_PATH/$SCHEME.ipa" \
    --type ios \
    --apiKey "$API_KEY" \
    --apiIssuer "$API_ISSUER"
else
  echo "📤 Upload to TestFlight:"
  echo "   To auto-upload, set API_KEY and API_ISSUER env vars."
  echo ""
  echo "   Manual command:"
  echo "   xcrun altool --upload-app --file $EXPORT_PATH/$SCHEME.ipa --type ios --apiKey YOUR_KEY --apiIssuer YOUR_ISSUER"
  echo ""
  echo "   Or use Xcode: Window > Organizer > Archives > Upload to App Store Connect"
  echo "   Or use 'Transporter' app from the Mac App Store."
fi
