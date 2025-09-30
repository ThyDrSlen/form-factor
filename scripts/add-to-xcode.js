#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 Adding VisionPoseDetector files to Xcode project...');

const projectRoot = path.join(__dirname, '..');
const iosRoot = path.join(projectRoot, 'ios');
const projectName = 'formfactoreas';
const projectFile = path.join(iosRoot, `${projectName}.xcodeproj`, 'project.pbxproj');

// Files to add
const filesToAdd = [
  `${projectName}/VisionPoseDetector.swift`,
  `${projectName}/VisionPoseDetector.m`
];

console.log('📋 Files to add:', filesToAdd);

// Read the project file
let projectContent = fs.readFileSync(projectFile, 'utf8');

// Check if files are already in the project
const alreadyAdded = filesToAdd.filter(file => projectContent.includes(file));
if (alreadyAdded.length > 0) {
  console.log('✅ Files already in project:', alreadyAdded);
}

const filesToAddToProject = filesToAdd.filter(file => !projectContent.includes(file));

if (filesToAddToProject.length === 0) {
  console.log('✅ All files are already in the Xcode project!');
  process.exit(0);
}

console.log('📝 Files to add to project:', filesToAddToProject);

// Generate UUIDs for the files
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Find the main target UUID
const targetMatch = projectContent.match(/PBXNativeTarget.*name = ${projectName};/);
if (!targetMatch) {
  console.error('❌ Could not find main target in project file');
  process.exit(1);
}

const targetUUID = targetMatch[0].match(/[A-F0-9]{24}/)[0];
console.log('🎯 Target UUID:', targetUUID);

// Add file references
let fileUUIDs = [];
filesToAddToProject.forEach(file => {
  const fileUUID = generateUUID();
  fileUUIDs.push(fileUUID);
  
  // Add file reference
  const fileRef = `		${fileUUID} /* ${file} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "${path.basename(file)}"; sourceTree = "<group>"; };`;
  
  // Find the PBXFileReference section and add the file
  const fileRefSection = projectContent.match(/\/\* Begin PBXFileReference section \*\/[\s\S]*?\/\* End PBXFileReference section \*\//);
  if (fileRefSection) {
    const newFileRefSection = fileRefSection[0].replace(
      /(\/\* End PBXFileReference section \*\/)/,
      `${fileRef}\n$1`
    );
    projectContent = projectContent.replace(fileRefSection[0], newFileRefSection);
  }
  
  // Add to build phases
  const buildPhaseMatch = projectContent.match(/PBXSourcesBuildPhase.*files = \([\s\S]*?\);.*name = Sources;/);
  if (buildPhaseMatch) {
    const buildPhaseUUID = buildPhaseMatch[0].match(/[A-F0-9]{24}/)[0];
    const buildFileUUID = generateUUID();
    
    // Add build file
    const buildFile = `		${buildFileUUID} /* ${file} in Sources */ = {isa = PBXBuildFile; fileRef = ${fileUUID} /* ${file} */; };`;
    const buildFileSection = projectContent.match(/\/\* Begin PBXBuildFile section \*\/[\s\S]*?\/\* End PBXBuildFile section \*\//);
    if (buildFileSection) {
      const newBuildFileSection = buildFileSection[0].replace(
        /(\/\* End PBXBuildFile section \*\/)/,
        `${buildFile}\n$1`
      );
      projectContent = projectContent.replace(buildFileSection[0], newBuildFileSection);
    }
    
    // Add to sources build phase
    const sourcesBuildPhase = projectContent.match(/PBXSourcesBuildPhase.*files = \([\s\S]*?\);.*name = Sources;/);
    if (sourcesBuildPhase) {
      const newSourcesBuildPhase = sourcesBuildPhase[0].replace(
        /(files = \()/,
        `$1\n\t\t\t${buildFileUUID} /* ${file} in Sources */,`
      );
      projectContent = projectContent.replace(sourcesBuildPhase[0], newSourcesBuildPhase);
    }
  }
});

// Write the updated project file
fs.writeFileSync(projectFile, projectContent);

console.log('✅ Successfully added files to Xcode project!');
console.log('🎯 Next steps:');
console.log('1. Open Xcode: ios/formfactoreas.xcworkspace');
console.log('2. Build the project');
console.log('3. Run the app - pose detection should now work!');