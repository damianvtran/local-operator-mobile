#!/usr/bin/env python3
"""Hosted Xcode COMPILE-ONLY setup. No app target/dependencies, simulator boot,
install, launch, openURL, SpringBoard query, test execution, or package install.
The generated project contains only the independent XCTest UI runner sources.
Local CLT/source tests are not an SDK compilation receipt.
"""
import argparse
import hashlib
import json
import os
import plistlib
from pathlib import Path
import signal
import subprocess
import time

HERE = Path(__file__).resolve().parent

def project(output):
    output.mkdir(parents=True, exist_ok=False)
    target = 'A00000000000000000000001'
    files = ['ReplayGuards.swift', 'RetainedReplayTests.swift']
    refs = ['B00000000000000000000001', 'B00000000000000000000002']
    builds = ['C00000000000000000000001', 'C00000000000000000000002']
    source_refs = '\n'.join(f'{r} = {{isa=PBXFileReference; lastKnownFileType=sourcecode.swift; path={json.dumps(str(HERE / "retirement-ui" / f))}; sourceTree="<absolute>";}};' for r, f in zip(refs, files))
    build_refs = '\n'.join(f'{b} = {{isa=PBXBuildFile; fileRef={r};}};' for b, r in zip(builds, refs))
    pbx = '''// !$*UTF8*$!
{archiveVersion=1; classes={}; objectVersion=56; objects={
SOURCE_REFS
BUILD_REFS
D00000000000000000000001={isa=PBXGroup; children=(REFS,D00000000000000000000002); sourceTree="<group>";};
D00000000000000000000002={isa=PBXGroup; children=(D00000000000000000000003); name=Products; sourceTree="<group>";};
D00000000000000000000003={isa=PBXFileReference; explicitFileType=wrapper.cfbundle; path=RetirementSystemAlert.xctest; sourceTree=BUILT_PRODUCTS_DIR;};
E00000000000000000000001={isa=PBXSourcesBuildPhase; buildActionMask=2147483647; files=(BUILDS); runOnlyForDeploymentPostprocessing=0;};
E00000000000000000000002={isa=PBXFrameworksBuildPhase; buildActionMask=2147483647; files=(); runOnlyForDeploymentPostprocessing=0;};
A00000000000000000000001={isa=PBXNativeTarget; buildConfigurationList=F00000000000000000000001; buildPhases=(E00000000000000000000001,E00000000000000000000002); buildRules=(); dependencies=(); name=RetirementSystemAlert; productName=RetirementSystemAlert; productReference=D00000000000000000000003; productType="com.apple.product-type.bundle.ui-testing";};
F00000000000000000000001={isa=XCConfigurationList; buildConfigurations=(F00000000000000000000002); defaultConfigurationIsVisible=0; defaultConfigurationName=Debug;};
F00000000000000000000002={isa=XCBuildConfiguration; name=Debug; buildSettings={SDKROOT=iphonesimulator; SUPPORTED_PLATFORMS=iphonesimulator; SWIFT_VERSION=5.0; IPHONEOS_DEPLOYMENT_TARGET=17.0; CODE_SIGNING_ALLOWED=NO; GENERATE_INFOPLIST_FILE=YES; PRODUCT_BUNDLE_IDENTIFIER="com.localoperator.retirement.system-alert-tests"; PRODUCT_NAME="$(TARGET_NAME)"; TARGETED_DEVICE_FAMILY="1,2"; TEST_TARGET_NAME="";};};
F00000000000000000000003={isa=XCConfigurationList; buildConfigurations=(F00000000000000000000004); defaultConfigurationIsVisible=0; defaultConfigurationName=Debug;};
F00000000000000000000004={isa=XCBuildConfiguration; name=Debug; buildSettings={CLANG_ENABLE_MODULES=YES;};};
A00000000000000000000002={isa=PBXProject; attributes={LastUpgradeCheck=2600;}; buildConfigurationList=F00000000000000000000003; compatibilityVersion="Xcode 14.0"; developmentRegion=en; hasScannedForEncodings=0; knownRegions=(en,Base); mainGroup=D00000000000000000000001; productRefGroup=D00000000000000000000002; projectDirPath=""; projectRoot=""; targets=(A00000000000000000000001);};
}; rootObject=A00000000000000000000002;}
'''.replace('SOURCE_REFS', source_refs).replace('BUILD_REFS', build_refs).replace('REFS', ','.join(refs)).replace('BUILDS', ','.join(builds))
    (output / 'project.pbxproj').write_text(pbx)
    schemes = output / 'xcshareddata' / 'xcschemes'
    schemes.mkdir(parents=True)
    reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="RetirementSystemAlert.xctest" BlueprintName="RetirementSystemAlert" ReferencedContainer="container:{output.name}"/>'
    (schemes / 'RetirementSystemAlert.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2600" version="1.3"><BuildAction parallelizeBuildables="NO" buildImplicitDependencies="NO"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="NO">{reference}</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" shouldUseLaunchSchemeArgsEnv="NO"><Testables><TestableReference skipped="NO">{reference}</TestableReference></Testables></TestAction></Scheme>
''')

def setup(root):
    root.mkdir(parents=True, exist_ok=False)
    receipt = {'mode': 'setup-only', 'tapAttempted': False, 'testExecutionAttempted': False,
               'appBuildAttempted': False, 'compileOutcome': 'not-started',
               'runnerSourceSHA': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
               'sources': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((HERE / 'retirement-ui').glob('*.swift'))}}
    started = time.monotonic()
    try:
        receipt['xcodeVersion'] = subprocess.check_output(['xcodebuild', '-version'], text=True, timeout=15).strip()
        receipt['simulatorSDKVersion'] = subprocess.check_output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version'], text=True, timeout=15).strip()
        generated = root / 'RetirementSystemAlert.xcodeproj'
        project(generated)
        args = ['xcodebuild', 'build-for-testing', '-project', str(generated), '-scheme', 'RetirementSystemAlert', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', str(root / 'DerivedData'), '-resultBundlePath', str(root / 'setup.xcresult'), '-jobs', '1', 'CODE_SIGNING_ALLOWED=NO']
        # All targets are ours; no app target, package resolver, Pods or script phase.
        with (root / 'compile.log').open('wb') as log:
            child = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            trigger = None
            try:
                while child.poll() is None:
                    rss = 0
                    for line in subprocess.check_output(['ps', '-axo', 'pgid=,rss='], text=True).splitlines():
                        fields = line.split()
                        if len(fields) == 2 and int(fields[0]) == child.pid:
                            rss += int(fields[1]) * 1024
                    if rss > 2 * 1024**3: trigger = 'owned-process-group-rss-limit'
                    if time.monotonic() - started > 540: trigger = 'setup-deadline'
                    if log.tell() > 16 * 1024**2: trigger = 'compile-log-limit'
                    if trigger: break
                    time.sleep(1)
            finally:
                try: os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                rc = child.wait()
            receipt['compileExitCode'] = rc
            receipt['stopReason'] = trigger
            if trigger or rc != 0: raise RuntimeError('Compile setup failed')
        products = root / 'DerivedData' / 'Build' / 'Products'
        xctestruns = sorted(products.glob('*.xctestrun'))
        runners = sorted(products.glob('**/*-Runner.app'))
        if not xctestruns or not runners: raise RuntimeError('Required runner products missing')
        receipt['products'] = [str(p.relative_to(root)) for p in xctestruns + runners]
        receipt['xctestrunSHA256'] = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in xctestruns}
        receipt['runnerExecutableSHA256'] = {}
        for runner in runners:
            with (runner / 'Info.plist').open('rb') as info:
                executable = plistlib.load(info).get('CFBundleExecutable')
            if not isinstance(executable, str) or '/' in executable or executable in ('', '.', '..'):
                raise RuntimeError('Runner executable identity missing')
            binary = runner / executable
            if binary.is_symlink() or not binary.is_file(): raise RuntimeError('Unsupported runner binary')
            receipt['runnerExecutableSHA256'][str(binary.relative_to(root))] = hashlib.sha256(binary.read_bytes()).hexdigest()

        receipt['compileOutcome'] = 'passed'
    except Exception:
        receipt['compileOutcome'] = 'failed'
        raise
    finally:
        receipt['elapsedMs'] = round((time.monotonic() - started) * 1000)
        (root / 'setup-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['setup'], default='setup')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    setup(Path(args.output).resolve())
