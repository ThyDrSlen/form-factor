require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ff-watch-connectivity'
  s.version        = package['version']
  s.summary        = package['description'] || 'WatchConnectivity bridge for Form Factor'
  s.description    = package['description'] || 'Expo module wrapping WCSession messaging and state'
  s.license        = package['license']
  s.author         = package['author'] || 'Form Factor'
  s.homepage       = package['homepage'] || 'https://github.com/slenthekid/form-factor'
  s.platforms      = { :ios => '14.0' }
  s.swift_version  = '5.4'
  s.source         = { :path => '.' }
  s.module_name    = 'ff_watch_connectivity'
  s.static_framework = true

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity'

  s.source_files = [
    'ios/FFWatchConnectivityModule.swift'
  ]

  s.preserve_paths = ['*.podspec', 'expo-module.config.json']
end
