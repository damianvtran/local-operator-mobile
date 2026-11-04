#!/usr/bin/env python3
"""Portable Products/xctestrun handoff. Stdlib only; no Xcode command/app build.
Never publish the private replay xctestrun containing ephemeral bearer material.
"""
import argparse
import hashlib
import datetime
import urllib.request
import json
import os
from pathlib import Path
import plistlib
import re
from urllib.parse import urlsplit
import tarfile


POLICY = json.loads(Path(__file__).with_name('retirement-replay-policy.json').read_text())
if set(POLICY) != {'sessionBytes', 'bearerBytes', 'failureCauses'} or any(type(POLICY[k]) is not int or not 16 <= POLICY[k] <= 64 for k in ('sessionBytes', 'bearerBytes')): raise ValueError('Replay policy invalid')

def preflight_retained(credential, fetcher=None, now=None):
    """Queue delay can expire the original app. Recheck on the compile host
    BEFORE SDK work; metadata only, never download/rebuild the proof app."""
    now = datetime.datetime.now(datetime.timezone.utc).timestamp() if now is None else now
    if not credential: raise ValueError('Artifact read credential missing')
    if fetcher is None:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs): return None
        def fetcher():
            request = urllib.request.Request('https://api.github.com/repos/damianvtran/local-operator-mobile/actions/artifacts/13225164386', headers={'Authorization': 'Bearer ' + credential, 'Accept': 'application/vnd.github+json'})
            try:
                with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
                    data = response.read(16385)
                    if len(data) > 16384: raise ValueError('Metadata bound')
                    return json.loads(data)
            except Exception:
                raise ValueError('Artifact metadata unavailable') from None
    value = fetcher()
    try: expiry = datetime.datetime.fromisoformat(value['expires_at'].replace('Z', '+00:00')).timestamp()
    except (KeyError, ValueError, TypeError): raise ValueError('Artifact expiry invalid') from None
    if value.get('id') != 13225164386 or value.get('expired') is not False or value.get('workflow_run', {}).get('id') != 41620694610 or value['workflow_run'].get('head_sha') != '78ff786a7ef173560b7fb67e29a9e20eb9ca6f8b' or expiry <= now + 17 * 60:
        raise ValueError('Original artifact unavailable or insufficient compile/replay window')
    return {'artifactID': 13225164386, 'expiresAt': expiry, 'minimumWindowSeconds': 1020}


