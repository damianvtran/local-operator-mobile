# Execute the real Fastfile from Fastlane's lane cwd, without gems or Apple APIs.
# Synthetic adapters isolate path/scope behaviour; this is not signing proof.
require 'fileutils'
require 'json'
require 'tmpdir'

$lanes = {}
$called = []
def default_platform(*) end
def desc(*) end
def platform(name)
  $platform = name
  yield
end
def lane(name, &block)
  $lanes[[$platform, name]] = block
end
module UI
  def self.user_error!(message)
    raise message
  end
end
module Xcodeproj
  module Project
    def self.open(path)
      raise 'project must resolve from repository root' unless path == File.join($fixture, 'ios', 'SyntheticApp.xcodeproj')
      configuration = Struct.new(:name, :build_settings).new('Release', {
        'PRODUCT_BUNDLE_IDENTIFIER' => 'com.example.synthetic',
        'CODE_SIGN_ENTITLEMENTS' => '$(SRCROOT)/App/App.entitlements'
      })
      target = Struct.new(:product_type, :name, :build_configurations)
      app = target.new('com.apple.product-type.application', 'SyntheticApp', [configuration])
      pod = target.new('com.apple.product-type.library.static', 'SyntheticPod', [configuration])
      Struct.new(:native_targets).new([app, pod])
    end
  end
  module Plist
    def self.read_from_path(path)
      raise 'entitlement path must be absolute' unless path == File.join($fixture, 'ios', 'App', 'App.entitlements')
      JSON.parse(File.read(path))
    end
    def self.write_to_path(data, path)
      File.write(path, JSON.generate(data))
    end
  end
end
$LOADED_FEATURES << 'xcodeproj.rb'
def app_store_connect_api_key(**options)
  raise 'API key path must resolve from root' unless options[:key_filepath] == File.join($fixture, 'signing', 'asc-api-key.p8')
  $called << :key
  { synthetic: true }
end
def get_provisioning_profile(**options)
  raise 'profile download must be readonly' unless options[:readonly] && options[:skip_install] && options[:ignore_profiles_with_different_name]
  raise 'profile output must resolve from root' unless options[:output_path] == File.join($fixture, 'signing')
  $called << :profile
end
def update_code_signing_settings(**options)
  raise 'scope leaked to Pods' unless options[:targets] == ['SyntheticApp'] && options[:build_configurations] == ['Release']
  raise 'identity must be manual Distribution' unless options[:use_automatic_signing] == false && options[:code_sign_identity] == 'Apple Distribution'
  raise 'project action path must be absolute' unless options[:path] == File.join($fixture, 'ios', 'SyntheticApp.xcodeproj')
  $called << :settings
end
def upload_to_testflight(**options)
  raise 'relative IPA directory must resolve from root' unless options[:ipa] == File.join($fixture, 'artifacts', 'synthetic.ipa')
  $called << :testflight
end
def supply(**options)
  raise 'AAB path must resolve from root' unless options[:aab] == File.join($fixture, 'artifacts', 'synthetic.aab')
  raise 'service key path must resolve from root' unless options[:json_key] == File.join($fixture, 'signing', 'synthetic.json')
  $called << :play
end

source = File.expand_path('../../fastlane/Fastfile', __dir__)
raise 'missing source Fastfile' unless File.file?(source)
base = ENV['LOCAL_OPERATOR_SCRATCHPAD'] || ENV['RUNNER_TEMP'] || Dir.tmpdir
Dir.mktmpdir('fastlane-cwd-test-', base) do |root|
  $fixture = root
  %w[fastlane ios/SyntheticApp.xcodeproj ios/App signing artifacts].each { |path| FileUtils.mkdir_p(File.join(root, path)) }
  FileUtils.cp(source, File.join(root, 'fastlane', 'Fastfile'))
  File.write(File.join(root, 'ios', 'App', 'App.entitlements'), JSON.generate({ 'aps-environment' => 'development' }))
  File.write(File.join(root, 'signing', 'asc-api-key.p8'), 'synthetic fixture, not a credential')
  File.write(File.join(root, 'signing', 'synthetic.json'), '{}')
  File.write(File.join(root, 'artifacts', 'synthetic.ipa'), 'synthetic fixture, not an IPA')
  File.write(File.join(root, 'artifacts', 'synthetic.aab'), 'synthetic fixture, not an AAB')
  Dir.chdir(File.join(root, 'fastlane')) do
    # Negative control reproduces the original failure in the actual lane cwd.
    raise 'negative control did not discriminate' unless Dir['ios/*.xcodeproj'].empty?
    puts 'PASS negative control: old relative project glob finds zero projects from fastlane/'
    load File.join(root, 'fastlane', 'Fastfile')
    ENV['LO_IOS_SIGNING_DIR'] = 'signing'
    ENV['LO_IOS_PROFILE_NAME'] = 'Synthetic profile'
    ENV['APPLE_TEAM_ID'] = 'SYNTHETIC1'
    ENV['APPLE_ASC_KEY_ID'] = 'SYNTHETIC2'
    ENV['APPLE_ASC_ISSUER_ID'] = 'SYNTHETIC3'
    ENV['LO_IOS_IPA_DIR'] = 'artifacts'
    ENV['APPLE_ASC_PRIVATE_KEY_PATH'] = 'signing/asc-api-key.p8'
    ENV['LO_ANDROID_AAB'] = 'artifacts/synthetic.aab'
    ENV['SUPPLY_JSON_KEY'] = 'signing/synthetic.json'
    $lanes[[:ios, :prepare_distribution]].call
    $lanes[[:ios, :testflight]].call
    $lanes[[:android, :internal]].call
    raise 'missing lane execution' unless $called == [:key, :profile, :settings, :key, :testflight, :play]
    raise 'bundle output path drifted' unless File.read(File.join(root, 'signing', 'bundle-id.txt')) == 'com.example.synthetic'
    raise 'production push not set' unless JSON.parse(File.read(File.join(root, 'ios', 'App', 'App.entitlements')))['aps-environment'] == 'production'
    absolute = File.join(root, 'artifacts')
    raise 'absolute path changed' unless repo_path(absolute) == absolute
    puts 'PASS Fastfile lanes from fastlane/: project, entitlements, signing/profile output, IPA/API key, AAB/service key resolve against repository root; absolute paths preserved'
  end
end
