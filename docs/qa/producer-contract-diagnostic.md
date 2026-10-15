# Producer contract diagnostic: prebuild ONLY

**Implementation source prepared; all tests and execution NOT RUN.** This opt-in
is not a native producer, source-identity sidecar, attested artifact, compiled
entry/graph/map proof, signing gate, locale audit or native/render approval.

## Routing and future admission

Existing registered `.github/workflows/ios.yml` gains manual choice
`producer_mode: native | contract-only`, default **native**. Push/PR and normal
manual native behavior remain unchanged. A manual non-native value routes ONLY
to the diagnostic job; its first Python guard accepts exactly contract-only and
rejects missing/invalid/unknown values before dependency setup. The workflow
canonicalizes unknown input to the literal invalid before placing it in an
environment value, because Actions may display env values in its logs. Changes/native
jobs are skipped for those manual values. Signed jobs retain their existing
push-to-main-only guards. Diagnostic concurrency has a separate suffix so it
cannot cancel an ordinary native run on that ref.

The diagnostic is one standard hosted macos-26 job, timeout10minutes,
contents:read, no new credentials, permissions, OIDC, environments or self-hosted
access. No new workflow path or admin registration is introduced. Actual dispatch
access/input availability is NOT probed. ROOT/Aida must approve any later remote
execution; this source allocation activates, dispatches and spends nothing.

## Actual future command path

Workflow checkout (full history, persist-credentials:false) then:

1. `python3 scripts/ci/producer-contract-diagnostic.py guard --output "$RUNNER_TEMP/producer-contract-diagnostic"`
2. Existing pinned pnpm action, run_install:false; Node setup24. No Java/Xcode/
   simulator/SDK installation action is added.
3. `python3 scripts/ci/producer-contract-diagnostic.py collect --output "$RUNNER_TEMP/producer-contract-diagnostic"`
4. Always-run `failure` action with the same output argument verifies fixed-schema
   public files/hashes, or creates a bounded typed STOP; it emits safe=true only
   after verification. Upload is additionally conditional on that output.

Collector subprocesses (argv arrays, no shell):
- node --version (must be24), pnpm --version (must be12.6.0),
  git diff --name-only baseline -- and git rev-parse HEAD. No Java/JDK command.
- pnpm install --frozen-lockfile in the future job's OWN ephemeral checkout.
- node scripts/ci/producer-contract-sdk.cjs <actual-checkout-root>.
- pnpm exec expo prebuild --platform ios --no-install.
- Recheck the measured installed SDK hashes after generation, then node
  <actual-resolved-expo-dir>/scripts/resolveAppEntry.js <root> ios absolute.
- plutil -convert json -o - <the-single-generated-ios-project.pbxproj>.

No pod install, xcodebuild, simctl, app installation, native bundling/compiler,
Metro server/export, compiler/map collection, signing, TestFlight or store action.
No generated bundle phase or resolved application entry is executed. The one
SDK resolver script invocation computes a path; it is NOT compiled entry proof.

Missing Node/pnpm/plutil stops before dependency install/prebuild. There is no
provisioning fallback. Java17 is not an evidenced prerequisite for this iOS-only
source-generation operation; the collector no longer probes or gates on Java.
Real nonzero prebuild exits STILL STOP. A JAVA_HOME marker in that failed
prebuild's stderr emits PREBUILD_JAVA_HOME_ERROR, distinct from a missing-tool or
resolver failure. This names the observed command/marker, NOT a Java version,
missing JDK or causal diagnosis. SDK/xcrun markers and other errors retain their
existing fail-closed codes. No actual prebuild error is suppressed or provisioned.

### Why the old Java gate is removed — source argument, not a runtime diagnosis

