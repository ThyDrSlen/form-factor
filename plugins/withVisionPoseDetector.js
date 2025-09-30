const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withVisionPoseDetector = (config) => {
  // First: Copy files to the ios directory (before Xcode project modification)
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const iosRoot = config.modRequest.platformProjectRoot;
      const projectName = config.modRequest.projectName || 'formfactoreas';
      const projectRoot = config.modRequest.projectRoot;
      
      console.log('[VisionPoseDetector] Copying native files...');
      
      // Source files are in a safe location outside ios/
      const swiftSource = path.join(projectRoot, 'native', 'VisionPoseDetector.swift');
      const objcSource = path.join(projectRoot, 'native', 'VisionPoseDetector.m');
      
      // Destination in ios/projectName/
      const swiftDest = path.join(iosRoot, projectName, 'VisionPoseDetector.swift');
      const objcDest = path.join(iosRoot, projectName, 'VisionPoseDetector.m');
      
      // Ensure native directory exists
      const nativeDir = path.join(projectRoot, 'native');
      if (!fs.existsSync(nativeDir)) {
        fs.mkdirSync(nativeDir, { recursive: true });
      }
      
      // Create Swift file if it doesn't exist
      if (!fs.existsSync(swiftSource)) {
        console.log('[VisionPoseDetector] Creating VisionPoseDetector.swift...');
        fs.writeFileSync(swiftSource, fs.readFileSync(path.join(__dirname, '../native/VisionPoseDetector.swift')));
      }
      
      // Create Obj-C file if it doesn't exist
      if (!fs.existsSync(objcSource)) {
        console.log('[VisionPoseDetector] Creating VisionPoseDetector.m...');
        fs.writeFileSync(objcSource, fs.readFileSync(path.join(__dirname, '../native/VisionPoseDetector.m')));
      }
      
      // Copy files
      if (fs.existsSync(swiftSource)) {
        fs.copyFileSync(swiftSource, swiftDest);
        console.log('✅ Copied VisionPoseDetector.swift');
      }
      
      if (fs.existsSync(objcSource)) {
        fs.copyFileSync(objcSource, objcDest);
        console.log('✅ Copied VisionPoseDetector.m');
      }
      
      return config;
    },
  ]);

  // Second: Add files to Xcode project (after they've been copied)
  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const projectName = 'formfactoreas';
    
    console.log('[VisionPoseDetector] Adding files to Xcode project...');
    
    try {
      // Add Swift file
      const swiftFile = `${projectName}/VisionPoseDetector.swift`;
      if (!xcodeProject.hasFile(swiftFile)) {
        const target = xcodeProject.getFirstTarget();
        if (target && target.uuid) {
          xcodeProject.addSourceFile(swiftFile, {}, target.uuid);
          console.log('✅ Added VisionPoseDetector.swift to Xcode');
        }
      }
      
      // Add Obj-C file
      const objcFile = `${projectName}/VisionPoseDetector.m`;
      if (!xcodeProject.hasFile(objcFile)) {
        const target = xcodeProject.getFirstTarget();
        if (target && target.uuid) {
          xcodeProject.addSourceFile(objcFile, {}, target.uuid);
          console.log('✅ Added VisionPoseDetector.m to Xcode');
        }
      }
    } catch (error) {
      console.warn('[VisionPoseDetector] Warning: Could not add files to Xcode project:', error.message);
      console.warn('[VisionPoseDetector] Files will need to be added manually via Xcode');
    }
    
    return config;
  });

  return config;
};

module.exports = withVisionPoseDetector;
