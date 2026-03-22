require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'arkit-body-tracker'
  s.version        = package['version']
  s.summary        = package['description'] || 'ARKit Body Tracking Module'
  s.description    = package['description'] || 'Expo module for ARKit 3D body tracking'
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage'] || 'https://github.com/slenthekid/form-factor'
  s.platforms      = { :ios => '14.0' }
  s.swift_version  = '5.4'
  s.source         = { :path => '.' }
  s.module_name    = 'arkit_body_tracker'
  s.static_framework = true

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'FRAMEWORK_SEARCH_PATHS' => '$(inherited) "$(PODS_XCFRAMEWORKS_BUILD_DIR)/MediaPipeTasksCommon" "$(PODS_XCFRAMEWORKS_BUILD_DIR)/MediaPipeTasksVision"',
    'LIBRARY_SEARCH_PATHS' => '$(inherited) "$(PODS_XCFRAMEWORKS_BUILD_DIR)/MediaPipeTasksCommon" "$(PODS_XCFRAMEWORKS_BUILD_DIR)/MediaPipeTasksVision"',
  }

  # Propagate framework search paths to the main app target so the linker
  # can find the MediaPipe xcframeworks at link time (CocoaPods #9623).
  s.user_target_xcconfig = {
    'FRAMEWORK_SEARCH_PATHS' => '$(inherited) "$(PODS_XCFRAMEWORKS_BUILD_DIR)/MediaPipeTasksCommon" "$(PODS_XCFRAMEWORKS_BUILD_DIR)/MediaPipeTasksVision"',
    'LIBRARY_SEARCH_PATHS' => '$(inherited) "$(PODS_XCFRAMEWORKS_BUILD_DIR)/MediaPipeTasksCommon" "$(PODS_XCFRAMEWORKS_BUILD_DIR)/MediaPipeTasksVision"',
  }

  s.dependency 'ExpoModulesCore'
  s.dependency 'MediaPipeTasksVision', '0.10.21'
  s.dependency 'MediaPipeTasksCommon', '0.10.21'

  # iOS frameworks required for ARKit body tracking
  s.frameworks = 'ARKit', 'RealityKit', 'AVFoundation', 'UIKit'

  # Swift source files - explicit paths for EAS build compatibility
  s.source_files = [
    "ios/ARKitBodyTrackerModule.swift",
    "ios/ARKitBodyView.swift"
  ]

  # Preserve the podspec for autolinking
  s.preserve_paths = ['*.podspec', 'expo-module.config.json']
end
