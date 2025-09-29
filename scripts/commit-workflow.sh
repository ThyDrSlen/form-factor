#!/bin/bash

# Smart Commit Workflow Script
# Groups files by relevance and creates focused commits

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository!"
    exit 1
fi

# Get current status
print_status "Checking git status..."
git status --porcelain > /tmp/git_status.txt

if [ ! -s /tmp/git_status.txt ]; then
    print_warning "No changes to commit!"
    exit 0
fi

# Function to commit files by category
commit_by_category() {
    local category="$1"
    shift
    local files=("$@")
    local message="$category"
    
    if [ ${#files[@]} -eq 0 ]; then
        return 0
    fi
    
    print_status "Committing $category files..."
    
    # Stage files
    for file in "${files[@]}"; do
        if [ -f "$file" ] || [ -d "$file" ]; then
            git add "$file"
        else
            # Handle deleted files
            git add "$file" 2>/dev/null || true
        fi
    done
    
    # Commit with category-specific message
    case "$category" in
        "config")
            git commit -m "config: Update configuration and build files

- Update build configuration files
- Modify package dependencies and settings
- Update TypeScript and build tool configurations"
            ;;
        "ui")
            git commit -m "style: Update UI components and styling

- Update component styling and layouts
- Modify screen designs and user interface
- Improve visual consistency and user experience"
            ;;
        "feat")
            git commit -m "feat: Add new features and functionality

- Implement new components and features
- Add new functionality to existing components
- Enhance user experience with new capabilities"
            ;;
        "refactor")
            git commit -m "refactor: Improve code structure and organization

- Refactor existing code for better maintainability
- Improve code organization and structure
- Update implementation without changing functionality"
            ;;
        "ios")
            git commit -m "build: Update iOS configuration and assets

- Update iOS build configuration
- Modify Xcode project settings
- Update iOS-specific assets and configurations"
            ;;
        "android")
            git commit -m "build: Update Android configuration

- Update Android build configuration
- Modify Gradle settings and dependencies
- Update Android-specific configurations"
            ;;
        "services")
            git commit -m "refactor: Update service layer and utilities

- Improve service implementations
- Update utility functions and helpers
- Enhance error handling and reliability"
            ;;
        "contexts")
            git commit -m "feat: Update context providers and state management

- Add new context providers
- Update state management logic
- Improve data flow and state handling"
            ;;
        "chore")
            git commit -m "chore: Clean up and maintenance tasks

- Remove obsolete files and configurations
- Update documentation and comments
- Perform maintenance and cleanup tasks"
            ;;
        *)
            git commit -m "$message"
            ;;
    esac
    
    print_success "Committed $category files"
}

# Analyze and categorize files
print_status "Analyzing and categorizing files..."

# Initialize arrays for each category
config_files=()
ui_files=()
feat_files=()
refactor_files=()
ios_files=()
android_files=()
services_files=()
contexts_files=()
chore_files=()

# Read git status and categorize files
while IFS= read -r line; do
    status=$(echo "$line" | cut -c1-2)
    file=$(echo "$line" | cut -c4-)
    
    # Skip if file is already staged
    if [[ "$status" == "A " ]] || [[ "$status" == "M " ]]; then
        case "$file" in
            # Configuration files
            *.json|*.js|*.ts|*.config.*|package.json|tsconfig.json|babel.config.js|metro.config.js|tailwind.config.js|*.toml)
                config_files+=("$file")
                ;;
            # iOS files
            ios/*|*.xcodeproj/*|*.plist|*.entitlements|*.storyboard|*.pbxproj|Podfile*|*.swift|*.m)
                ios_files+=("$file")
                ;;
            # Android files
            android/*|*.gradle|*.xml|*.properties)
                android_files+=("$file")
                ;;
            # UI/Style files
            app/**/*.tsx|components/**/*.tsx|design-system/**/*)
                ui_files+=("$file")
                ;;
            # Context files
            contexts/*.tsx)
                contexts_files+=("$file")
                ;;
            # Service files
            lib/services/**/*.ts|lib/**/*.ts|hooks/*.ts)
                services_files+=("$file")
                ;;
            # New features (untracked files)
            *)
                if [[ "$status" == "??" ]]; then
                    case "$file" in
                        components/**|app/**)
                            feat_files+=("$file")
                            ;;
                        *)
                            chore_files+=("$file")
                            ;;
                    esac
                else
                    chore_files+=("$file")
                fi
                ;;
        esac
    fi
done < /tmp/git_status.txt

# Commit files by category in logical order
print_status "Creating focused commits..."

commit_by_category "config" "${config_files[@]}"
commit_by_category "contexts" "${contexts_files[@]}"
commit_by_category "services" "${services_files[@]}"
commit_by_category "feat" "${feat_files[@]}"
commit_by_category "ui" "${ui_files[@]}"
commit_by_category "ios" "${ios_files[@]}"
commit_by_category "android" "${android_files[@]}"
commit_by_category "chore" "${chore_files[@]}"

# Clean up
rm -f /tmp/git_status.txt

print_success "All changes committed successfully!"
print_status "Run 'git push' to push changes to remote repository"

# Show final status
echo ""
print_status "Final git status:"
git status --short
