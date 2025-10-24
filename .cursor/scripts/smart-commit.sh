#!/bin/bash
# Smart commit helper for background agent
# Analyzes changes and suggests commit messages

set -e

echo "🤖 Smart Commit Assistant"
echo ""

# Check if there are changes to commit
if [[ -z $(git status --porcelain) ]]; then
  echo "❌ No changes to commit"
  exit 1
fi

# Show status
echo "📊 Git Status:"
git status --short
echo ""

# Show diff summary
echo "📝 Changes Summary:"
git diff --stat
echo ""

# Get list of changed files
CHANGED_FILES=$(git diff --name-only --cached)
if [[ -z "$CHANGED_FILES" ]]; then
  CHANGED_FILES=$(git diff --name-only)
fi

echo "📁 Changed Files:"
echo "$CHANGED_FILES"
echo ""

# Categorize changes
has_ts_changes=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' || true)
has_style_changes=$(echo "$CHANGED_FILES" | grep -E 'tailwind|theme|design-system' || true)
has_native_changes=$(echo "$CHANGED_FILES" | grep -E 'ios/|android/|native/' || true)
has_config_changes=$(echo "$CHANGED_FILES" | grep -E 'package.json|tsconfig|eslint|babel|metro|eas.json' || true)
has_doc_changes=$(echo "$CHANGED_FILES" | grep -E '\.md$' || true)
has_test_changes=$(echo "$CHANGED_FILES" | grep -E 'test|spec' || true)

# Suggest commit type
echo "💡 Suggested Commit Type:"
if [[ -n "$has_native_changes" ]]; then
  echo "   - feat(native): or fix(native): for native module changes"
elif [[ -n "$has_config_changes" ]]; then
  echo "   - chore(config): for configuration changes"
elif [[ -n "$has_doc_changes" ]]; then
  echo "   - docs: for documentation updates"
elif [[ -n "$has_test_changes" ]]; then
  echo "   - test: for test additions/updates"
elif [[ -n "$has_style_changes" ]]; then
  echo "   - style: or refactor: for styling changes"
elif [[ -n "$has_ts_changes" ]]; then
  echo "   - feat: for new features"
  echo "   - fix: for bug fixes"
  echo "   - refactor: for code improvements"
fi
echo ""

# Show recent commits for style reference
echo "📚 Recent Commit Style:"
git log --oneline -5
echo ""

echo "✨ Ready to commit! Use: git add <files> && git commit -m \"<type>: <message>\""
