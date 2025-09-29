#!/bin/bash

# CI/CD Setup Script for Form Factor EAS
# This script helps you set up the required GitHub secrets and environments

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "🚀 Setting up CI/CD for Form Factor EAS"
echo "======================================"

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository!"
    exit 1
fi

# Get repository info
REPO_OWNER=$(git config --get remote.origin.url | sed 's/.*github.com[:/]\([^/]*\)\/\([^.]*\).*/\1/')
REPO_NAME=$(git config --get remote.origin.url | sed 's/.*github.com[:/]\([^/]*\)\/\([^.]*\).*/\2/')

print_status "Repository: $REPO_OWNER/$REPO_NAME"

echo ""
echo "📋 Required GitHub Secrets:"
echo "=========================="
echo ""
echo "1. EXPO_TOKEN - Your Expo access token"
echo "   Get it from: https://expo.dev/accounts/[username]/settings/access-tokens"
echo ""
echo "2. SUPABASE_ACCESS_TOKEN - Supabase access token"
echo "   Get it from: https://supabase.com/dashboard/account/tokens"
echo ""
echo "3. SUPABASE_STAGING_PROJECT_REF - Staging project reference"
echo "   Get it from: https://supabase.com/dashboard/project/[staging-project]/settings/general"
echo ""
echo "4. SUPABASE_PRODUCTION_PROJECT_REF - Production project reference"
echo "   Get it from: https://supabase.com/dashboard/project/[production-project]/settings/general"
echo ""
echo "5. SLACK_WEBHOOK (Optional) - Slack webhook for notifications"
echo "   Get it from: https://api.slack.com/messaging/webhooks"
echo ""

echo "🔧 Required GitHub Environments:"
echo "================================="
echo ""
echo "1. staging - For staging deployments"
echo "2. production - For production deployments"
echo ""

echo "📝 Setup Instructions:"
echo "======================"
echo ""
echo "1. Go to your GitHub repository settings:"
echo "   https://github.com/$REPO_OWNER/$REPO_NAME/settings"
echo ""
echo "2. Add the required secrets:"
echo "   - Go to Settings > Secrets and variables > Actions"
echo "   - Click 'New repository secret' for each secret above"
echo ""
echo "3. Create environments:"
echo "   - Go to Settings > Environments"
echo "   - Create 'staging' environment"
echo "   - Create 'production' environment"
echo "   - Add protection rules if needed"
echo ""

echo "🧪 Test the setup:"
echo "=================="
echo ""
echo "1. Create a test branch:"
echo "   git checkout -b test-ci-cd"
echo ""
echo "2. Make a small change and commit:"
echo "   echo '// Test CI/CD' >> README.md"
echo "   git add README.md"
echo "   git commit -m 'test: CI/CD setup'"
echo "   git push origin test-ci-cd"
echo ""
echo "3. Create a pull request to main branch"
echo "4. Check the Actions tab to see the workflow run"
echo ""

echo "🔍 Monitoring:"
echo "=============="
echo ""
echo "- Check Actions tab: https://github.com/$REPO_OWNER/$REPO_NAME/actions"
echo "- Monitor EAS builds: https://expo.dev/accounts/[username]/projects/[project]/builds"
echo "- Check Supabase deployments in your project dashboard"
echo ""

print_success "Setup instructions complete!"
print_warning "Don't forget to add the required secrets and environments in GitHub!"

echo ""
echo "📚 Additional Resources:"
echo "======================="
echo "- GitHub Actions: https://docs.github.com/en/actions"
echo "- EAS Build: https://docs.expo.dev/build/introduction/"
echo "- Supabase CLI: https://supabase.com/docs/guides/cli"
echo "- Bun: https://bun.sh/docs"
echo ""

# Check if required tools are installed
print_status "Checking required tools..."

if command -v bun >/dev/null 2>&1; then
    print_success "✅ Bun is installed"
else
    print_warning "⚠️  Bun is not installed. Install it from https://bun.sh"
fi

if command -v npx >/dev/null 2>&1; then
    print_success "✅ Node.js/npm is installed"
else
    print_warning "⚠️  Node.js/npm is not installed"
fi

if command -v git >/dev/null 2>&1; then
    print_success "✅ Git is installed"
else
    print_warning "⚠️  Git is not installed"
fi

echo ""
print_success "🎉 CI/CD setup script completed!"