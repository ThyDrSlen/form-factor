const { withXcodeProject } = require('@expo/config-plugins');

/**
 * Expo Config Plugin: withBuildSettings
 * 
 * Configures Xcode build settings for both Debug and Release configurations.
 * Fixes "device not supported" errors by removing device-specific asset thinning
 * and ensuring proper architecture support.
 * 
 * Settings applied to BOTH Debug and Release:
 * - Removes ASSETCATALOG_FILTER_FOR_THINNING_DEVICE_CONFIGURATION
 * - Removes ASSETCATALOG_FILTER_FOR_DEVICE_MODEL
 * - Removes ASSETCATALOG_FILTER_FOR_DEVICE_OS_VERSION
 * - Ensures TARGETED_DEVICE_FAMILY includes iPhone (1) and iPad (2)
 * - Sets ONLY_ACTIVE_ARCH appropriately (YES for Debug, NO for Release)
 * 
 * Debug-specific:
 * - ONLY_ACTIVE_ARCH = YES (faster builds)
 * - DEBUG_INFORMATION_FORMAT = dwarf (faster builds)
 * 
 * Release-specific:
 * - ONLY_ACTIVE_ARCH = NO (universal binary)
 * - DEBUG_INFORMATION_FORMAT = dwarf-with-dsym (for crash symbolication)
 */
const applyBuildSettings = (xcodeProject, options = {}) => {
  const {
    // Default to supporting both iPhone and iPad
    targetedDeviceFamily = '1,2',
    // Minimum iOS deployment target
    iosDeploymentTarget = '15.1',
    // Enable bitcode (usually NO for modern apps)
    enableBitcode = 'NO',
  } = options;

  // Get all build configurations
  const configurations = xcodeProject.pbxXCBuildConfigurationSection();

  let debugCount = 0;
  let releaseCount = 0;

  Object.keys(configurations).forEach((configUuid) => {
    const buildConfig = configurations[configUuid];

    // Skip comment entries
    if (typeof buildConfig !== 'object' || !buildConfig.buildSettings) {
      return;
    }

    const buildSettings = buildConfig.buildSettings;
    const configName = buildConfig.name;
    const isTargetConfig = typeof buildSettings.PRODUCT_NAME === 'string';
    const sdkRoot = String(buildSettings.SDKROOT || '').toLowerCase();
    const isWatchOS = sdkRoot.includes('watchos');
    const isWatchApp = isWatchOS && String(buildSettings.WRAPPER_EXTENSION || '') === 'app';

    // Skip project-level configs; only mutate target configs.
    if (!isTargetConfig) {
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // COMMON SETTINGS (Both Debug and Release)
    // ═══════════════════════════════════════════════════════════════════

    // Remove device-specific asset thinning (causes "device not supported")
    delete buildSettings.ASSETCATALOG_FILTER_FOR_THINNING_DEVICE_CONFIGURATION;
    delete buildSettings.ASSETCATALOG_FILTER_FOR_DEVICE_MODEL;
    delete buildSettings.ASSETCATALOG_FILTER_FOR_DEVICE_OS_VERSION;

    // iOS-only defaults should not leak into watch targets.
    if (!isWatchOS) {
      buildSettings.TARGETED_DEVICE_FAMILY = `"${targetedDeviceFamily}"`;
      buildSettings.IPHONEOS_DEPLOYMENT_TARGET = iosDeploymentTarget;
    } else if (isWatchApp) {
      // Explicitly include both required watchOS architectures for uploads.
      buildSettings['ARCHS[sdk=watchos*]'] = '"arm64 arm64_32"';
    }

    // Disable bitcode (deprecated in Xcode 14+)
    buildSettings.ENABLE_BITCODE = enableBitcode;
    delete buildSettings.VALID_ARCHS;

    // ═══════════════════════════════════════════════════════════════════
    // DEBUG-SPECIFIC SETTINGS
    // ═══════════════════════════════════════════════════════════════════
    if (configName === 'Debug') {
      // Build only for active architecture (faster debug builds)
      buildSettings.ONLY_ACTIVE_ARCH = 'YES';

      // Use dwarf for faster debug builds
      buildSettings.DEBUG_INFORMATION_FORMAT = 'dwarf';

      debugCount++;
    }

    // ═══════════════════════════════════════════════════════════════════
    // RELEASE-SPECIFIC SETTINGS
    // ═══════════════════════════════════════════════════════════════════
    if (configName === 'Release') {
      // Build for ALL architectures (universal binary - fixes device support)
      buildSettings.ONLY_ACTIVE_ARCH = 'NO';

      // Include dSYM for crash symbolication
      buildSettings.DEBUG_INFORMATION_FORMAT = '"dwarf-with-dsym"';

      // Strip debug symbols for smaller binary
      buildSettings.STRIP_INSTALLED_PRODUCT = 'YES';
      buildSettings.COPY_PHASE_STRIP = 'YES';

      releaseCount++;
    }
  });

  return { debugCount, releaseCount };
};

const withBuildSettings = (config, options = {}) => {
  const { targetedDeviceFamily = '1,2', iosDeploymentTarget = '15.1' } = options;

  return withXcodeProject(config, async (config) => {
    const xcodeProject = config.modResults;
    const { debugCount, releaseCount } = applyBuildSettings(xcodeProject, options);

    console.log(`[withBuildSettings] ✅ Configured ${debugCount} Debug and ${releaseCount} Release build configurations`);
    console.log(`[withBuildSettings] - Removed device-specific asset thinning`);
    console.log(`[withBuildSettings] - Set TARGETED_DEVICE_FAMILY = ${targetedDeviceFamily}`);
    console.log(`[withBuildSettings] - Set IPHONEOS_DEPLOYMENT_TARGET = ${iosDeploymentTarget}`);
    console.log(`[withBuildSettings] - Debug: ONLY_ACTIVE_ARCH = YES (faster builds)`);
    console.log(`[withBuildSettings] - Release: ONLY_ACTIVE_ARCH = NO (universal binary)`);

    return config;
  });
};

module.exports = withBuildSettings;
module.exports.applyBuildSettings = applyBuildSettings;
