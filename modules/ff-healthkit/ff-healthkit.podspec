require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ff-healthkit'
  s.version        = package['version']
  s.summary        = package['description'] || 'HealthKit bridge for Form Factor'
  s.description    = package['description'] || 'Expo module for HealthKit access'
  s.license        = package['license']
  s.author         = package['author'] || 'Form Factor'
  s.authors        = package['authors'] || { 'Form Factor' => 'dev@formfactor.app' }
  s.homepage       = package['homepage'] || 'https://github.com/ThyDrSlen/form-factor'
  s.platforms      = { :ios => '14.0' }
  s.swift_version  = '5.4'
  s.source         = { :git => 'https://github.com/ThyDrSlen/form-factor.git', :tag => s.version.to_s }
  s.module_name    = 'ff_healthkit'
  s.static_framework = true

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'HealthKit'

  s.source_files = [
    'ios/FFHealthKitModule.swift'
  ]

  s.preserve_paths = ['*.podspec', 'expo-module.config.json']
end
