#!/bin/bash
# Validate background agent environment
# Ensures all required tools are available

set -e

echo "🔍 Validating Background Agent Environment"
echo ""

ERRORS=0

# Function to check command
check_command() {
  local cmd=$1
  local name=$2
  if command -v "$cmd" >/dev/null 2>&1; then
    local version=$($cmd --version 2>&1 | head -n 1)
    echo "✅ $name: $version"
  else
    echo "❌ $name: NOT FOUND"
    ERRORS=$((ERRORS + 1))
  fi
}

# Check essential tools
echo "📦 Essential Tools:"
check_command "node" "Node.js"
check_command "bun" "Bun"
check_command "git" "Git"
check_command "tsc" "TypeScript"
echo ""

# Check CI/CD tools
echo "🚀 CI/CD Tools:"
check_command "eslint" "ESLint"
check_command "npx" "NPX"
check_command "eas" "EAS CLI"
check_command "supabase" "Supabase CLI"
echo ""

# Check optional tools
echo "🔧 Optional Tools:"
check_command "depcheck" "Depcheck" || echo "ℹ️  Depcheck: Available via npx"
check_command "audit-ci" "Audit CI" || echo "ℹ️  Audit CI: Available via npx"
echo ""

# Check files
echo "📁 Configuration Files:"
[[ -f "package.json" ]] && echo "✅ package.json" || { echo "❌ package.json"; ERRORS=$((ERRORS + 1)); }
[[ -f "tsconfig.json" ]] && echo "✅ tsconfig.json" || { echo "❌ tsconfig.json"; ERRORS=$((ERRORS + 1)); }
[[ -f "eslint.config.js" ]] && echo "✅ eslint.config.js" || { echo "❌ eslint.config.js"; ERRORS=$((ERRORS + 1)); }
[[ -f "eas.json" ]] && echo "✅ eas.json" || { echo "❌ eas.json"; ERRORS=$((ERRORS + 1)); }
echo ""

# Check git configuration
echo "🔧 Git Configuration:"
git config user.name && echo "✅ Git user.name configured"
git config user.email && echo "✅ Git user.email configured"
echo ""

# Check environment variables
echo "🌍 Environment Variables:"
[[ -n "$NODE_ENV" ]] && echo "✅ NODE_ENV=$NODE_ENV" || echo "ℹ️  NODE_ENV not set"
[[ -n "$CI" ]] && echo "✅ CI=$CI" || echo "ℹ️  CI not set"
echo ""

# Summary
if [ $ERRORS -eq 0 ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✨ Environment validation passed!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "❌ Validation failed with $ERRORS error(s)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
