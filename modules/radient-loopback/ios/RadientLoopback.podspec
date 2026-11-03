Pod::Spec.new do |s|
  s.name = 'RadientLoopback'
  s.version = '1.0.0'
  s.summary = 'Device-local OAuth callback transport'
  s.description = 'A bounded IPv4 loopback listener for the registered Radient OAuth redirect.'
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
