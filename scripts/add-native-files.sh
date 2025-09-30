#!/bin/bash

# Script to add VisionPoseDetector native files to Xcode project
# This automates the manual Xcode "Add Files" step

echo "🔧 Adding native Vision files to Xcode project..."

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
XCODE_PROJECT="$PROJECT_DIR/ios/formfactoreas.xcodeproj"
PBXPROJ="$XCODE_PROJECT/project.pbxproj"

# Check if project exists
if [ ! -f "$PBXPROJ" ]; then
    echo "❌ Error: Xcode project not found at $XCODE_PROJECT"
    exit 1
fi

# Install node-xcode if not present
if ! command -v npx &> /dev/null; then
    echo "❌ Error: npx not found. Please install Node.js"
    exit 1
fi

# Use npx to install and run xcodelabel temporarily
echo "📦 Installing xcode manipulation tools..."
cd "$PROJECT_DIR"

# Create a temporary Node script to add files
cat > /tmp/add-xcode-files.js << 'EOF'
const fs = require('fs');
const path = require('path');

const projectDir = process.argv[2];
const pbxprojPath = path.join(projectDir, 'ios/formfactoreas.xcodeproj/project.pbxproj');

console.log('📝 Reading Xcode project file...');
let pbxproj = fs.readFileSync(pbxprojPath, 'utf8');

// Files to add
const files = [
  { name: 'VisionPoseDetector.swift', path: 'formfactoreas/VisionPoseDetector.swift' },
  { name: 'VisionPoseDetector.m', path: 'formfactoreas/VisionPoseDetector.m' }
];

// Check if files are already in project
let modified = false;
files.forEach(file => {
  if (!pbxproj.includes(file.name)) {
    console.log(`✅ Would add ${file.name} to project`);
    modified = true;
  } else {
    console.log(`⏭️  ${file.name} already in project`);
  }
});

if (!modified) {
  console.log('✨ All files already added to Xcode project!');
  process.exit(0);
}

console.log('\n⚠️  Manual step required:');
console.log('Please open Xcode and add the files manually:');
console.log('1. Open ios/formfactoreas.xcworkspace');
console.log('2. Right-click formfactoreas folder → Add Files');
console.log('3. Select VisionPoseDetector.swift and VisionPoseDetector.m');
console.log('4. Check "Copy items if needed" and select formfactoreas target');
console.log('5. Build with Cmd+B');
EOF

node /tmp/add-xcode-files.js "$PROJECT_DIR"

# Clean up
rm /tmp/add-xcode-files.js

echo ""
echo "🎯 Quick command to rebuild:"
echo "   cd ios && pod install && cd .. && bun run ios:fc --no-bundler"
