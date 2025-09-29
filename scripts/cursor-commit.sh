#!/bin/bash

# Natural Language Commit Command for Cursor AI
# Usage: Just describe what you want to commit in natural language

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "Not in a git repository!"
    exit 1
fi

# Get git status
git status --porcelain > /tmp/git_status.txt

if [ ! -s /tmp/git_status.txt ]; then
    echo "No changes to commit!"
    exit 0
fi

# Auto-categorize files
config_files=()
ui_files=()
feat_files=()
refactor_files=()
ios_files=()
android_files=()
services_files=()
contexts_files=()
chore_files=()

# Analyze files
while IFS= read -r line; do
    status=$(echo "$line" | cut -c1-2)
    file=$(echo "$line" | cut -c4-)
    
    case "$file" in
        *.json|*.js|*.ts|*.config.*|package.json|tsconfig.json|babel.config.js|metro.config.js|tailwind.config.js|*.toml)
            config_files+=("$file")
            ;;
        ios/*|*.xcodeproj/*|*.plist|*.entitlements|*.storyboard|*.pbxproj|Podfile*|*.swift|*.m)
            ios_files+=("$file")
            ;;
        android/*|*.gradle|*.xml|*.properties)
            android_files+=("$file")
            ;;
        app/**/*.tsx|components/**/*.tsx|design-system/**/*)
            ui_files+=("$file")
            ;;
        contexts/*.tsx)
            contexts_files+=("$file")
            ;;
        lib/services/**/*.ts|lib/**/*.ts|hooks/*.ts)
            services_files+=("$file")
            ;;
        *)
            if [[ "$status" == "??" ]]; then
                feat_files+=("$file")
            else
                chore_files+=("$file")
            fi
            ;;
    esac
done < /tmp/git_status.txt

# Commit function
commit_files() {
    local category="$1"
    shift
    local files=("$@")
    local message="$2"
    
    if [ ${#files[@]} -eq 0 ]; then
        return 0
    fi
    
    print_status "Committing $category files..."
    
    for file in "${files[@]}"; do
        git add "$file" 2>/dev/null || true
    done
    
    case "$category" in
        "config") git commit -m "config: $message" ;;
        "ui") git commit -m "style: $message" ;;
        "feat") git commit -m "feat: $message" ;;
        "refactor") git commit -m "refactor: $message" ;;
        "ios") git commit -m "build: $message" ;;
        "android") git commit -m "build: $message" ;;
        "services") git commit -m "refactor: $message" ;;
        "contexts") git commit -m "feat: $message" ;;
        "chore") git commit -m "chore: $message" ;;
    esac
    
    print_success "Committed $category files"
}

# Commit in logical order with descriptive messages
commit_files "config" "${config_files[@]}" "Update configuration and build files"
commit_files "contexts" "${contexts_files[@]}" "Update context providers and state management"
commit_files "services" "${services_files[@]}" "Improve service layer and utilities"
commit_files "feat" "${feat_files[@]}" "Add new features and components"
commit_files "ui" "${ui_files[@]}" "Update UI components and styling"
commit_files "ios" "${ios_files[@]}" "Update iOS configuration and assets"
commit_files "android" "${android_files[@]}" "Update Android configuration"
commit_files "chore" "${chore_files[@]}" "Clean up and maintenance tasks"

rm -f /tmp/git_status.txt

print_success "All changes committed with focused commits!"