Exact pinned upstream source:
- [CLI57.0.27 prebuild index](https://cdn.jsdelivr.net/npm/@expo/cli@57.0.27/build/src/prebuild/index.js)
  passes install:!args['--no-install'] and resolvePlatformOption(args['--platform']).
- [CLI57.0.27 resolveOptions](https://cdn.jsdelivr.net/npm/@expo/cli@57.0.27/build/src/prebuild/resolveOptions.js)
  maps ios to ['ios']; it does not select Android for that explicit argument.
- [CLI57.0.27 prebuildAsync](https://cdn.jsdelivr.net/npm/@expo/cli@57.0.27/build/src/prebuild/prebuildAsync.js)
  generates/configures source; node installation and CocoaPods installation are
  gated on options.install. No Java invocation appears in that orchestration.
- [CLI57.0.27 configureProjectAsync](https://cdn.jsdelivr.net/npm/@expo/cli@57.0.27/build/src/prebuild/configureProjectAsync.js)
  passes the selected platforms into compileModsAsync.
- [config-plugins57.0.9 mod compiler](https://cdn.jsdelivr.net/npm/@expo/config-plugins@57.0.9/build/plugins/mod-compiler.js)
  skips excluded platforms BEFORE evaluating their registered mods.

Repository app.config.ts registers two local Android plugins; they register
withAppBuildGradle/withAndroidManifest text modifications, with no Java/child
process invocation at registration. They are not Android compilation commands.
[Official Expo CNG documentation](https://docs.expo.dev/workflow/continuous-native-generation/)
separates generating native directories using prebuild from building with run:ios
or run:android. A full native workflow's Java setup is not evidence that this
prebuild-only diagnostic needs exactly JDK17. All statements here are scoped
source evidence, not an exhaustive proof about every transitive plugin or a real
SDK-without-Java PASS. A future genuine Java-related prebuild failure remains a
STOP requiring evidence and a new disposition, not installation fallback.

### Historical STOP ambiguity is immutable

Original producer P be9b6603181969e74ecbeff18cd5436308721eba produced run38787931606's
legacy JDK17_REQUIRED/null-result STOP. That original code could arise from early
which/version/failed Java command OR a later JAVA_HOME prebuild marker. Its null
fields and short step duration do NOT identify which happened or which commands
completed. Original P/E/artifact bytes and the historical16-unit PASS remain
unchanged. JDK17_REQUIRED stays accepted in the closed vocabulary for historical
bodies only; new source has no emitter for it. Do not upgrade old E to the new
PREBUILD_JAVA_HOME_ERROR stage or claim Java21, missing Java, or no install/prebuild.
Current working-delta tests and SDK/prebuild behavior are NOT RUN/UNVERIFIED.

## What is actually measured by the future diagnostic

Source allowlist permits only these diagnostic workflow/helper/test/docs paths to
differ from b5a20fec2db9416fbdaf385b20338cb950effe32. No stale eight-key descendant
input is intentionally accepted: this implementation checkout starts from the
original six-key baseline, with no canonical i18n generation requirement. Git
source identity does not prove LFS assets are materialized; no LFS fetch/restore
fallback or usable-asset/native claim is added by this diagnostic.

The JS metadata helper uses Node's package resolution WITHOUT requiring/evaluating
SDK/application modules. Where package.json is unexported, it inspects at most six
ancestors of that package's resolved entry, not a dependency-tree scan. It checks
actual exact versions and hashes package.json bytes for expo57.0.26,
@expo/cli57.0.27, @expo/metro-config57.0.12, @expo/config-plugins57.0.9,
react-native0.86.3, @react-native/community-cli-plugin0.86.3,
hermes-compiler250829098.0.17, RN-resolved metro-source-map0.84.5 and
@expo/metro56.0.2. Different/unresolvable metadata is a prerequisite failure,
never silently substituted with another Metro version or donor tree.

Exact installed script paths are derived from those package locations: Expo
resolveAppEntry, RN react-native-xcode.sh/compose-source-maps.js, CLI
build/src/export/embed/exportEmbedAsync.js and Metro-config
build/serializer/{withExpoSerializers,sourceMap}.js. They are hashed, not executed.
Python rechecks the returned source-file identities. Entry realpath must remain
inside the checkout (its own node_modules is allowed), with bounded actual bytes
and hash. External/symlink escapes, sensitive suffixes and .env files are refused.

Prebuild creates the ACTUAL pbx project. Exactly one generated project and one
Bundle React Native code and images/react-native-xcode/export:embed phase must be
found. plutil conversion stays in bounded memory. Published phase facts are only
hash/byte size and fixed observations: assignment counts and empty-variable guard
patterns for ENTRY_FILE, CLI_PATH, BUNDLE_COMMAND, SOURCEMAP_FILE, plus an external
sourcing pattern. **Precedence is deliberately UNKNOWN** (UNEXECUTED_SHELL_PRECEDENCE):
this is not a shell interpreter. Unknown/private assignments and their values,
full script/PBX text and arbitrary excerpts are NEVER published. This concrete
output supplies the missing generated-phase identity without inventing a proven
CLI override hook. Even a plausible SDK-resolved entry remains SDK_RESOLVED_ONLY.

## Budget, privacy and custody

Collector deadline360s, each subprocess at most180s, dependency install180s,
prebuild120s; other commands20s. Exact owned process groups are terminated,
killed and verified retired, including failure/timeout paths. The outer10minute
job includes checkout/setup time; slow setup can still exhaust that platform
ceiling. No current hosted time, physical CPU/RAM/disk or price is measured.
This10minute diagnostic budget is NOT approval for a60minute native producer.

Command count<=24; aggregate captured stdout+stderr<=8MiB; per-command64KiB by
default, pnpm install4MiB, prebuild2MiB, plutil2MiB. Both pipes are nonblocking,
collected under absolute deadlines BEFORE buffering past caps. Child environment
uses a small HOME/PATH/TMPDIR/locale/Java allowlist plus CI and Expo no-telemetry;
no inherited tokens, Node preload variables or CMUX variables are passed.

Raw SDK/prebuild text is fully withheld, not regex-redacted or copied into logs:
bounded memory collection is used only for the necessary parser/result checks;
staging retains a fixed withheld marker plus stream byte/digest metadata, not raw
stdout/stderr. Thus even split private strings cannot escape via staged logs.
No .env, credential file, full environment, source body, generated PBX dump or
build log is copied to an artifact. SDK source/public paths and file hashes are
allowed, arbitrary exception messages/URLs/private extra fields are rejected.

SDK inspected files<=256KiB each/package metadata64KiB/aggregate1MiB, generated PBX
<=2MiB, phase text<=32KiB, entry<=256KiB. Public JSON<=48KiB plus digest record,
artifact<64KiB by construction. Only public/{diagnostic.json OR STOP.json,
sha256.json} is uploadable, after schema/bytes/hash verification. Partial or linked/
tampered publication is withheld and replaced with typed setup STOP before safe
upload admission. Neither raw/ nor approved/ nor withheld/ is uploadable.

Artifact name/kind **producer-contract-diagnostic-only**, nativeCompiled:false.
NEVER ios-simulator/source-identity.json, never old consumer retargeting. Old
artifact ROOT absence, failed-v2/new-v3 receipts, original18 checkpoint, old plan,
quarantine and primary PR92 remain outside this checkout/allocation.

## Prepared fixture SOURCE, not execution evidence

`scripts/ci/test_producer_contract_diagnostic.py` proposes stdlib unittest coverage:
manual/default/invalid guard paths and existing native/signed workflow source;
private/unknown phase content; zero/multiple phase/project counts; actual entry
file hash, external/symlink escapes; SDK version mismatch/public schema/size;
publication tamper/symlink/byte budget; missing Node/pnpm/plutil before installs;
synthetic successful iOS collection with neither Java nor javac available/queried/
invoked; stage-specific prebuild JAVA_HOME marker versus resolver/generic command
failure; historical legacy-body ambiguity and rejected fabricated stage fields;
known/unknown prebuild failure; bounded noisy/partial-output children; sanitized
resolver failure. The no-Java positive uses a Fake prebuild, not the real SDK. Future explicit cheap test command:

`python3 -m unittest discover -s scripts/ci -p test_producer_contract_diagnostic.py`

**NOT RUN:** no Python module import/parser/test, Node invocation, dependency
install, prebuild, SDK/native/browser/server action or CI dispatch locally. Static
source/hash/ordinary Git metadata checks are not passing tests or prebuild proof.
Independent SOURCE review is next; future actual execution/negative controls need
separate admission. Generated phase/serializer/entry-ID/map/compiler/binary/runtime
and rendered locale gates remain open; C and release holds are unchanged.

Before a later PR, retain full actual independent reports and execution logs,
models/dates/source-context-target identities and original-versus-replacement
custody in TRACKED i18n/audits/evidence/. Do not invent an execution log for this
source-only checkpoint or convert its status into translation eligibility.
