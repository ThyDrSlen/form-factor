#!/usr/bin/env bash
# run from the form-factor folder


# 2) Ensure @testable import form_factor is present in each test
for f in Tests/form-factorTests/*.swift; do
  if ! grep -q "@testable import form_factor" "$f"; then
    # insert after any imports
    sed -i '' '1,/^import XCTest$/s|^import XCTest$|&\n@testable import form_factor|' "$f"
  fi
done

echo 
echo "⚠️  NEXT STEP: In Xcode, select each test file under Tests → form-factorTests, open the File Inspector, and set Target Membership so that **only** the form-factorTests target is checked (uncheck your main app target). Then Clean (⇧⌘K) and Run Tests (⌘U)."

# 3) Run tests on specific device
DEST="platform=iOS,arch=arm64,id=00008130-001829021A20001C,name=fc"
echo "Running tests on device: $DEST"
xcodebuild \
  -scheme form-factor \
  -destination "$DEST" \
  -testPlan "Test Scheme Action" \
  test