def manifest(root):
    entries = []
    total = 0
    def walk(directory):
        nonlocal total
        for path in sorted(directory.iterdir()):
            stat = path.lstat()
            if stat.st_mode & 0o7000: raise ValueError('Special product mode')
            if len(entries) >= 20000: raise ValueError('Product member limit')
            if path.is_symlink():
                target = os.readlink(path)
                if os.path.isabs(target) or not path.resolve().is_relative_to(root.resolve()): raise ValueError('Product link escape')
            elif path.is_file():
                total += stat.st_size
                if total > 512 * 1024**2 or stat.st_nlink != 1: raise ValueError('Product size/link bound')
            item = {'path': str(path.relative_to(root)), 'mode': stat.st_mode & 0o777}
            if path.is_symlink(): item.update(type='link', target=os.readlink(path))
            elif path.is_dir(): item.update(type='directory')
            elif path.is_file(): item.update(type='file', size=stat.st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
            else: raise ValueError('Unsupported product entry')
            entries.append(item)
            if item['type'] == 'directory': walk(path)
    walk(root)
    return entries


def configuration(products):
    if products.is_symlink() or not products.is_dir(): raise ValueError('Products root changed')
    configs = list(products.glob('*.xctestrun'))
    if len(configs) != 1: raise ValueError('Expected exactly one test configuration')
    path = configs[0]
    if path.is_symlink() or not path.is_file(): raise ValueError('Configuration must be a regular file')
    with path.open('rb') as stream: value = plistlib.load(stream)
    if set(value) != {'RetirementSystemAlert', '__xctestrun_metadata__'}: raise ValueError('Unknown xctestrun root schema')
    target = value['RetirementSystemAlert']
    if not isinstance(target, dict): raise ValueError('Runner target schema')
    if target.get('UITargetAppPath', '') or target.get('UITargetAppBundleIdentifier', ''): raise ValueError('App target forbidden')
    if target.get('IsUITestBundle') is not True or target.get('TestHostBundleIdentifier') != 'com.localoperator.retirement.system-alert-tests.xctrunner': raise ValueError('Unknown XCTest host')
    if target.get('TestHostPath') != '__TESTROOT__/Debug-iphonesimulator/RetirementSystemAlert-Runner.app' or target.get('TestBundlePath') != '__TESTHOST__/PlugIns/RetirementSystemAlert.xctest': raise ValueError('Unexpected test product relocation')
    for field in ('EnvironmentVariables', 'TestingEnvironmentVariables'):
        if not isinstance(target.get(field), dict) or any(not isinstance(k, str) or not isinstance(v, str) or k.startswith('LO_REPLAY_') for k, v in target[field].items()): raise ValueError('Runner environment schema missing')
    for key, item in target.items():
        if ('retry' in key.lower() or 'repetition' in key.lower()) and item not in (False, 0, '', None): raise ValueError('Retry-enabled runner refused')
    for item in target.get('DependentProductPaths', []):
        if not isinstance(item, str) or not item.startswith('__TESTROOT__/') or '..' in item.split('/'): raise ValueError('Unknown product dependency')
        if not (products / item.removeprefix('__TESTROOT__/')).exists(): raise ValueError('Missing product dependency')
    runner = products / 'Debug-iphonesimulator/RetirementSystemAlert-Runner.app'
    if list(products.glob('**/*.app')) != [runner] or runner.is_symlink(): raise ValueError('Exactly one independent runner required')
    if sorted(runner.glob('PlugIns/*.xctest')) != [runner / 'PlugIns/RetirementSystemAlert.xctest']: raise ValueError('Exactly one test bundle required')
    if (runner / 'PlugIns/RetirementSystemAlert.xctest').is_symlink() or not (runner / 'PlugIns/RetirementSystemAlert.xctest').is_dir(): raise ValueError('Missing test bundle')
    if (runner / 'Info.plist').is_symlink() or not (runner / 'Info.plist').is_file(): raise ValueError('Runner plist must be regular')
    with (runner / 'Info.plist').open('rb') as stream: info = plistlib.load(stream)
    executable = info.get('CFBundleExecutable')
    if info.get('CFBundleIdentifier') != 'com.localoperator.retirement.system-alert-tests.xctrunner' or not isinstance(executable, str) or not re.fullmatch('[A-Za-z0-9_.-]+', executable) or executable in ('.', '..'): raise ValueError('Runner binary identity')
    binary = runner / executable
    if binary.is_symlink() or not binary.is_file() or not binary.stat().st_mode & 0o111: raise ValueError('Runner binary mode')
    return path, value, runner


def package(root):
    products = root / 'DerivedData/Build/Products'
    path, value, runner = configuration(products)
    # Runner ONLY; the retained proof app is not present in this compile job.
    info_path = runner / 'Info.plist'
    with info_path.open('rb') as stream: info = plistlib.load(stream)
    # WHY THE TEMPLATE VALUE IS RECOGNISED. The UI-test host is Xcode's built-in
    # XCTRunner template, copied from the platform rather than generated from our
    # project: GENERATE_INFOPLIST_FILE only shapes the .xctest bundle, and no build
    # setting reaches the runner's ATS. On Xcode 26.6 / Simulator SDK 26.5 that
    # template ships {'NSAllowsArbitraryLoads': True} (read from the runner in artifact 13229037660, built by
    # run 41632496560). That exact value is accepted ONLY as input to the rewrite
    # below; it is never packaged. Any other shape (an extra key, exception
    # domains, a non-bool, web-content loads) is still refused, because it means
    # the template or our project changed and the policy must be looked at again.
    xcode_runner_template = {'NSAllowsArbitraryLoads': True}
    current = info.get('NSAppTransportSecurity', {})
    # `type(...) is bool` because `True == 1` would let an integer through.
    template = current == xcode_runner_template and type(current.get('NSAllowsArbitraryLoads')) is bool
    local = current == {'NSAllowsLocalNetworking': True} and type(current.get('NSAllowsLocalNetworking')) is bool
    if not (current == {} or local or template): raise ValueError('Unexpected runner ATS policy')
    info['NSAppTransportSecurity'] = {'NSAllowsLocalNetworking': True}
    with info_path.open('wb') as stream: plistlib.dump(info, stream)
    with info_path.open('rb') as stream:
        if plistlib.load(stream)['NSAppTransportSecurity'] != {'NSAllowsLocalNetworking': True}: raise ValueError('Runner ATS readback failed')
    receipt = json.loads((root / 'setup-receipt.json').read_text())
    if not re.fullmatch('[a-f0-9]{40}', receipt['runnerSourceSHA']): raise ValueError('Runner source identity')
    document = {'version': 1, 'source': receipt['runnerSourceSHA'], 'products': manifest(products), 'xctestrunSHA256': hashlib.sha256(path.read_bytes()).hexdigest(), 'localNetworkingOnly': True}
    manifest_path = root / 'runner-manifest.json'
    manifest_path.write_text(json.dumps(document, sort_keys=True) + '\n')
    archive = root / 'runner-products.tar.gz'
    with tarfile.open(archive, 'w:gz', dereference=False, format=tarfile.PAX_FORMAT) as tar:
        def safe_header(entry):
            entry.uid = entry.gid = 0
            entry.uname = entry.gname = ''
            entry.pax_headers = {k: v for k, v in entry.pax_headers.items() if k in ('path', 'linkpath')}
            entry.mtime = 0
            return entry
        tar.add(products, arcname='Products', filter=safe_header)
        tar.add(manifest_path, arcname='runner-manifest.json', filter=safe_header)
    if archive.stat().st_size > 512 * 1024**2: raise ValueError('Runner archive size limit')
    receipt['runnerTarSHA256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
    receipt['runnerManifestSHA256'] = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    # A package must be readable and contain the exact verified tree BEFORE setup
    # can call the compile successful; this is not a simulator/native validation.
    with tarfile.open(archive, 'r:gz') as check:
        members = check.getmembers()
        if len(members) != len(document['products']) + 2 or any(m.islnk() or m.isdev() or m.isfifo() or m.mode & 0o7000 for m in members): raise ValueError('Packaged tree differs')
    receipt['localNetworkingOnly'] = True
    receipt['packageValidated'] = True
    # Refresh hashes after the explicit runner-only ATS policy was materialized.
    receipt['xctestrunSHA256'] = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()}
    receipt['runnerExecutableSHA256'] = {str((runner / info['CFBundleExecutable']).relative_to(root)): hashlib.sha256((runner / info['CFBundleExecutable']).read_bytes()).hexdigest()}
    (root / 'setup-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


def prepare(root, environment, output):
    saved = json.loads((root / 'runner-manifest.json').read_text())
    products = root / 'Products'
    if saved.get('version') != 1 or not re.fullmatch('[a-f0-9]{40}', saved.get('source', '')) or saved.get('localNetworkingOnly') is not True: raise ValueError('Runner manifest schema')
    if manifest(products) != saved['products']: raise ValueError('Runner product hash/mode mismatch')
    path, value, runner = configuration(products)
    if hashlib.sha256(path.read_bytes()).hexdigest() != saved['xctestrunSHA256']: raise ValueError('Runner configuration changed')
    with (runner / 'Info.plist').open('rb') as stream:
        if plistlib.load(stream).get('NSAppTransportSecurity') != {'NSAllowsLocalNetworking': True}: raise ValueError('Missing exact local networking policy')
    private = json.loads(environment.read_text())
    allowed = {'LO_REPLAY_MODE', 'LO_REPLAY_CONTROL', 'LO_REPLAY_SESSION', 'LO_REPLAY_BEARER', 'LO_REPLAY_RUNNER_SOURCE'}
    if set(private) != allowed or any(not isinstance(v, str) for v in private.values()): raise ValueError('Private environment schema')
    parsed = urlsplit(private['LO_REPLAY_CONTROL'])
    if private['LO_REPLAY_MODE'] not in ('observe-only', 'seed-replay') or private['LO_REPLAY_RUNNER_SOURCE'] != saved['source']: raise ValueError('Runner mode/source')
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or not parsed.port or parsed.path != '/rpc' or parsed.query or parsed.fragment or parsed.username or parsed.password: raise ValueError('Control must be loopback only')
    if not re.fullmatch('[a-f0-9]{%d}' % (POLICY['sessionBytes'] * 2), private['LO_REPLAY_SESSION']) or not re.fullmatch('[a-f0-9]{%d}' % (POLICY['bearerBytes'] * 2), private['LO_REPLAY_BEARER']): raise ValueError('Session identity')
    for field in ('EnvironmentVariables', 'TestingEnvironmentVariables'):
        target = value['RetirementSystemAlert'][field]
        for key, item in private.items():
            if key in target: raise ValueError('Conflicting runner environment')
            target[key] = item
    # __TESTROOT__ must remain the verified Products root. No absolute macro rewrite.
    if output.parent != products: raise ValueError('Private configuration root changed')
    with output.open('xb') as stream: plistlib.dump(value, stream)
    output.chmod(0o600)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['package', 'prepare'])
    parser.add_argument('root', type=Path)
    parser.add_argument('--environment', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.mode == 'package': package(args.root)
    elif not args.environment or not args.output: parser.error('Private environment/output required')
    else: prepare(args.root, args.environment, args.output)
