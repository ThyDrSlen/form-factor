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
  s.platform       = :ios, '13.0'
  s.swift_version  = '5.4'
  s.source         = { git: '' }
  s.static_framework = true
  s.module_name    = 'arkit_body_tracker'

  s.dependency 'ExpoModulesCore'

  # Swift source files
  s.source_files = "ios/**/*.{h,m,swift}"
  s.exclude_files = [
    "ios/**/*Tests.swift",
    "ios/ARKitTest.swift"
  ]
end
