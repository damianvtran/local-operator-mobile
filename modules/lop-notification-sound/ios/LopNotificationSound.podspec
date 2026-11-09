Pod::Spec.new do |s|
  s.name = 'LopNotificationSound'
  s.version = '1.0.0'
  s.summary = 'Content-addressed notification sound storage'
  s.description = 'Durable Library/Sounds storage and readiness inventory.'
  s.license = 'MIT'
  s.author = 'Local Operator contributors'
  s.homepage = 'https://github.com/damianvtran/local-operator-mobile'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { git: 'https://github.com/damianvtran/local-operator-mobile.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
