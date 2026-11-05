"""Real stdlib product/package fixtures; NO Xcode/SDK/network command runs."""
import datetime
import copy
import hashlib
import json
import os
from pathlib import Path
import plistlib
import runpy
import shutil
import tempfile
import types
import unittest
from unittest import mock

HERE = Path(__file__).parent
API = runpy.run_path(str(HERE / 'retirement-replay-products.py'))
SOURCE = 'c' * 40


def products(root):
    tree = root / 'DerivedData/Build/Products'
    runner = tree / 'Debug-iphonesimulator/RetirementSystemAlert-Runner.app'
    tests = runner / 'PlugIns/RetirementSystemAlert.xctest'
    tests.mkdir(parents=True)
    (runner / 'Runner').write_bytes(b'fixture-only executable')
    (runner / 'Runner').chmod(0o755)
    (tests / 'Tests').write_bytes(b'fixture-only XCTest')
    (tests / 'Tests').chmod(0o755)
    (runner / 'Alias').symlink_to('Runner')
    with (runner / 'Info.plist').open('wb') as stream:
        plistlib.dump({'CFBundleExecutable': 'Runner', 'CFBundleIdentifier': 'com.localoperator.retirement.system-alert-tests.xctrunner'}, stream)
    configuration = {'RetirementSystemAlert': {
        'IsUITestBundle': True,
        'TestHostBundleIdentifier': 'com.localoperator.retirement.system-alert-tests.xctrunner',
        'TestHostPath': '__TESTROOT__/Debug-iphonesimulator/RetirementSystemAlert-Runner.app',
        'TestBundlePath': '__TESTHOST__/PlugIns/RetirementSystemAlert.xctest',
        'EnvironmentVariables': {}, 'TestingEnvironmentVariables': {},
        'DependentProductPaths': ['__TESTROOT__/Debug-iphonesimulator/RetirementSystemAlert-Runner.app'],
    }, '__xctestrun_metadata__': {'FormatVersion': 1}}
    with (tree / 'Fixture.xctestrun').open('wb') as stream:
        plistlib.dump(configuration, stream)
    return tree, runner


