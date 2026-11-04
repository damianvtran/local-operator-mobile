# Extend the GENERATED Expo project only. The test host is its real application
# target (including Expo, native module and Keychain), never a fixture executable.
# CocoaPods on hosted images may isolate its pure-Ruby gems in libexec rather
# than the shell Ruby's GEM_PATH. Reuse that installed tree; never install gems.
require 'rubygems'
pod = File.realpath(`command -v pod`.strip)
base = File.dirname(File.dirname(pod))
Gem.use_paths(Gem.dir, [base, File.join(base, 'libexec'), *Gem.path])
require 'xcodeproj'
project = Xcodeproj::Project.open(Dir['ios/*.xcodeproj'].first)
app = project.targets.find { |t| t.product_type == 'com.apple.product-type.application' }
raise 'Expected exactly one Expo app' unless app
ui = project.new_target(:ui_test_bundle, 'SignInAppUITests', :ios, '16.4')
ui.add_dependency(app)
ui.add_file_references([project.main_group.new_file(File.expand_path('scripts/ci/signin-app-proof/SignInAppUITests.swift'))])
info = File.expand_path('ios/SignInAppUITests-Info.plist')
Xcodeproj::Plist.write_to_path({
  'CFBundleIdentifier' => '$(PRODUCT_BUNDLE_IDENTIFIER)',
  'CFBundleName' => '$(PRODUCT_NAME)', 'CFBundleExecutable' => '$(EXECUTABLE_NAME)',
  'CFBundlePackageType' => 'BNDL', 'CFBundleVersion' => '1',
  'CFBundleShortVersionString' => '1.0',
  'NSAppTransportSecurity' => { 'NSAllowsLocalNetworking' => true }
}, info)
ui.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'dev.localoperator.signinproof.tests',
    'SWIFT_VERSION' => '5.0', 'GENERATE_INFOPLIST_FILE' => 'NO', 'INFOPLIST_FILE' => info,
    'TEST_TARGET_NAME' => app.name, 'CODE_SIGNING_ALLOWED' => 'NO'
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_build_target(ui)
scheme.add_test_target(ui)
scheme.test_action.build_configuration = 'Debug'
scheme.save_as(project.path, 'SignInAppProof', true)
puts "Real Expo UI-test host: #{app.name}"
