const { withInfoPlist } = require('@expo/config-plugins');

/**
 * Expo config plugin for ARKit Body Tracking
 * Configures required permissions and capabilities for ARKit body tracking
 */
function withARKitBodyTracker(config) {
  // Add required permissions to Info.plist
  config = withInfoPlist(config, (config) => {
    config.modResults.NSCameraUsageDescription =
      config.modResults.NSCameraUsageDescription ||
      'This app needs camera access for real-time body tracking and form analysis during workouts.';

    // ARKit doesn't require special Info.plist entries beyond camera permission
    // The ARBodyTrackingConfiguration capability is automatically available on supported devices
    
    return config;
  });

  return config;
}

module.exports = withARKitBodyTracker;
