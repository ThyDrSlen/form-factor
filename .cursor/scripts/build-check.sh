#!/bin/bash
# Build verification script
# Simulates EAS build checks without actually building

set -e

echo "🏗️  Build Verification"
echo ""

echo "📋 Checking EAS configuration..."
if [[ -f "eas.json" ]]; then
  echo "✅ eas.json found"
  cat eas.json | grep -E "preview|staging|production" && echo "✅ Profiles configured"
else
  echo "❌ eas.json not found"
  exit 1
fi
echo ""

echo "📋 Checking app.json..."
if [[ -f "app.json" ]]; then
  echo "✅ app.json found"
else
  echo "❌ app.json not found"
  exit 1
fi
echo ""

echo "📋 Checking native directories..."
[[ -d "ios" ]] && echo "✅ iOS directory exists"
[[ -d "android" ]] && echo "✅ Android directory exists"
echo ""

echo "📋 Checking for required dependencies..."
grep -q "expo" package.json && echo "✅ Expo dependency found"
grep -q "react-native" package.json && echo "✅ React Native dependency found"
echo ""

echo "✅ Build configuration looks good!"
echo ""
echo "Note: Run 'npx eas build --platform all --profile preview --dry-run' for full EAS verification"
