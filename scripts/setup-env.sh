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
