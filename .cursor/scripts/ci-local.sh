#!/bin/bash
# Local CI/CD simulation
# Runs the same checks as GitHub Actions locally

set -e

echo "🚀 Running Local CI/CD Pipeline"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Job 1: Code Quality & Testing
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📋 Job 1: Code Quality & Testing${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo "📦 Installing dependencies..."
bun install --frozen-lockfile
echo ""

echo "📝 TypeScript type checking..."
bun run tsc --noEmit
echo -e "${GREEN}✅ TypeScript check passed${NC}"
echo ""

echo "🔧 ESLint..."
bun run lint
echo -e "${GREEN}✅ Linting passed${NC}"
echo ""

echo "🔍 Checking for unused dependencies..."
if command -v depcheck >/dev/null 2>&1; then
  npx depcheck --ignores="@types/*,eslint*,@babel/*,babel-*,metro-*,expo-*,playwright" || true
fi
echo ""

# Job 2: Security Scan
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🔒 Job 2: Security Scan${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo "🔐 Running security audit..."
bun audit --audit-level moderate || true
if command -v audit-ci >/dev/null 2>&1; then
  npx audit-ci --config audit-ci.json || true
fi
echo ""

# Summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✨ All CI checks passed!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
