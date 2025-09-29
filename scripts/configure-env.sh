#!/bin/bash

# Environment Configuration Script for Form Factor EAS
# This script helps you configure environment variables for local development and CI/CD

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

echo "🔧 Environment Configuration for Form Factor EAS"
echo "================================================"

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
echo "📋 Environment Variables Setup"
echo "==============================="
echo ""

# Create environment configuration files
print_status "Creating environment configuration files..."

# Create .env.example
cat > .env.example << 'EOF'
# Environment Configuration for Form Factor EAS

# ===========================================
# LOCAL DEVELOPMENT ENVIRONMENT
# ===========================================

# Supabase Configuration (Local Development)
EXPO_PUBLIC_SUPABASE_URL=https://your-local-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-local-anon-key

# Expo Configuration
EXPO_TOKEN=your-expo-token-here

# Supabase CLI Configuration
SUPABASE_ACCESS_TOKEN=your-supabase-access-token
SUPABASE_PROJECT_REF=your-local-project-ref

# ===========================================
# STAGING ENVIRONMENT
# ===========================================

# Supabase Staging
SUPABASE_STAGING_URL=https://your-staging-project.supabase.co
SUPABASE_STAGING_ANON_KEY=your-staging-anon-key
SUPABASE_STAGING_PROJECT_REF=your-staging-project-ref

# ===========================================
# PRODUCTION ENVIRONMENT
# ===========================================

# Supabase Production
SUPABASE_PRODUCTION_URL=https://your-production-project.supabase.co
SUPABASE_PRODUCTION_ANON_KEY=your-production-anon-key
SUPABASE_PRODUCTION_PROJECT_REF=your-production-project-ref

# ===========================================
# OPTIONAL CONFIGURATION
# ===========================================

# Apple Developer (for iOS builds)
APPLE_TEAM_ID=your-apple-team-id

# Slack Notifications (optional)
SLACK_WEBHOOK=https://hooks.slack.com/services/your/slack/webhook

# ===========================================
# DEVELOPMENT TOOLS
# ===========================================

# Debug flags
EXPO_DEBUG=true
REACT_NATIVE_DEBUGGER=true

# Performance monitoring
EXPO_PUBLIC_SENTRY_DSN=your-sentry-dsn

# Analytics (optional)
EXPO_PUBLIC_ANALYTICS_ID=your-analytics-id
EOF

# Create environment setup script
cat > scripts/setup-env.sh << 'EOF'
#!/bin/bash

# Environment Setup Script
# Run this script to set up your local environment variables

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

echo "🔧 Setting up local environment variables..."

# Check if .env.local exists
if [ -f ".env.local" ]; then
    print_warning ".env.local already exists. Backing up to .env.local.backup"
    cp .env.local .env.local.backup
fi

# Create .env.local from example
if [ -f ".env.example" ]; then
    cp .env.example .env.local
    print_success "Created .env.local from .env.example"
    print_warning "Please edit .env.local with your actual values"
else
    print_error ".env.example not found!"
    exit 1
fi

# Make sure .env.local is in .gitignore
if ! grep -q "\.env\.local" .gitignore 2>/dev/null; then
    echo "" >> .gitignore
    echo "# Local environment variables" >> .gitignore
    echo ".env.local" >> .gitignore
    echo ".env.local.backup" >> .gitignore
    print_success "Added .env.local to .gitignore"
fi

print_success "Environment setup complete!"
print_warning "Next steps:"
echo "1. Edit .env.local with your actual values"
echo "2. Run 'source .env.local' to load variables"
echo "3. Test with 'bun run start'"
EOF

chmod +x scripts/setup-env.sh

print_success "Created environment configuration files"

echo ""
echo "🔑 GitHub Secrets Configuration"
echo "================================"
echo ""
echo "You need to add these secrets to your GitHub repository:"
echo ""
echo "1. Go to: https://github.com/$REPO_OWNER/$REPO_NAME/settings/secrets/actions"
echo ""
echo "2. Add these secrets:"
echo "   - EXPO_TOKEN"
echo "   - SUPABASE_ACCESS_TOKEN"
echo "   - SUPABASE_STAGING_PROJECT_REF"
echo "   - SUPABASE_PRODUCTION_PROJECT_REF"
echo "   - SLACK_WEBHOOK (optional)"
echo ""

echo "🌍 Environment Variables Usage"
echo "=============================="
echo ""
echo "Local Development:"
echo "  - Copy .env.example to .env.local"
echo "  - Edit .env.local with your values"
echo "  - Run: source .env.local"
echo ""
echo "CI/CD Pipeline:"
echo "  - Variables are automatically loaded from GitHub secrets"
echo "  - Different environments use different variable sets"
echo ""

echo "📱 EAS Build Configuration"
echo "=========================="
echo ""
echo "Your eas.json already has environment variables configured:"
echo "  - staging: Uses SUPABASE_STAGING_URL and SUPABASE_STAGING_ANON_KEY"
echo "  - production: Uses SUPABASE_PRODUCTION_URL and SUPABASE_PRODUCTION_ANON_KEY"
echo ""

echo "🧪 Testing Your Configuration"
echo "============================="
echo ""
echo "1. Set up local environment:"
echo "   ./scripts/setup-env.sh"
echo ""
echo "2. Edit .env.local with your values"
echo ""
echo "3. Test locally:"
echo "   source .env.local"
echo "   bun run start"
echo ""
echo "4. Test CI/CD:"
echo "   - Push to develop branch (triggers staging)"
echo "   - Push to main branch (triggers production)"
echo ""

print_success "Environment configuration setup complete!"
