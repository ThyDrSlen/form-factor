#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACT="${ROOT_DIR}/build/eas-preview.ipa"
mkdir -p "$(dirname "$ARTIFACT")"

echo "🏗️  Running local preview build (iOS)..."
bunx eas build --platform ios --profile preview --local --non-interactive --output "$ARTIFACT"

if [ ! -f "$ARTIFACT" ]; then
  echo "❌ Local build did not generate $ARTIFACT"
  exit 1
fi

echo "📤 Uploading build to Expo for sharing..."
bunx eas upload --platform ios --path "$ARTIFACT" --non-interactive

echo "🚀 Submitting the same build to the App Store/TestFlight..."
bunx eas submit --platform ios --path "$ARTIFACT" --non-interactive

