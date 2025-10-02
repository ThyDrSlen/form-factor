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
      const bridgingHeaderSource = path.join(projectRoot, 'native', 'formfactoreas-Bridging-Header.h');
      
      // Destination in ios/projectName/
      const swiftDest = path.join(iosRoot, projectName, 'VisionPoseDetector.swift');
      const objcDest = path.join(iosRoot, projectName, 'VisionPoseDetector.m');
      const bridgingHeaderDest = path.join(iosRoot, projectName, 'formfactoreas-Bridging-Header.h');
      
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
      
      if (fs.existsSync(bridgingHeaderSource)) {
        fs.copyFileSync(bridgingHeaderSource, bridgingHeaderDest);
        console.log('✅ Copied formfactoreas-Bridging-Header.h');
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
      // Get the first native target
      const target = xcodeProject.getFirstTarget();
      
      if (!target) {
        throw new Error('No native target found in Xcode project');
      }
      
      // Extract target UUID
      let targetUuid = target.uuid;
      if (!targetUuid) {
        const nativeTargets = xcodeProject.pbxNativeTargetSection();
        if (nativeTargets) {
          const targetKeys = Object.keys(nativeTargets).filter(key => !key.endsWith('_comment'));
          if (targetKeys.length > 0) {
            targetUuid = targetKeys[0];
          }
        }
      }
      
      if (!targetUuid) {
        throw new Error('Could not extract target UUID from Xcode project');
      }
      
      console.log('[VisionPoseDetector] Target UUID:', targetUuid);
      
      // Helper function to manually add a source file to avoid xcode library bugs
      const addSourceFileManually = (filePath, fileName, fileType) => {
        if (xcodeProject.hasFile(filePath)) {
          console.log(`[VisionPoseDetector] ${fileName} already in project`);
          return;
        }
        
        // Generate UUIDs for the file reference and build file
        const generateUuid = () => {
          const chars = '0123456789ABCDEF';
          let uuid = '';
          for (let i = 0; i < 24; i++) {
            uuid += chars.charAt(Math.floor(Math.random() * 16));
          }
          return uuid;
        };
        
        const fileRefUuid = generateUuid();
        const buildFileUuid = generateUuid();
        
        // Add file reference to PBXFileReference section
        const fileReferences = xcodeProject.pbxFileReferenceSection();
        fileReferences[fileRefUuid] = {
          isa: 'PBXFileReference',
          lastKnownFileType: fileType,
          name: fileName,
          path: `${projectName}/${fileName}`,
          sourceTree: '"<group>"'
        };
        fileReferences[`${fileRefUuid}_comment`] = fileName;
        
        // Add build file to PBXBuildFile section
        const buildFiles = xcodeProject.pbxBuildFileSection();
        buildFiles[buildFileUuid] = {
          isa: 'PBXBuildFile',
          fileRef: fileRefUuid,
          fileRef_comment: fileName
        };
        buildFiles[`${buildFileUuid}_comment`] = `${fileName} in Sources`;
        
        // Add to the target's Sources build phase
        const buildPhases = xcodeProject.hash.project.objects['PBXSourcesBuildPhase'];
        for (const phaseKey in buildPhases) {
          if (!phaseKey.endsWith('_comment') && buildPhases[phaseKey]) {
            if (!buildPhases[phaseKey].files) {
              buildPhases[phaseKey].files = [];
            }
            buildPhases[phaseKey].files.push({
              value: buildFileUuid,
              comment: `${fileName} in Sources`
            });
            break;
          }
        }
        
        // Add to the project group
        const groups = xcodeProject.hash.project.objects['PBXGroup'];
        for (const groupKey in groups) {
          if (!groupKey.endsWith('_comment')) {
            const group = groups[groupKey];
            if (group && (group.name === projectName || group.path === projectName)) {
              if (!group.children) {
                group.children = [];
              }
              group.children.push({
                value: fileRefUuid,
                comment: fileName
              });
              break;
            }
          }
        }
        
        console.log(`✅ Added ${fileName} to Xcode project`);
      };
      
      // Add Swift file
      addSourceFileManually(
        `${projectName}/VisionPoseDetector.swift`,
        'VisionPoseDetector.swift',
        'sourcecode.swift'
      );
      
      // Add Obj-C file
      addSourceFileManually(
        `${projectName}/VisionPoseDetector.m`,
        'VisionPoseDetector.m',
        'sourcecode.c.objc'
      );
      
    } catch (error) {
      console.error('[VisionPoseDetector] Error:', error.message);
      console.warn('[VisionPoseDetector] Files will need to be added manually via Xcode');
    }
    
    return config;
  });

  return config;
};

module.exports = withVisionPoseDetector;
