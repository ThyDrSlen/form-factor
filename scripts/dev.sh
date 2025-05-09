#!/usr/bin/env bash
# Developer helper script for Form Factor
# Usage: ./scripts/dev.sh <command>
# Commands:
#   help            Show this usage
#   setup-info      Ensure SUPABASE_URL & SUPABASE_ANON_KEY in Info.plist
#   fix-tests       Patch test files for XCTest and target membership reminders
#   debug-tests     Recursively scan test files for import Testing/missing imports
#   run-tests       Build and run tests via xcodebuild
#   lint            Run SwiftLint if installed
#   clean           Clean Xcode build artifacts
#   open            Open Xcode project

set -e
PROJECT_ROOT="$(cd "$(dirname "$0")"/.. && pwd)"
PLIST_PATH="$PROJECT_ROOT/form-factor/Info.plist"
XCODEPROJ="$PROJECT_ROOT/form-factor.xcodeproj"
SCHEME="form-factor"

function usage() {
  cat <<EOF
Available commands:
  help        Show this message
  setup-info  Add SUPABASE_URL & SUPABASE_ANON_KEY to Info.plist (reads env vars)
  fix-tests   Patch test sources and remind target membership changes
  debug-tests  Recursively scan test files for import Testing/missing imports
  run-tests   Run XCTest suite via xcodebuild
  lint        Run SwiftLint if installed
  clean       Clean Xcode build artifacts
  open        Open Xcode project
EOF
}

function setup_info() {
  if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
    echo "Please export SUPABASE_URL and SUPABASE_ANON_KEY before running setup-info"
    exit 1
  fi
  echo "Setting up Info.plist at $PLIST_PATH"
  /usr/libexec/PlistBuddy -c "Delete :SUPABASE_URL" "$PLIST_PATH" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Delete :SUPABASE_ANON_KEY" "$PLIST_PATH" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :SUPABASE_URL string $SUPABASE_URL" "$PLIST_PATH"
  /usr/libexec/PlistBuddy -c "Add :SUPABASE_ANON_KEY string $SUPABASE_ANON_KEY" "$PLIST_PATH"
  echo "✅ Info.plist configured."
}

function fix_tests() {
  echo "Patching test files..."
  # remove import Testing
  grep -Rl "import Testing" "$PROJECT_ROOT" | xargs sed -i '' '/import Testing/d' || true
  # ensure @testable import form_factor
  for f in "$PROJECT_ROOT/form-factor"/Tests/form-factorTests/*.swift; do
    if ! grep -q "@testable import form_factor" "$f"; then
      sed -i '' '1,/^import XCTest$/s|^import XCTest$|&\n@testable import form_factor|' "$f"
      echo "Patched @testable in $f"
    fi
  done
  echo "Remind: In Xcode, set test files to only belong to test target under File Inspector."
}

function debug_tests() {
  echo "🔍 Debugging test files in Tests/form-factorTests:"
  find "$PROJECT_ROOT/form-factor/Tests/form-factorTests" -name '*.swift' | while read f; do
    echo "-- $f"
    grep -q 'import Testing' "$f" && echo "   ❌ uses import Testing"
    grep -q 'import XCTest' "$f" || echo "   ⚠️ missing import XCTest"
    grep -q '@testable import form_factor' "$f" || echo "   ⚠️ missing @testable import form_factor"
  done
}


# function run_on_fc_phone(){
#   # runs on my perosnal local phone named "fc" connected via wifi  

  
# }

function run_tests() {
  echo "Running tests via xcodebuild..."
  local cmd=(xcodebuild -project "$XCODEPROJ" -scheme "$SCHEME" -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' test)
  if command -v xcpretty >/dev/null; then
    "${cmd[@]}" | xcpretty || true
  else
    "${cmd[@]}"
  fi
}

function lint() {
  if command -v swiftlint >/dev/null; then
    swiftlint --config "$PROJECT_ROOT/.swiftlint.yml"
  else
    echo "swiftlint not installed. Install via 'brew install swiftlint'"
  fi
}

function clean() {
  xcodebuild clean -project "$XCODEPROJ" -scheme "$SCHEME"
}

function open_proj() {
  open "$XCODEPROJ"
}

case "$1" in
  help|"" ) usage ;;  
  setup-info ) setup_info ;;  
  fix-tests ) fix_tests ;;  
  debug-tests ) debug_tests ;;  
  run-tests ) run_tests ;;  
  lint ) lint ;;  
  clean ) clean ;;  
  open ) open_proj ;;  
  * ) echo "Unknown command: $1"; usage; exit 1 ;;
esac
