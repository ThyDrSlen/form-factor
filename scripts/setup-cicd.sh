#!/bin/bash

# CI/CD Setup Script for Form Factor Fitness App
echo "🚀 Setting up CI/CD pipeline for Form Factor Fitness App..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if required tools are installed
check_tool() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}❌ $1 is not installed. Please install it first.${NC}"
        exit 1
    else
        echo -e "${GREEN}✅ $1 is installed${NC}"
    fi
}

echo "🔍 Checking required tools..."
check_tool "node"
check_tool "npm"
check_tool "git"

# Install EAS CLI globally if not installed
if ! command -v eas &> /dev/null; then
    echo -e "${YELLOW}📦 Installing EAS CLI...${NC}"
    npm install -g @expo/eas-cli
else
    echo -e "${GREEN}✅ EAS CLI is installed${NC}"
fi

# Install Supabase CLI if not installed
if ! command -v supabase &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Supabase CLI...${NC}"
    npm install -g supabase
else
    echo -e "${GREEN}✅ Supabase CLI is installed${NC}"
fi

echo ""
echo "🔧 Setting up project configurations..."

# Initialize EAS project if not already done
if [ ! -f "eas.json" ]; then
    echo -e "${YELLOW}🎯 Initializing EAS project...${NC}"
    eas init
else
    echo -e "${GREEN}✅ EAS project already initialized${NC}"
fi

# Initialize Supabase project if not already done
if [ ! -f "supabase/config.toml" ]; then
    echo -e "${YELLOW}🎯 Initializing Supabase project...${NC}"
    supabase init
else
    echo -e "${GREEN}✅ Supabase project already initialized${NC}"
fi

echo ""
echo "🔐 GitHub Secrets Setup Required:"
echo "Please add the following secrets to your GitHub repository:"
echo ""
echo "1. EXPO_TOKEN - Get from: https://expo.dev/accounts/[username]/settings/access-tokens"
echo "2. SUPABASE_ACCESS_TOKEN - Get from: https://app.supabase.com/account/tokens"
echo "3. SUPABASE_STAGING_PROJECT_REF - Your staging Supabase project reference"
echo "4. SUPABASE_PRODUCTION_PROJECT_REF - Your production Supabase project reference"
echo "5. SUPABASE_STAGING_URL - Your staging Supabase project URL"
echo "6. SUPABASE_STAGING_ANON_KEY - Your staging Supabase anon key"
echo "7. SUPABASE_PRODUCTION_URL - Your production Supabase project URL"
echo "8. SUPABASE_PRODUCTION_ANON_KEY - Your production Supabase anon key"
echo "9. APPLE_TEAM_ID - Your Apple Developer Team ID (for iOS builds)"
echo ""

echo "🏗️ EAS Build Profiles:"
echo "- development: For local development builds"
echo "- preview: For internal testing (APK/IPA)"
echo "- staging: For staging environment deployment"
echo "- production: For production app store releases"
echo ""

echo "🌍 Environment Setup:"
echo "The pipeline supports multiple environments:"
echo "- PR builds: preview builds for testing"
echo "- develop branch: staging deployments"
echo "- main branch: production deployments"
echo ""

echo "📱 App Store Setup:"
echo "Make sure to:"
echo "1. Configure your Apple Developer account"
echo "2. Set up Google Play Console"
echo "3. Generate app signing keys"
echo "4. Configure store credentials with EAS"
echo ""

echo -e "${GREEN}✅ CI/CD setup complete!${NC}"
echo ""
echo "🚀 Next steps:"
echo "1. Push your changes to GitHub"
echo "2. Add the required secrets to your GitHub repository"
echo "3. Create your first pull request to test the pipeline"
echo "4. Merge to develop branch for staging deployment"
echo "5. Merge to main branch for production deployment"
echo ""
echo "💡 Useful commands:"
echo "- eas build --profile preview : Create a preview build"
echo "- eas submit --profile production : Submit to app stores"
echo "- eas update --branch production : Push OTA update"
echo "- supabase db push : Deploy database changes"
