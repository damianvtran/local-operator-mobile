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
  def self.message(*) end
end
module Spaceship
  module ConnectAPI
    class App
      def self.find(bundle)
        raise 'wrong iOS bundle' unless bundle == 'com.localoperator.mobile'
        raise 'baseline lookup needs the uploader key' if $baseline && !$spaceship_authenticated
        $called << :lookup_app
        ($baseline || $recovery)[:app]
      end
    end
    def self.get_builds(filter:, includes:)
      if $baseline
        raise 'wrong baseline query' unless filter == {
          app: 'synthetic-app', 'preReleaseVersion.version' => '0.2.0', 'preReleaseVersion.platform' => 'IOS',
          version: '1600', processingState: 'VALID'
        } && includes == 'app,preReleaseVersion'
        $called << :lookup_build
        raise 'synthetic authorization error (must not be echoed)' if $baseline[:build] == :denied
        return $baseline[:build]
      end
      version, build = $recovery_target || %w[0.1.0 1517]
      raise 'wrong recovery build query' unless filter == { app: 'synthetic-app', 'preReleaseVersion.version' => version, version: build } && includes.nil?
      $called << :lookup_build
      raise 'synthetic authorization error' if $recovery[:build] == :denied
      $recovery[:build]
    end
    def self.get_build_uploads(app_id:, filter:)
      version, build = $recovery_target || %w[0.1.0 1517]
      raise 'wrong recovery upload query' unless app_id == 'synthetic-app' && filter == { cfBundleShortVersionString: version, cfBundleVersion: build }
      $called << :lookup_upload
      $recovery[:upload]
    end
  end
