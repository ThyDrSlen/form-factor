#!/bin/bash

# Quick Environment Setup Script
# This script helps you quickly set up your environment variables

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

echo "🚀 Quick Environment Setup"
echo "==========================="
echo ""

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    print_warning ".env.local not found. Creating from example..."
    cp .env.example .env.local
fi

print_status "Current environment variables in .env.local:"
echo ""

# Show current values (masked)
if [ -f ".env.local" ]; then
    echo "📋 Current Configuration:"
    echo "========================"
    
    # Extract and display current values
    if grep -q "EXPO_PUBLIC_SUPABASE_URL" .env.local; then
        SUPABASE_URL=$(grep "EXPO_PUBLIC_SUPABASE_URL" .env.local | cut -d'=' -f2)
        echo "✅ Supabase URL: $SUPABASE_URL"
    else
        echo "❌ Supabase URL: Not set"
    fi
    
    if grep -q "EXPO_PUBLIC_SUPABASE_ANON_KEY" .env.local; then
        SUPABASE_KEY=$(grep "EXPO_PUBLIC_SUPABASE_ANON_KEY" .env.local | cut -d'=' -f2)
        if [ ${#SUPABASE_KEY} -gt 20 ]; then
            echo "✅ Supabase Key: ${SUPABASE_KEY:0:20}... (set)"
        else
            echo "❌ Supabase Key: Not set properly"
        fi
    else
        echo "❌ Supabase Key: Not set"
    fi
    
    if grep -q "EXPO_TOKEN" .env.local; then
        EXPO_TOKEN=$(grep "EXPO_TOKEN" .env.local | cut -d'=' -f2)
        if [ ${#EXPO_TOKEN} -gt 20 ]; then
            echo "✅ Expo Token: ${EXPO_TOKEN:0:20}... (set)"
        else
            echo "❌ Expo Token: Not set properly"
        fi
    else
        echo "❌ Expo Token: Not set"
    fi
    
    echo ""
fi

echo "🔧 How to Configure Your Environment Variables:"
echo "=============================================="
echo ""
echo "1. **Edit .env.local file:**"
echo "   nano .env.local"
echo "   # or"
echo "   code .env.local"
echo ""
echo "2. **Replace the placeholder values with your actual values:**"
echo "   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co"
echo "   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-actual-anon-key"
echo "   EXPO_TOKEN=your-actual-expo-token"
echo ""
echo "3. **Load the variables:**"
echo "   source .env.local"
echo ""
echo "4. **Test your setup:**"
echo "   bun run start"
echo ""

echo "🌐 GitHub Secrets Setup:"
echo "========================"
echo ""
echo "For CI/CD to work, you also need to add these as GitHub secrets:"
echo ""
echo "1. Go to: https://github.com/[your-username]/form-factor-eas/settings/secrets/actions"
echo ""
echo "2. Add these secrets:"
echo "   - EXPO_TOKEN: Your Expo access token"
echo "   - SUPABASE_ACCESS_TOKEN: Your Supabase access token"
echo "   - SUPABASE_STAGING_PROJECT_REF: Your staging project reference"
echo "   - SUPABASE_PRODUCTION_PROJECT_REF: Your production project reference"
echo ""

echo "📱 EAS Build Environment Variables:"
echo "==================================="
echo ""
echo "Your eas.json is already configured to use these environment variables:"
echo ""
echo "**Staging builds:**"
echo "  - SUPABASE_STAGING_URL"
echo "  - SUPABASE_STAGING_ANON_KEY"
echo ""
echo "**Production builds:**"
echo "  - SUPABASE_PRODUCTION_URL"
echo "  - SUPABASE_PRODUCTION_ANON_KEY"
echo ""

echo "🧪 Testing Your Configuration:"
echo "============================="
echo ""
echo "1. **Test locally:**"
echo "   source .env.local"
echo "   bun run start"
echo ""
echo "2. **Test EAS build:**"
echo "   npx eas build --platform ios --profile preview --dry-run"
echo ""
echo "3. **Test CI/CD:**"
echo "   git push origin develop  # Triggers staging"
echo "   git push origin main       # Triggers production"
echo ""

print_success "Environment setup guide complete!"
print_warning "Don't forget to:"
echo "1. Edit .env.local with your actual values"
echo "2. Add GitHub secrets for CI/CD"
echo "3. Test your configuration"

