# Reuse the existing CocoaPods-shipped pure Ruby project library. Never install
# gems or open/extend the product project: this graph has exactly TWO targets.
require 'rubygems'
require 'fileutils'
require 'json'
pod = File.realpath(`command -v pod`.strip)
base = File.dirname(File.dirname(pod))
Gem.use_paths(Gem.dir, [base, File.join(base, 'libexec'), *Gem.path])
require 'xcodeproj'
out = File.expand_path(ARGV.fetch(0))
FileUtils.mkdir_p(out)
project = Xcodeproj::Project.new(File.join(out, 'TransportCarrier.xcodeproj'))
carrier = project.new_target(:application, 'TransportCarrier', :ios, '16.4')
ui = project.new_target(:ui_test_bundle, 'TransportUITests', :ios, '16.4')
ui.add_dependency(carrier)
carrier.add_file_references([project.main_group.new_file(File.expand_path('Carrier.swift', __dir__))])
ui.add_file_references([project.main_group.new_file(File.expand_path('TransportUITests.swift', __dir__))])
[carrier, ui].each do |target|
  info = File.join(out, target.name + '-Info.plist')
  values = {
    'CFBundleIdentifier' => '$(PRODUCT_BUNDLE_IDENTIFIER)', 'CFBundleName' => '$(PRODUCT_NAME)',
    'CFBundleExecutable' => '$(EXECUTABLE_NAME)', 'CFBundleVersion' => '1',
    'CFBundleShortVersionString' => '1.0', 'CFBundlePackageType' => target == carrier ? 'APPL' : 'BNDL'
  }
  # Control-plane requests in the TEST bundle only, following the existing UI
  # proof. The carrier has no networking; the installed app policy is untouched.
  values['NSAppTransportSecurity'] = { 'NSAllowsLocalNetworking' => true } if target == ui
  Xcodeproj::Plist.write_to_path(values, info)
  target.build_configurations.each do |config|
    config.build_settings.merge!({
      'PRODUCT_NAME' => '$(TARGET_NAME)', 'PRODUCT_MODULE_NAME' => target.name,
      'PRODUCT_BUNDLE_IDENTIFIER' => 'dev.localoperator.transport.' + target.name.downcase,
      'SWIFT_VERSION' => '5.0', 'GENERATE_INFOPLIST_FILE' => 'NO', 'INFOPLIST_FILE' => info,
      'CODE_SIGNING_ALLOWED' => 'YES', 'CODE_SIGN_IDENTITY' => '-',
      'CODE_SIGN_STYLE' => 'Manual', 'DEVELOPMENT_TEAM' => ''
    })
    config.build_settings['TEST_TARGET_NAME'] = carrier.name if target == ui
  end
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(carrier)
scheme.add_build_target(ui)
scheme.add_test_target(ui)
scheme.test_action.build_configuration = 'Debug'
scheme.save_as(project.path, 'TransportCarrier', true)
graph = project.targets.map { |t| { name: t.name, product_type: t.product_type, dependencies: t.dependencies.map { |d| d.target.name } } }
raise 'Unexpected build graph' unless graph.map { |t| t[:name] }.sort == ['TransportCarrier', 'TransportUITests'] && graph.find { |t| t[:name] == 'TransportUITests' }[:dependencies] == ['TransportCarrier']
File.write(File.join(out, 'target-graph.json'), JSON.pretty_generate(graph))
puts JSON.generate({ targets: graph.map { |t| t[:name] }, product_app_dependency: false })
