const { withDangerousMod, IOSConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withVisionPoseDetector = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const iosRoot = config.modRequest.platformProjectRoot;
      const projectName = config.modRequest.projectName || 'formfactoreas';
      
      // Copy Swift file
      const swiftSource = path.join(config.modRequest.projectRoot, 'ios', 'VisionPoseDetector.swift');
      const swiftDest = path.join(iosRoot, projectName, 'VisionPoseDetector.swift');
      
      if (fs.existsSync(swiftSource)) {
        fs.copyFileSync(swiftSource, swiftDest);
        console.log('✅ Copied VisionPoseDetector.swift');
      }
      
      // Copy Objective-C file
      const objcSource = path.join(config.modRequest.projectRoot, 'ios', 'VisionPoseDetector.m');
      const objcDest = path.join(iosRoot, projectName, 'VisionPoseDetector.m');
      
      if (fs.existsSync(objcSource)) {
        fs.copyFileSync(objcSource, objcDest);
        console.log('✅ Copied VisionPoseDetector.m');
      }
      
      return config;
    },
  ]);
};

module.exports = withVisionPoseDetector;
