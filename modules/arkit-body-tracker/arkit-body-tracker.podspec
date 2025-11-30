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

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.dependency 'ExpoModulesCore'

  # iOS frameworks required for ARKit body tracking
  s.frameworks = 'ARKit', 'RealityKit', 'AVFoundation', 'UIKit'

  # Swift source files
  s.source_files = "ios/**/*.{h,m,swift}"
  s.exclude_files = [
    "ios/**/*Tests.swift",
    "ios/ARKitTest.swift"
  ]

  # Preserve the podspec for autolinking
  s.preserve_paths = ['*.podspec', 'expo-module.config.json']
end
