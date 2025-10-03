#!/bin/bash

# Pre-EAS Build Validation Script
# Run this before `eas build` to catch issues locally

set -e

echo "🔍 Pre-Build Validation"
echo "======================="
echo ""

# Change to project root
cd "$(dirname "$0")/.."

ERRORS=0

# 1. Expo Doctor
echo "1️⃣ Running expo-doctor..."
if bunx expo-doctor; then
  echo "✅ Expo doctor passed"
else
  echo "❌ Expo doctor found issues"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 2. Validate Config
echo "2️⃣ Validating app config..."
if bunx expo config --type public > /dev/null 2>&1; then
  echo "✅ App config is valid"
else
  echo "❌ App config has errors"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 3. TypeScript Check
echo "3️⃣ Running TypeScript check..."
if bunx tsc --noEmit; then
  echo "✅ No TypeScript errors"
else
  echo "❌ TypeScript errors found"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 4. Linting
echo "4️⃣ Running linter..."
if bun run lint; then
  echo "✅ Linting passed"
else
  echo "⚠️  Linting warnings (non-blocking)"
fi
echo ""

# 5. Check Bundle Identifier
echo "5️⃣ Checking bundle identifier..."
BUNDLE_ID=$(grep -o '"bundleIdentifier": "[^"]*"' app.json | cut -d'"' -f4)
echo "   Bundle ID: $BUNDLE_ID"
if [ "$BUNDLE_ID" = "com.slenthekid.form-factor-eas" ]; then
  echo "✅ Bundle ID is correct"
else
  echo "❌ Bundle ID mismatch"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 6. Check Required Assets
echo "6️⃣ Checking required assets..."
if [ -f "assets/images/ff-logo.png" ]; then
  echo "✅ App icon exists"
else
  echo "❌ App icon missing"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 7. Verify Environment Variables
echo "7️⃣ Checking EAS secrets..."
echo "   Run: eas secret:list"
echo "   Required secrets:"
echo "   - SUPABASE_STAGING_URL"
echo "   - SUPABASE_STAGING_ANON_KEY"
echo "   - SUPABASE_PRODUCTION_URL"
echo "   - SUPABASE_PRODUCTION_ANON_KEY"
echo ""

# 8. Check for Common Issues
echo "8️⃣ Checking for common issues..."
if grep -q "usesARKit" app.json 2>/dev/null; then
  echo "❌ Invalid usesARKit property found in app.json"
  ERRORS=$((ERRORS + 1))
else
  echo "✅ No invalid properties in app.json"
fi
echo ""

# Summary
echo "========================"
if [ $ERRORS -eq 0 ]; then
  echo "✅ All checks passed! Ready for EAS build"
  echo ""
  echo "Next steps:"
  echo "  eas build --platform ios --profile staging"
  echo "  eas build --platform ios --profile production"
  exit 0
else
  echo "❌ $ERRORS check(s) failed"
  echo ""
  echo "Fix the errors above before running EAS build"
  exit 1
fi
