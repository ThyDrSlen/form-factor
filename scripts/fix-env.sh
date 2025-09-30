#!/bin/bash

# Fix Environment Variables Script for Form Factor EAS
# This script helps you set up the correct environment variables

echo "🔧 Fixing Environment Variables for Form Factor EAS"
echo "=================================================="

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Creating one..."
    touch .env
fi

# Backup existing .env file
if [ -s ".env" ]; then
    echo "📋 Backing up existing .env file..."
    cp .env .env.backup
fi

# Create the corrected .env file
echo "✅ Creating corrected .env file..."
cat > .env << EOF
EXPO_PUBLIC_SUPABASE_URL=https://nxywytufzdgzcizmpvbd.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_2mDJXstiUdStAwSLmtAp2Q_dVTvVLPP
EXPO_TOKEN=-pLgNR7VnKCfL4La3FSuryIny0NMm31MPshraZwS
EOF

echo "✅ Environment variables have been set up correctly!"
echo ""
echo "📝 Your .env file now contains:"
echo "   - EXPO_PUBLIC_SUPABASE_URL: https://nxywytufzdgzcizmpvbd.supabase.co"
echo "   - EXPO_PUBLIC_SUPABASE_ANON_KEY: sb_publishable_2mDJXstiUdStAwSLmtAp2Q_dVTvVLPP"
echo "   - EXPO_TOKEN: [configured]"
echo ""
echo "🚀 Next steps:"
echo "   1. Restart your development server (expo start --clear)"
echo "   2. Try signing in again"
echo "   3. Check the console logs for detailed error information"
echo ""
echo "💡 If you still have issues:"
echo "   - Verify your internet connection"
echo "   - Check that your Supabase project is active"
echo "   - Ensure the API key is correct in your Supabase dashboard"
