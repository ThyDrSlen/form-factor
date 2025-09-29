#!/bin/bash

# Generic Smart Commit Command
# Usage: ./smart-commit.sh [category] "message" file1 file2 file3...

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

# Check arguments
if [ $# -lt 2 ]; then
    echo "Usage: $0 [category] \"message\" [files...]"
    echo ""
    echo "Categories:"
    echo "  config    - Configuration files (package.json, tsconfig.json, etc.)"
    echo "  ui        - UI components and styling"
    echo "  feat      - New features and components"
    echo "  refactor  - Code refactoring and improvements"
    echo "  ios       - iOS-specific files"
    echo "  android   - Android-specific files"
    echo "  services  - Service layer and utilities"
    echo "  contexts  - Context providers and state"
    echo "  chore     - Cleanup and maintenance"
    echo ""
    echo "Examples:"
    echo "  $0 config \"Update build configuration\" package.json tsconfig.json"
    echo "  $0 ui \"Improve button styling\" components/Button.tsx"
    echo "  $0 feat \"Add new dashboard component\" components/dashboard/"
    exit 1
fi

category="$1"
message="$2"
shift 2
files=("$@")

# If no files specified, stage all changes
if [ ${#files[@]} -eq 0 ]; then
    print_warning "No files specified, staging all changes..."
    git add .
else
    # Stage specified files
    print_status "Staging files: ${files[*]}"
    for file in "${files[@]}"; do
        if [ -f "$file" ] || [ -d "$file" ]; then
            git add "$file"
        else
            git add "$file" 2>/dev/null || print_warning "File not found: $file"
        fi
    done
fi

# Create commit message based on category
case "$category" in
    "config")
        commit_msg="config: $message"
        ;;
    "ui")
        commit_msg="style: $message"
        ;;
    "feat")
        commit_msg="feat: $message"
        ;;
    "refactor")
        commit_msg="refactor: $message"
        ;;
    "ios")
        commit_msg="build: $message"
        ;;
    "android")
        commit_msg="build: $message"
        ;;
    "services")
        commit_msg="refactor: $message"
        ;;
    "contexts")
        commit_msg="feat: $message"
        ;;
    "chore")
        commit_msg="chore: $message"
        ;;
    *)
        commit_msg="$category: $message"
        ;;
esac

# Commit changes
print_status "Committing with message: $commit_msg"
git commit -m "$commit_msg"

print_success "Commit created successfully!"
