Pod::Spec.new do |s|
  s.name = 'LopBackgroundLaunch'
  s.version = '1.0.0'
  s.summary = 'Starts React Native when iOS launches the app in the background with no scene'
  s.description = 'Workaround for expo/expo#52878 under the UIKit scene lifecycle (Expo SDK 57 ios.enableSceneSupport).'
  s.license = 'MIT'
  s.author = 'Local Operator contributors'
  s.homepage = 'https://github.com/damianvtran/local-operator-mobile'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { git: 'https://github.com/damianvtran/local-operator-mobile.git' }
  s.static_framework = true
  # `Expo` provides ExpoReactNativeFactoryProvider (the scene-support AppDelegate
  # conforms to it) and, through its own dependencies, React's RCTRootViewFactory.
  # Same dependency set as the upstream workaround (expo/expo#52878).
  s.dependency 'ExpoModulesCore'
  s.dependency 'Expo'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
