#!/bin/bash
# Quality check script for CI/CD and smart commits
# Runs all code quality checks before commits

set -e

echo "🔍 Running Quality Checks..."
echo ""

# TypeScript type checking
echo "📝 TypeScript Type Check..."
bun run tsc --noEmit
echo "✅ TypeScript check passed"
echo ""

# ESLint
echo "🔧 ESLint..."
bun run lint
echo "✅ Linting passed"
echo ""

# Check for unused dependencies (optional)
if command -v depcheck >/dev/null 2>&1; then
  echo "📦 Checking for unused dependencies..."
  npx depcheck --ignores="@types/*,eslint*,@babel/*,babel-*,metro-*,expo-*,playwright" || true
  echo ""
fi

echo "✨ All quality checks passed!"