end
module Xcodeproj
  module Project
    def self.open(path)
      raise 'project must resolve from repository root' unless path == File.join($fixture, 'ios', 'SyntheticApp.xcodeproj')
      configuration = Struct.new(:name, :build_settings).new('Release', {
        'PRODUCT_BUNDLE_IDENTIFIER' => 'com.example.synthetic',
        'CODE_SIGN_ENTITLEMENTS' => $entitlement_setting
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
  $spaceship_authenticated = options[:set_spaceship_token]
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
  raise 'upload must use the same API key' unless options[:api_key] == { synthetic: true }
  raise 'upload is not internal-only and non-waiting' unless options.values_at(:distribute_external, :notify_external_testers, :skip_waiting_for_build_processing) == [false, false, true]
  $called << :testflight
end
def supply(**options)
  raise 'AAB path must resolve from root' unless options[:aab] == File.join($fixture, 'artifacts', 'synthetic.aab')
  raise 'service key path must resolve from root' unless options[:json_key] == File.join($fixture, 'signing', 'synthetic.json')
  $called << :play
end

def evaluate_fastfile(path)
  # Separate method scope matches the parser's DSL evaluation and isolates
  # fixture locals from locals introduced by the Fastfile's lane blocks.
  receiver = Object.new
  receiver.instance_eval(File.read(path), path)
  receiver
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
    fastfile = File.join(root, 'fastlane', 'Fastfile')
    # Fastlane evaluates the file in its DSL binding, not through Ruby load.
    dsl = evaluate_fastfile(fastfile)
    ENV['LO_IOS_SIGNING_DIR'] = 'signing'
    ENV['LO_IOS_PROFILE_NAME'] = 'Synthetic profile'
    ENV['APPLE_TEAM_ID'] = 'SYNTHETIC1'
    ENV['APPLE_ASC_KEY_ID'] = 'SYNTHETIC2'
    ENV['APPLE_ASC_ISSUER_ID'] = 'SYNTHETIC3'
    ENV['LO_IOS_IPA_DIR'] = 'artifacts'
    ENV['APPLE_ASC_PRIVATE_KEY_PATH'] = 'signing/asc-api-key.p8'
    ENV['LO_ANDROID_AAB'] = 'artifacts/synthetic.aab'
    ENV['SUPPLY_JSON_KEY'] = 'signing/synthetic.json'
    ['$(SRCROOT)/App/App.entitlements', '$(PROJECT_DIR)/App/App.entitlements', 'App/App.entitlements'].each do |setting|
      $entitlement_setting = setting
      $lanes[[:ios, :prepare_distribution]].call
    end
    $lanes[[:ios, :testflight]].call
    $lanes[[:android, :internal]].call
    raise 'missing lane execution' unless $called == ([:key, :profile, :settings] * 3 + [:key, :testflight, :play])
    raise 'bundle output path drifted' unless File.read(File.join(root, 'signing', 'bundle-id.txt')) == 'com.example.synthetic'
    raise 'production push not set' unless JSON.parse(File.read(File.join(root, 'ios', 'App', 'App.entitlements')))['aps-environment'] == 'production'
    absolute = File.join(root, 'artifacts')
    raise 'absolute path changed' unless dsl.repo_path(absolute) == absolute
    puts 'PASS Fastfile lanes from fastlane/: project, entitlements, signing/profile output, IPA/API key, AAB/service key resolve against repository root; absolute paths preserved'

    # Empty collections must be affirmatively identified before the same lane
    # can call Pilot. Adapters check exact query arguments and record ordering.
    response = Struct.new(:status, :body)
    empty = response.new(200, { 'data' => [], 'links' => {} })
    present = response.new(200, { 'data' => [{}], 'links' => {} })
    unknown = response.new(200, { 'links' => {} })
    partial = response.new(200, { 'data' => [], 'links' => { 'next' => 'synthetic' } })
    app = Struct.new(:id).new('synthetic-app')
    testflight = $lanes[[:ios, :testflight]]
    null_next = response.new(200, { 'data' => [], 'links' => { 'next' => nil } })
    { 'missing' => empty, 'null' => null_next }.each do |label, result|
      $recovery = { app: app, build: result, upload: result }
      $called.clear
      testflight.call(recovery_v010: true)
      raise 'recovery did not check both collections before Pilot' unless $called == [:key, :lookup_app, :lookup_build, :lookup_upload, :testflight]
      puts "PASS recovery: both exact read queries empty with links.next #{label}, then internal Pilot call"
    end

    [
      [:app, nil, 'Cannot confirm Local Operator'],
      [:build, present, 'already has a build for'],
      [:upload, present, 'already has a build upload for'],
      [:build, unknown, 'Cannot confirm App Store Connect build absence'],
      [:upload, partial, 'Cannot confirm App Store Connect build upload absence'],
      [:build, :denied, 'synthetic authorization error']
    ].each do |field, value, expected|
      $called.clear
      $recovery = { app: app, build: empty, upload: empty }.merge(field => value)
      begin
        testflight.call(recovery_v010: true)
        raise 'recovery did not stop before Pilot'
      rescue RuntimeError => error
        raise unless error.message.include?(expected) && !$called.include?(:testflight)
      end
      puts "PASS recovery blocked before Pilot: #{expected}"
    end

    # A plausible final-page envelope is not evidence of absence when `next`
    # has a non-null value (in particular, JSON false is also falsy in Ruby).
    { build: 'build', upload: 'build upload' }.each do |field, collection|
      [false, true, '', {}].each do |next_value|
        path = field == :build ? 'builds' : 'apps/synthetic-app/buildUploads'
        links = { 'self' => "https://api.appstoreconnect.apple.com/v1/#{path}", 'next' => next_value }
        malformed = response.new(200, { 'data' => [], 'links' => links })
        $recovery = { app: app, build: empty, upload: empty }.merge(field => malformed)
        $called.clear
        cutoff = [:key, :lookup_app, :lookup_build]
        cutoff << :lookup_upload if field == :upload
        label = "#{collection} links.next: #{JSON.generate(next_value)}"
        begin
          testflight.call(recovery_v010: true)
          raise "#{label} did not stop before Pilot: #{$called.inspect}"
        rescue RuntimeError => error
          raise unless error.message == "Cannot confirm App Store Connect #{collection} absence; refusing recovery" && $called == cutoff
        end
        puts "PASS recovery blocked before Pilot: #{label}"
      end
    end

    # The recovery check is generalised from v0.1.0 to any release named by
    # `recovery_version`/`recovery_build` (v0.1.1 / 1700 is the first user). The
    # adapters above now assert the EXACT version and build in both queries, so a
    # lane that kept looking for 0.1.0 (1517) would raise 'wrong recovery ... query'.
    $recovery_target = %w[0.1.1 1700]
    $recovery = { app: app, build: empty, upload: empty }
    $called.clear
    testflight.call(recovery_version: '0.1.1', recovery_build: '1700')
    raise 'v0.1.1 recovery did not check both collections before Pilot' unless $called == [:key, :lookup_app, :lookup_build, :lookup_upload, :testflight]
    puts 'PASS recovery v0.1.1 (1700): both exact read queries carry the named release, then internal Pilot call'
    # An integer build (how a caller might pass it) is accepted and queried as a string.
    $called.clear
    testflight.call(recovery_version: '0.1.1', recovery_build: 1700)
    raise 'integer recovery_build was not accepted' unless $called.last == :testflight

    { build: 'already has a build for 0.1.1 (1700)', upload: 'already has a build upload for 0.1.1 (1700)' }.each do |field, expected|
      $recovery = { app: app, build: empty, upload: empty }.merge(field => present)
      $called.clear
      begin
        testflight.call(recovery_version: '0.1.1', recovery_build: '1700')
        raise 'v0.1.1 recovery uploaded over an existing record'
      rescue RuntimeError => error
        raise unless error.message.include?(expected) && !$called.include?(:testflight)
      end
      puts "PASS recovery v0.1.1 blocked before Pilot: #{expected}"
    end

    # Malformed or ambiguous targets stop BEFORE any App Store Connect call.
    $recovery = { app: app, build: empty, upload: empty }
    [
      [{ recovery_version: '0.1.1' }, 'must be given together'],
      [{ recovery_build: '1700' }, 'must be given together'],
      [{ recovery_version: '0.1', recovery_build: '1700' }, 'must look like 1.2.3'],
      [{ recovery_version: '0.1.1', recovery_build: '0' }, 'positive integer'],
      [{ recovery_version: '0.1.1', recovery_build: '17x' }, 'positive integer'],
      [{ recovery_v010: true, recovery_version: '0.1.1', recovery_build: '1700' }, 'cannot be combined']
    ].each do |options, expected|
      $called.clear
      begin
        testflight.call(options)
        raise "bad recovery target #{options.inspect} was accepted"
      rescue RuntimeError => error
        raise unless error.message.include?(expected) && !$called.include?(:lookup_app) && !$called.include?(:testflight)
      end
      puts "PASS recovery target refused before any lookup: #{options.inspect}"
    end
    $recovery_target = nil
    # The legacy switch still means 0.1.0 (1517) with nothing else supplied.
    $recovery = { app: app, build: empty, upload: empty }
    $called.clear
    testflight.call(recovery_v010: true)
    raise 'legacy recovery_v010 changed meaning' unless $called.last == :testflight

    # A new Git tag is already reachable in this scenario (the CLI supplies
    # 0.2.0/1600), but the next main IPA must not claim its train before ASC
    # confirms that build. Only the ASC and Pilot boundaries are synthetic.
    ENV['LOCAL_OPERATOR_MOBILE_VERSION'] = '0.2.0'
    ENV['LO_IOS_TAGGED_BUILD_NUMBER'] = '1600'
    build = {
      'type' => 'builds', 'id' => 'synthetic-build',
      'attributes' => { 'version' => '1600', 'processingState' => 'VALID' },
      'relationships' => {
        'app' => { 'data' => { 'type' => 'apps', 'id' => 'synthetic-app' } },
        'preReleaseVersion' => { 'data' => { 'type' => 'preReleaseVersions', 'id' => 'synthetic-train' } }
      }
    }
    train = {
      'type' => 'preReleaseVersions', 'id' => 'synthetic-train',
      'attributes' => { 'version' => '0.2.0', 'platform' => 'IOS' }
    }
    valid = { 'data' => [build], 'included' => [train] }
    with_build = ->(new_build) { response.new(200, valid.merge('data' => [new_build])) }
    with_train = ->(new_train) { response.new(200, valid.merge('included' => [new_train])) }
    {
      'not visible' => empty,
      'pending' => with_build.call(build.merge('attributes' => build['attributes'].merge('processingState' => 'PROCESSING'))),
      'failed' => with_build.call(build.merge('attributes' => build['attributes'].merge('processingState' => 'FAILED'))),
      'wrong build' => with_build.call(build.merge('attributes' => build['attributes'].merge('version' => '1601'))),
      'wrong app' => with_build.call(build.merge('relationships' => build['relationships'].merge('app' => { 'data' => { 'type' => 'apps', 'id' => 'other-app' } }))),
      'wrong train' => with_train.call(train.merge('attributes' => train['attributes'].merge('version' => '0.1.0'))),
      'wrong platform' => with_train.call(train.merge('attributes' => train['attributes'].merge('platform' => 'MAC_OS'))),
      'unrelated included train' => with_train.call(train.merge('id' => 'other-train')),
      'malformed build' => with_build.call(build.merge('relationships' => 'not an object')),
      'extra null build' => response.new(200, valid.merge('data' => [build, nil])),
      'authorization failure' => :denied,
      'non-success status' => response.new(403, valid)
    }.each do |label, result|
      $baseline = { app: app, build: result }
      $called.clear
      begin
        testflight.call(require_tagged_baseline: true)
        raise "signed main uploaded without an accepted tagged baseline: #{label} (#{$called.inspect})"
      rescue RuntimeError => error
        raise unless error.message.include?('refusing signed-main upload') && error.cause.nil? &&
                     $called == [:key, :lookup_app, :lookup_build]
      end
      puts "PASS signed main blocked before Pilot: #{label}"
    end

    $baseline = { app: app, build: response.new(200, valid) }
    $called.clear
    testflight.call(require_tagged_baseline: true)
    raise 'tagged baseline was not checked before Pilot' unless $called == [:key, :lookup_app, :lookup_build, :testflight]
    puts 'PASS signed main: valid exact iOS build, then internal Pilot call'

    ENV.delete('LO_IOS_TAGGED_BUILD_NUMBER')
    $called.clear
    begin
      testflight.call(require_tagged_baseline: true)
      raise 'signed main uploaded without the derived tagged build number'
    rescue RuntimeError => error
      raise unless error.message.include?('refusing signed-main upload') && !$called.include?(:testflight)
    end
    puts 'PASS signed main blocked before Pilot: missing derived tagged build number'
  end
end
