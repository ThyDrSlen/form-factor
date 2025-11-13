const { withXcodeProject, XcodeProject } = require('@expo/config-plugins');

/**
 * Disables asset catalog thinning for Debug builds to prevent AssetCatalogSimulatorAgent errors
 */
const withDisableAssetThinning = (config) => {
  return withXcodeProject(config, async (config) => {
    const xcodeProject = config.modResults;
    
    // Get all build configurations
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    
    Object.keys(configurations).forEach((configUuid) => {
      const buildSettings = configurations[configUuid];
      
      // Only modify Debug configurations
      if (buildSettings.name === 'Debug' && buildSettings.buildSettings) {
        // Disable asset thinning for Debug builds by clearing these settings
        delete buildSettings.buildSettings.ASSETCATALOG_FILTER_FOR_THINNING_DEVICE_CONFIGURATION;
        delete buildSettings.buildSettings.ASSETCATALOG_FILTER_FOR_DEVICE_MODEL;
        delete buildSettings.buildSettings.ASSETCATALOG_FILTER_FOR_DEVICE_OS_VERSION;
      }
    });
    
    return config;
  });
};

module.exports = withDisableAssetThinning;