class ProductFixtures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='replay-products-', dir=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP'))
        self.root = Path(self.temp.name)
        self.tree, self.runner = products(self.root)
        (self.root / 'setup-receipt.json').write_text(json.dumps({'runnerSourceSHA': SOURCE, 'compileOutcome': 'not-started'}))

    def tearDown(self):
        self.temp.cleanup()

    def package(self):
        API['package'](self.root)
        destination = self.root / 'replay'
        destination.mkdir()
        # This is OUR just-validated synthetic archive, not an untrusted download.
        with API['tarfile'].open(self.root / 'runner-products.tar.gz') as archive:
            archive.extractall(destination)
        environment = self.root / 'private.json'
        environment.write_text(json.dumps({'LO_REPLAY_MODE': 'seed-replay', 'LO_REPLAY_CONTROL': 'http://127.0.0.1:23456/rpc', 'LO_REPLAY_SESSION': 'a' * (API['POLICY']['sessionBytes'] * 2), 'LO_REPLAY_BEARER': 'b' * (API['POLICY']['bearerBytes'] * 2), 'LO_REPLAY_RUNNER_SOURCE': SOURCE}))
        return destination, environment

    def test_package_roundtrip_modes_links_full_hashes_and_runner_only_ats(self):
        destination, environment = self.package()
        receipt = json.loads((self.root / 'setup-receipt.json').read_text())
        self.assertTrue(receipt['packageValidated'])
        self.assertEqual(receipt['compileOutcome'], 'not-started')
        self.assertEqual(receipt['runnerTarSHA256'], hashlib.sha256((self.root / 'runner-products.tar.gz').read_bytes()).hexdigest())
        saved = json.loads((destination / 'runner-manifest.json').read_text())
        self.assertEqual(saved['products'], API['manifest'](destination / 'Products'))
        self.assertEqual(saved['source'], SOURCE)
        self.assertEqual((destination / 'Products/Debug-iphonesimulator/RetirementSystemAlert-Runner.app/Runner').stat().st_mode & 0o777, 0o755)
        self.assertTrue((destination / 'Products/Debug-iphonesimulator/RetirementSystemAlert-Runner.app/Alias').is_symlink())
        output = destination / 'Products/private.xctestrun'
        API['prepare'](destination, environment, output)
        value = plistlib.loads(output.read_bytes())
        self.assertEqual(value['RetirementSystemAlert']['TestHostPath'], '__TESTROOT__/Debug-iphonesimulator/RetirementSystemAlert-Runner.app')
        for field in ('EnvironmentVariables', 'TestingEnvironmentVariables'):
            self.assertEqual(value['RetirementSystemAlert'][field]['LO_REPLAY_BEARER'], 'b' * 64)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('LO_REPLAY_BEARER', (self.root / 'runner-manifest.json').read_text())

    def test_duplicated_xctestrun_refused(self):
        shutil.copyfile(self.tree / 'Fixture.xctestrun', self.tree / 'Other.xctestrun')
        with self.assertRaises(ValueError): API['package'](self.root)

    def test_extra_app_target_refused(self):
        (self.tree / 'Foreign.app').mkdir()
        with self.assertRaises(ValueError): API['package'](self.root)

    def test_bad_macro_and_app_target_refused(self):
        path = self.tree / 'Fixture.xctestrun'
        original = plistlib.loads(path.read_bytes())
        for key, value in [('TestHostPath', '/arbitrary/Runner.app'), ('UITargetAppPath', '/arbitrary/App.app'), ('DependentProductPaths', ['__TESTROOT__/../escape'])]:
            changed = copy.deepcopy(original)
            changed['RetirementSystemAlert'][key] = value
            path.write_bytes(plistlib.dumps(changed))
            with self.subTest(key=key), self.assertRaises(ValueError): API['configuration'](self.tree)

    def test_special_mode_escape_symlink_and_hardlink_refused(self):
        binary = self.runner / 'Runner'
        binary.chmod(0o4755)
        with self.assertRaises(ValueError): API['manifest'](self.tree)
        binary.chmod(0o755)
        (self.runner / 'Escape').symlink_to('/outside')
        with self.assertRaises(ValueError): API['manifest'](self.tree)
        (self.runner / 'Escape').unlink()
        os.link(binary, self.runner / 'Hard')
        with self.assertRaises(ValueError): API['manifest'](self.tree)

    def test_transport_or_source_tampering_refused_before_output(self):
        destination, environment = self.package()
        original = json.loads(environment.read_text())
        for key, value in [('LO_REPLAY_MODE', 'anything'), ('LO_REPLAY_CONTROL', 'https://example.invalid/rpc'), ('LO_REPLAY_CONTROL', 'http://127.0.0.1:23456/rpc?private=x'), ('LO_REPLAY_SESSION', 'invalid'), ('LO_REPLAY_RUNNER_SOURCE', 'd' * 40)]:
            environment.write_text(json.dumps({**original, key: value}))
            with self.subTest(key=key), self.assertRaises(ValueError): API['prepare'](destination, environment, destination / 'Products/private.xctestrun')
            self.assertFalse((destination / 'Products/private.xctestrun').exists())

    def test_changed_product_hash_or_mode_refused(self):
        destination, environment = self.package()
        binary = destination / 'Products/Debug-iphonesimulator/RetirementSystemAlert-Runner.app/Runner'
        binary.chmod(0o644)
        with self.assertRaises(ValueError): API['prepare'](destination, environment, destination / 'Products/private.xctestrun')
        binary.chmod(0o755)
        binary.write_bytes(b'tampered')
        with self.assertRaises(ValueError): API['prepare'](destination, environment, destination / 'Products/private.xctestrun')

    def set_ats(self, value):
        path = self.runner / 'Info.plist'
        info = plistlib.loads(path.read_bytes())
        info['NSAppTransportSecurity'] = value
        path.write_bytes(plistlib.dumps(info))

    def packaged_runner_ats(self):
        # Read the plist member straight from OUR just-built archive: no extraction,
        # and it works on the hosted /usr/bin/python3, whose tarfile has no extraction `filter=`.
        with API['tarfile'].open(self.root / 'runner-products.tar.gz') as archive:
            member = archive.extractfile('Products/Debug-iphonesimulator/RetirementSystemAlert-Runner.app/Info.plist')
            return plistlib.loads(member.read())['NSAppTransportSecurity']

    def test_xcode_runner_template_ats_is_replaced_with_local_only(self):
        # Xcode's XCTRunner template value (Xcode 26.6 / SDK 26.5) is rewritten,
        # never shipped: the packaged runner reads back as local networking only.
        self.set_ats({'NSAllowsArbitraryLoads': True})
        API['package'](self.root)
        self.assertEqual(self.packaged_runner_ats(), {'NSAllowsLocalNetworking': True})
        receipt = json.loads((self.root / 'setup-receipt.json').read_text())
        self.assertIs(receipt['localNetworkingOnly'], True)
        self.assertIs(receipt['packageValidated'], True)

    def test_broad_ats_is_not_silently_relaxed(self):
        # Anything that is not exactly the template, exactly local-only, or absent
        # is refused before packaging, so a changed template is looked at again.
        for value in [
            {'NSAllowsArbitraryLoads': True, 'NSAllowsLocalNetworking': True},
            {'NSAllowsArbitraryLoads': True, 'NSExceptionDomains': {'example.com': {'NSExceptionAllowsInsecureHTTPLoads': True}}},
            {'NSExceptionDomains': {'localhost': {'NSExceptionAllowsInsecureHTTPLoads': True}}},
            {'NSAllowsArbitraryLoadsInWebContent': True},
            {'NSAllowsArbitraryLoads': 1},
            {'NSAllowsArbitraryLoads': 'YES'},
            {'NSAllowsArbitraryLoads': False},
            {'NSAllowsLocalNetworking': 1},
            {'NSAllowsLocalNetworking': False},
            [],
        ]:
            with self.subTest(value=value):
                self.set_ats(value)
                with self.assertRaises(ValueError): API['package'](self.root)
                self.assertFalse((self.root / 'runner-products.tar.gz').exists())

    def test_compile_preflight_checks_actual_original_identity_and_remaining_window(self):
        value = {'id': 13335948355, 'expired': False, 'expires_at': '2030-01-01T00:00:00Z', 'workflow_run': {'id': 41842459195, 'head_sha': '2989876958f6c605f6756f59b15519456516faa7'}}
        self.assertEqual(API['preflight_retained']('fixture-only', lambda: value, 1000)['minimumWindowSeconds'], 1380)
        # 22 min left is now too little for an 18-min replay job + margin.
        with self.assertRaises(ValueError): API['preflight_retained']('fixture-only', lambda: value, datetime.datetime(2030, 1, 1, tzinfo=datetime.timezone.utc).timestamp() - 22 * 60)
        API['preflight_retained']('fixture-only', lambda: value, datetime.datetime(2030, 1, 1, tzinfo=datetime.timezone.utc).timestamp() - 24 * 60)
        for field, wrong in [('id', 1), ('expired', True), ('expires_at', 'not-a-date'), ('expires_at', '1970-01-01T00:20:00Z')]:
            with self.subTest(field=field), self.assertRaises(ValueError): API['preflight_retained']('fixture-only', lambda: {**value, field: wrong}, 1000)
        with self.assertRaises(ValueError): API['preflight_retained']('fixture-only', lambda: {**value, 'workflow_run': {'id': 1, 'head_sha': 'd' * 40}}, 1000)

    def test_setup_marks_passed_only_after_package_validated(self):
        setup = runpy.run_path(str(HERE / 'retirement-ui-setup.py'))['setup']
        for fail in (False, True):
            output = self.root / ('setup-fail' if fail else 'setup-pass')
            def popen(*_args, **_kwargs):
                products(output)
                return types.SimpleNamespace(pid=9999999, poll=lambda: 0, wait=lambda: 0)
            seen = []
            def package_boundary(*_args, **_kwargs):
                seen.append(json.loads((output / 'setup-receipt.json').read_text())['compileOutcome'])
                if fail: raise ValueError('Synthetic package failure')
                API['package'](output)
            fake = types.SimpleNamespace(STDOUT=-2, check_output=lambda args, **kw: (SOURCE + '\n') if args[0] == 'git' else 'fixture SDK\n', Popen=popen, run=package_boundary)
            with mock.patch.dict(setup.__globals__, {'subprocess': fake, 'PREFLIGHT': lambda credential: {'artifactID': 13335948355, 'expiresAt': 9999999999}}), mock.patch.object(os, 'killpg') as kill:
                if fail:
                    with self.assertRaises(ValueError): setup(output)
                else: setup(output)
                kill.assert_called_once_with(9999999, API.get('signal', __import__('signal')).SIGKILL)
            self.assertEqual(seen, ['not-started'])
            receipt = json.loads((output / 'setup-receipt.json').read_text())
            self.assertEqual(receipt['compileOutcome'], 'failed' if fail else 'passed')
            self.assertFalse(receipt['appBuildAttempted'])
            self.assertFalse(receipt['testExecutionAttempted'])


if __name__ == '__main__': unittest.main()
