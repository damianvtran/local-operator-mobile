"""NO native dispatch: fake tool and bounded archive fixtures only."""
import contextlib
import copy
import datetime
import hashlib
import importlib.util
import io
import plistlib
import signal
import subprocess
import sys
import tarfile
import time
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
import urllib.error
import zipfile
from unittest import mock

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('probe', HERE / 'retirement-toolchain-probe.py')
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tool = self.root / 'xcodebuild'
        self.record = self.root / 'calls'

    def fake(self, body):
        # Absolute interpreter: the probe's minimal PATH cannot hide a shell dependency.
        import sys
        self.tool.write_text('#!' + sys.executable + '\nimport os,sys,time\n'
            + f'with open({str(self.record)!r}, "a") as f: f.write(json.dumps(sys.argv[1:])+"\\n")\n'.replace('json.dumps', '__import__("json").dumps')
            + 'assert set(os.environ) <= {"PATH", "DEVELOPER_DIR", "LC_CTYPE", "__CF_USER_TEXT_ENCODING"}\n'
            + 'assert sys.argv[1:] in (["-version"], ["-help"])\n' + body)
        self.tool.chmod(0o700)

    def test_only_standalone_version_help_and_minimal_environment(self):
        self.fake('print("Xcode 26.6\\nBuild version 17F113" if sys.argv[1]=="-version" else "' + ' '.join(PROBE.OPTIONS) + '")\n')
        with mock.patch.dict(os.environ, {'GITHUB_TOKEN': 'SENTINEL', 'PRIVATE': 'SENTINEL'}):
            result = PROBE.toolchain(self.tool)
        self.assertTrue(result['versionMatched'])
        self.assertTrue(all(result['optionsPresent'].values()))
        self.assertEqual([json.loads(v) for v in self.record.read_text().splitlines()], [['-version'], ['-help']])
        self.assertNotIn('SENTINEL', json.dumps(result))

    def test_wrong_version_and_refusal_fail_closed(self):
        for body in ('print("Xcode 26.5\\nBuild version 17F113")', 'print("SENTINEL");sys.exit(1)'):
            self.fake(body)
            with self.assertRaises(PROBE.Closed): PROBE.toolchain(self.tool)

    def test_missing_option_is_boolean_not_success_claim(self):
        self.fake('print("Xcode 26.6\\nBuild version 17F113" if sys.argv[1]=="-version" else "-xctestrun")')
        result = PROBE.toolchain(self.tool)
        self.assertTrue(result['optionsPresent']['-xctestrun'])
        self.assertFalse(result['optionsPresent']['-test-iterations'])

    def test_output_and_timeout_are_bounded(self):
        for body, expected in [('os.write(1,b"SENTINEL"*40000)', 'output-limit'), ('os.write(2,b"SENTINEL"*40000)', 'output-limit'), ('time.sleep(10)', 'command-timeout')]:
            self.fake(body)
            with self.assertRaises(PROBE.Closed) as caught:
                PROBE.command(self.tool, '-help', seconds=2)
            self.assertEqual(caught.exception.code, expected)

    def metadata(self):
        return {'id': PROBE.ARTIFACT, 'size_in_bytes': PROBE.SIZE,
                'digest': 'sha256:' + PROBE.DIGEST, 'expired': False,
                'expires_at': '2099-01-01T00:00:00Z',
                'workflow_run': {'id': PROBE.RUN, 'head_sha': PROBE.SOURCE}}

    def fixture(self, mutate=None):
        source = self.root / 'source'
        source.mkdir()
        tree, runner = runpy.run_path(str(HERE / 'retirement-replay-products.test.py'))['products'](source)
        info = runner / 'Info.plist'
        value = plistlib.loads(info.read_bytes())
        value['NSAppTransportSecurity'] = {'NSAllowsLocalNetworking': True}
        info.write_bytes(plistlib.dumps(value))
        config = tree / 'Fixture.xctestrun'
        value = plistlib.loads(config.read_bytes())
        value['RetirementSystemAlert']['DependentProductPaths'].append('__TESTROOT__/Debug-iphonesimulator/RetirementSystemAlert-Runner.app/PlugIns/RetirementSystemAlert.xctest')
        if mutate: mutate(value)
        config.write_bytes(plistlib.dumps(value))
        manifest = source / 'runner-manifest.json'
        manifest.write_text(json.dumps({'version': 1, 'source': PROBE.SOURCE,
            'products': PROBE.PRODUCTS['manifest'](tree), 'localNetworkingOnly': True,
            'xctestrunSHA256': PROBE.digest(config)}))
        download = self.root / 'download'
        download.mkdir()
        archive = download / 'runner-products.tar.gz'
        with tarfile.open(archive, 'w:gz', dereference=False) as tar:
            tar.add(tree, arcname='Products')
            tar.add(manifest, arcname='runner-manifest.json')
        receipt = {'runnerSourceSHA': PROBE.SOURCE, 'compileOutcome': 'passed',
            'mode': 'setup-only', 'tapAttempted': False, 'compileExitCode': 0, 'stopReason': None,
            'xcodeVersion': 'Xcode 26.6\nBuild version 17F113', 'simulatorSDKVersion': '26.5',
            'xctestrunSHA256': {'DerivedData/Build/Products/Fixture.xctestrun': PROBE.digest(config)},
            'runnerExecutableSHA256': {'DerivedData/Build/Products/Debug-iphonesimulator/RetirementSystemAlert-Runner.app/Runner': PROBE.digest(runner / 'Runner')},
            'packageValidated': True, 'localNetworkingOnly': True,
            'appBuildAttempted': False, 'testExecutionAttempted': False,
            'runnerTarSHA256': PROBE.digest(archive),
            'runnerManifestSHA256': PROBE.digest(manifest)}
        (download / 'setup-receipt.json').write_text(json.dumps(receipt))
        raw_zip = download / 'runner.zip'
        with zipfile.ZipFile(raw_zip, 'w') as zipped:
            for name in ('setup-receipt.json', 'runner-products.tar.gz'):
                zipped.write(download / name, name)
        pins = mock.patch.multiple(PROBE, SIZE=raw_zip.stat().st_size, DIGEST=PROBE.digest(raw_zip))
        pins.start()
        self.addCleanup(pins.stop)
        metadata = self.root / 'identity.json'
        metadata.write_text(json.dumps(self.metadata()))
        return download, metadata

    def test_identity_pins_and_expiry(self):
        PROBE.identity(self.metadata())
        for key, value in [('id', 1), ('size_in_bytes', 1), ('digest', 'SENTINEL'),
                           ('expired', True), ('expires_at', '2000-01-01T00:00:00Z'),
                           ('workflow_run', {'id': PROBE.RUN, 'head_sha': 'SENTINEL'}),
                           ('workflow_run', {'id': 1, 'head_sha': PROBE.SOURCE})]:
            with self.subTest(key=key), self.assertRaises(PROBE.Closed):
                PROBE.identity({**self.metadata(), key: value})

    def test_static_and_synthetic_same_parent_roundtrip(self):
        download, _ = self.fixture()
        out = self.root / 'extracted'
        out.mkdir()
        with mock.patch.dict(PROBE.PRODUCTS, {'preflight_retained': mock.Mock(side_effect=AssertionError), 'package': mock.Mock(side_effect=AssertionError)}):
            result = PROBE.static_check(download, out)
        self.assertEqual(result['formatVersion'], 1)
        self.assertEqual(result['dependentReferenceCount'], 2)
        self.assertTrue(result['sameParentRelocation'])
        self.assertTrue(result['syntheticEnvironmentMatched'])
        config = plistlib.loads((out / 'Products/private.xctestrun').read_bytes())
        self.assertEqual(len(config['RetirementSystemAlert']['EnvironmentVariables']['LO_REPLAY_SESSION']), 48)
        self.assertEqual(len(config['RetirementSystemAlert']['EnvironmentVariables']['LO_REPLAY_BEARER']), 64)

    def test_static_configuration_rejects_missing_refs_and_unknown_format(self):
        mutations = [lambda v: v['RetirementSystemAlert']['DependentProductPaths'].append('__TESTROOT__/SENTINEL'),
                     lambda v: v['__xctestrun_metadata__'].update(FormatVersion=2),
                     lambda v: v['RetirementSystemAlert']['EnvironmentVariables'].update(DYLD_LIBRARY_PATH='__UNKNOWN__/SENTINEL')]
        for i, mutation in enumerate(mutations):
            with self.subTest(i=i), tempfile.TemporaryDirectory() as directory:
                old_root = self.root
                self.root = Path(directory)
                try:
                    download, _ = self.fixture(mutation)
                    out = self.root / 'out'; out.mkdir()
                    with self.assertRaises((PROBE.Closed, ValueError)): PROBE.static_check(download, out)
                finally: self.root = old_root

    def test_dyld_colon_platform_macros_and_escape(self):
        products = self.root / 'Products'; products.mkdir()
        developer = self.root / 'Developer'; platforms = developer / 'Platforms'; platforms.mkdir(parents=True)
        runner = products / 'runner'; runner.mkdir()
        value = {'RetirementSystemAlert': {'EnvironmentVariables': {'DYLD_LIBRARY_PATH': '__TESTROOT__:__PLATFORMS__'}}}
        with mock.patch.dict(os.environ, {'DEVELOPER_DIR': str(developer)}):
            self.assertEqual(PROBE.references(value, products, runner), 2)
            value['RetirementSystemAlert']['EnvironmentVariables']['DYLD_LIBRARY_PATH'] = '__TESTROOT__/../SENTINEL'
            with self.assertRaises(PROBE.Closed): PROBE.references(value, products, runner)

    def test_archive_tamper_and_receipt_source(self):
        download, _ = self.fixture()
        receipt = download / 'setup-receipt.json'
        original = json.loads(receipt.read_text())
        for field, value in [('runnerSourceSHA', 'SENTINEL'), ('runnerTarSHA256', '0' * 64), ('runnerManifestSHA256', '0' * 64)]:
            receipt.write_text(json.dumps({**original, field: value}))
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(PROBE.Closed):
                PROBE.static_check(download, Path(directory))

    def test_manifest_mode_and_content_tamper(self):
        download, _ = self.fixture()
        tree = self.root / 'source/DerivedData/Build/Products'
        runner = tree / 'Debug-iphonesimulator/RetirementSystemAlert-Runner.app/Runner'
        for mode, content in ((0o644, b'fixture-only executable'), (0o755, b'SENTINEL')):
            runner.chmod(mode); runner.write_bytes(content)
            archive = download / 'runner-products.tar.gz'
            with tarfile.open(archive, 'w:gz', dereference=False) as tar:
                tar.add(tree, arcname='Products')
                tar.add(self.root / 'source/runner-manifest.json', arcname='runner-manifest.json')
            receipt_path = download / 'setup-receipt.json'
            receipt = json.loads(receipt_path.read_text())
            receipt['runnerTarSHA256'] = PROBE.digest(archive)
            receipt_path.write_text(json.dumps(receipt))
            with tempfile.TemporaryDirectory() as directory, self.assertRaises((PROBE.Closed, ValueError)):
                PROBE.static_check(download, Path(directory))

    def test_archive_negative_controls(self):
        cases = [('traversal', '../SENTINEL', tarfile.REGTYPE, '', 0o644, 1),
                 ('absolute', '/SENTINEL', tarfile.REGTYPE, '', 0o644, 1),
                 ('hardlink', 'Products/bad', tarfile.LNKTYPE, 'Products/good', 0o644, 0),
                 ('symlink', 'Products/bad', tarfile.SYMTYPE, '../../SENTINEL', 0o777, 0),
                 ('fifo', 'Products/bad', tarfile.FIFOTYPE, '', 0o644, 0),
                 ('pax', 'Products/pax', tarfile.XHDTYPE, '', 0o644, PROBE.MAX_MEMBER + 1),
                 ('mode', 'Products/bad', tarfile.REGTYPE, '', 0o4644, 1),
                 ('giant', 'Products/bad', tarfile.REGTYPE, '', 0o644, PROBE.MAX_MEMBER + 1)]
        for label, name, kind, target, mode, size in cases:
            archive = self.root / (label + '.tar.gz')
            with tarfile.open(archive, 'w:gz') as tar:
                item = tarfile.TarInfo(name); item.type = kind; item.linkname = target; item.mode = mode; item.size = size
                # A huge declared size must be refused before reading any body.
                if size > PROBE.MAX_MEMBER:
                    # A header alone must trip the bound before reading payload.
                    tar.fileobj.write(item.tobuf())
                else:
                    tar.addfile(item, io.BytesIO(b'x') if size == 1 else None)
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory, self.assertRaises((PROBE.Closed, tarfile.TarError)):
                PROBE.extract(archive, Path(directory))
        malformed = self.root / 'malformed'; malformed.write_bytes(b'SENTINEL')
        with self.assertRaises(tarfile.TarError): PROBE.extract(malformed, self.root / 'bad')

    def test_member_total_and_compressed_size_bounds(self):
        archive = self.root / 'limits.tar.gz'
        with tarfile.open(archive, 'w:gz') as tar:
            for name in ('Products/a', 'Products/b'):
                item = tarfile.TarInfo(name); item.size = 5
                tar.addfile(item, io.BytesIO(b'12345'))
        for limit in ({'MAX_MEMBERS': 1}, {'MAX_TOTAL': 8}, {'MAX_ARCHIVE': 1}):
            with mock.patch.multiple(PROBE, **limit), tempfile.TemporaryDirectory() as directory, self.assertRaises(PROBE.Closed):
                PROBE.extract(archive, Path(directory))

    def test_timeout_kills_owned_descendant_and_reaps_leader(self):
        marker = self.root / 'late-marker'
        child_pid = self.root / 'pid'
        self.fake(f'pid=os.fork()\nif pid==0:\n time.sleep(3)\n open({str(marker)!r},"w").write("BAD")\nelse:\n open({str(child_pid)!r},"w").write(str(os.getpid()))\n time.sleep(10)\n')
        with self.assertRaises(PROBE.Closed): PROBE.command(self.tool, '-help', seconds=2)
        time.sleep(1.2)
        self.assertFalse(marker.exists())
        with self.assertRaises(ProcessLookupError): os.kill(int(child_pid.read_text()), 0)

    def test_closed_cli_does_not_leak_paths_errors_or_tracebacks(self):
        process = subprocess.run([sys.executable, str(HERE / 'retirement-toolchain-probe.py'), 'SENTINEL', 'SENTINEL'], capture_output=True, text=True, timeout=5)
        self.assertEqual(process.returncode, 1)
        self.assertEqual(process.stderr, '')
        self.assertNotIn('SENTINEL', process.stdout)
        self.assertEqual(set(json.loads(process.stdout)), set(PROBE.empty_result()))
        self.assertLess(len(process.stdout.encode()), 16384)

    def test_full_probe_exact_schema_and_private_tree_cleanup(self):
        download, metadata = self.fixture()
        self.fake('print("Xcode 26.6\\nBuild version 17F113" if sys.argv[1]=="-version" else "' + ' '.join(PROBE.OPTIONS) + ' SENTINEL")')
        toolchain = PROBE.toolchain
        stream = io.StringIO()
        with mock.patch.object(PROBE, 'toolchain', lambda: toolchain(self.tool)), contextlib.redirect_stdout(stream):
            self.assertEqual(PROBE.main([str(download), str(metadata)]), 0)
        result = json.loads(stream.getvalue())
        self.assertEqual(set(result), set(PROBE.empty_result()))
        self.assertEqual(set(result['static']), {'manifestMatched', 'configurationMatched', 'formatVersion', 'sameParentRelocation', 'syntheticEnvironmentMatched', 'referencesMatched', 'referenceCount', 'dependentReferenceCount', 'memberCount'})
        self.assertEqual(set(result['toolchain']), {'versionMatched', 'xcodeMajor', 'xcodeMinor', 'buildMatched', 'optionsPresent'})
        self.assertEqual(set(result['toolchain']['optionsPresent']), set(PROBE.OPTIONS))
        for forbidden in ('SENTINEL', str(self.root), 'LO_REPLAY_', PROBE.SOURCE): self.assertNotIn(forbidden, stream.getvalue())
        self.assertFalse(list(Path(tempfile.gettempdir()).glob('toolchain-probe-*')))

    def test_probe_binds_downloaded_files_to_raw_zip_before_static(self):
        download, metadata = self.fixture()
        original = (download / 'runner.zip').read_bytes()
        for change in ('zip', 'receipt'):
            (download / 'runner.zip').write_bytes(original)
            if change == 'zip':
                (download / 'runner.zip').write_bytes(original[:-1] + b'X')
            else:
                (download / 'setup-receipt.json').write_text('{}')
            output = io.StringIO()
            with mock.patch.object(PROBE, 'static_check') as static, mock.patch.object(PROBE, 'toolchain') as xcode, contextlib.redirect_stdout(output):
                self.assertEqual(PROBE.main([str(download), str(metadata)]), 1)
            static.assert_not_called(); xcode.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())['reason'], 'identity')

    def test_total_deadline_closes_and_cleans_private_tree(self):
        download, metadata = self.fixture()
        timer = signal.setitimer
        def shortened(which, seconds):
            return timer(which, 0.05 if seconds else 0)
        output = io.StringIO()
        with mock.patch.object(PROBE.signal, 'setitimer', side_effect=shortened), mock.patch.object(PROBE, 'static_check', side_effect=lambda *_: time.sleep(1)), contextlib.redirect_stdout(output):
            self.assertEqual(PROBE.main([str(download), str(metadata)]), 1)
        self.assertEqual(json.loads(output.getvalue())['reason'], 'deadline')
        self.assertFalse(list(Path(tempfile.gettempdir()).glob('toolchain-probe-*')))

    def test_colon_sdk_macros_resolve_and_unknown_or_missing_paths_close(self):
        products = self.root / 'Products'; products.mkdir()
        runner = products / 'Runner'; runner.mkdir()
        developer = self.root / 'Developer'; (developer / 'Platforms/iPhoneSimulator.platform/Developer/usr/lib').mkdir(parents=True)
        value = {'RetirementSystemAlert': {'EnvironmentVariables': {'DYLD_LIBRARY_PATH': '__TESTROOT__:__PLATFORMS__/iPhoneSimulator.platform/Developer/usr/lib'}}}
        with mock.patch.dict(os.environ, {'DEVELOPER_DIR': str(developer)}):
            self.assertEqual(PROBE.references(value, products, runner), 2)
            for bad in ('__UNKNOWN__/SENTINEL', '__TESTROOT__/missing', '__TESTROOT__/../SENTINEL'):
                value['RetirementSystemAlert']['EnvironmentVariables']['DYLD_LIBRARY_PATH'] = bad
                with self.assertRaises(PROBE.Closed): PROBE.references(value, products, runner)

    def test_workflow_and_source_contract(self):
        workflow = (HERE.parent.parent / '.github/workflows/retirement-toolchain-probe.yml').read_text()
        self.assertIn('workflow_dispatch:', workflow)
        self.assertIn('workflow_call:', workflow)
        self.assertIn('-retirement-toolchain-probe-', workflow)
        self.assertNotIn('inputs:', workflow)
        for forbidden in ('push:', 'pull_request:', 'contents: write', 'actions: write', '13335948355', 'build-for-testing', 'simctl', 'setup-node', 'pnpm', 'npm install'):
            self.assertNotIn(forbidden, workflow)
        for expected in ('contents: read', 'actions: read', 'timeout-minutes: 10', 'retirement-toolchain-acquire.py', 'persist-credentials: false', 'env -i PATH=', 'path: ${{ runner.temp }}/toolchain-probe.json'):
            self.assertIn(expected, workflow)
        self.assertEqual(workflow.count('GITHUB_TOKEN:'), 1)
        self.assertEqual(workflow.count('${{ github.token }}'), 1)
        self.assertNotIn('download-artifact@', workflow)
        self.assertNotIn('GITHUB_TOKEN', workflow.split('- name: Inspect private Products')[1])
        self.assertNotIn('--acquire-identity', (HERE / 'retirement-toolchain-probe.py').read_text())
        source = (HERE / 'retirement-toolchain-probe.py').read_text()
        for forbidden in ("PRODUCTS['package'](", "PRODUCTS['preflight_retained'](", 'communicate(', 'extractall(', 'shell=True'):
            self.assertNotIn(forbidden, source)
        replay = (HERE / 'retirement-ui-replay.ts').read_text().split('export function launchRunner(')[1].split('300000,')[0]
        for option in PROBE.OPTIONS: self.assertIn(option, replay)


ACQUIRE_SPEC = importlib.util.spec_from_file_location('acquire', HERE / 'retirement-toolchain-acquire.py')
ACQUIRE = importlib.util.module_from_spec(ACQUIRE_SPEC)
ACQUIRE_SPEC.loader.exec_module(ACQUIRE)


class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as zipped:
            zipped.writestr('setup-receipt.json', '{}')
            zipped.writestr('runner-products.tar.gz', b'fixture tar')
        self.zip = data.getvalue()
        self.metadata = ProbeTests.metadata(self)
        self.url = 'https://productionresultssa0.blob.core.windows.net/actions-results/run/artifact.zip?sig=synthetic&se=2099'
        self.requests = []
        self.pins = mock.patch.dict(ACQUIRE.API, SIZE=len(self.zip), DIGEST=hashlib.sha256(self.zip).hexdigest())
        self.pins.start()
        self.addCleanup(self.pins.stop)

    def response(self, data):
        value = io.BytesIO(data)
        value.status = 200
        return value

    def opener(self, request, timeout):
        self.assertEqual(timeout, 15)
        self.requests.append((request.full_url, dict(request.header_items())))
        if request.full_url == ACQUIRE.METADATA:
            return self.response(json.dumps(self.metadata).encode())
        if request.full_url == ACQUIRE.ZIP_ENDPOINT:
            raise urllib.error.HTTPError(request.full_url, 302, 'private error', {'Location': self.url}, io.BytesIO())
        self.assertEqual(request.full_url, self.url)
        return self.response(self.zip)

    def run_acquire(self):
        destination = self.root / 'download'
        with mock.patch.dict(os.environ, {'GITHUB_TOKEN': 'SENTINEL'}), mock.patch.object(ACQUIRE.urllib.request, 'build_opener', return_value=mock.Mock(open=self.opener)):
            ACQUIRE.acquire(destination)
        return destination

    def test_raw_zip_hash_before_exact_extraction_and_anonymous_redirect(self):
        destination = self.run_acquire()
        self.assertEqual({p.name for p in destination.iterdir()}, {'runner.zip', 'identity.json', *ACQUIRE.FILENAMES})
        self.assertEqual(PROBE.digest(destination / 'runner.zip'), hashlib.sha256(self.zip).hexdigest())
        self.assertEqual([url for url, _ in self.requests[:2]], [ACQUIRE.METADATA, ACQUIRE.ZIP_ENDPOINT])
        self.assertTrue(all(headers.get('Authorization') == 'Bearer SENTINEL' for _, headers in self.requests[:2]))
        self.assertEqual(self.requests[2][1], {})
        self.assertFalse(list(self.root.glob('.acquire-*')))
        self.assertFalse(ACQUIRE.NoRedirect().redirect_request(None, None, None, None, None, None))

    def test_wrong_metadata_digest_size_source_and_expiry(self):
        cases = [('id', 1), ('digest', 'sha256:' + '0' * 64), ('size_in_bytes', 1), ('expired', True),
                 ('expires_at', '2000-01-01T00:00:00Z'),
                 ('workflow_run', {'id': PROBE.RUN, 'head_sha': '0' * 40}),
                 ('workflow_run', {'id': 1, 'head_sha': PROBE.SOURCE})]
        original = self.metadata.copy()
        for key, value in cases:
            self.metadata = {**original, key: value}; self.requests.clear()
            with self.subTest(key=key), self.assertRaises(Exception): self.run_acquire()
            self.assertEqual(len(self.requests), 1)
            self.assertFalse((self.root / 'download').exists())

    def test_redirect_host_path_scheme_userinfo_and_signature_are_closed(self):
        cases = ['http://productionresultssa0.blob.core.windows.net/actions-results/a?sig=x',
                 'https://evil.example/actions-results/a?sig=x',
                 'https://good.blob.core.windows.net.evil.example/actions-results/a?sig=x',
                 'https://user:password@good.blob.core.windows.net/actions-results/a?sig=x',
                 'https://good.blob.core.windows.net:444/actions-results/a?sig=x',
                 'https://good.blob.core.windows.net/not-artifacts/a?sig=x',
                 'https://good.blob.core.windows.net/actions-results/../a?sig=x',
                 'https://good.blob.core.windows.net/actions-results/%2e%2e/a?sig=x',
                 'https://good.blob.core.windows.net/actions-results/a',
                 'https://good.blob.core.windows.net/actions-results/a?sig=x#fragment']
        for url in cases:
            self.url = url; self.requests.clear()
            with self.subTest(url=url), self.assertRaises(Exception): self.run_acquire()
            self.assertEqual(len(self.requests), 2)
            self.assertFalse((self.root / 'download').exists())
        self.assertEqual(ACQUIRE.signed_blob('https://results.githubusercontent.com/actions-results/a?token=synthetic'), 'https://results.githubusercontent.com/actions-results/a?token=synthetic')

    def test_raw_digest_mismatch_truncated_and_oversized_stream_never_extract(self):
        original = self.zip
        for data in (original[:-1] + b'X', original[:-1], original + b'X'):
            self.zip = data
            with mock.patch.object(ACQUIRE, 'extract_zip') as extract, self.assertRaises(Exception): self.run_acquire()
            extract.assert_not_called()
            self.assertFalse((self.root / 'download').exists())
            self.assertFalse(list(self.root.glob('.acquire-*')))

    def test_http_timeouts_and_monotonic_budget_close_without_residue(self):
        def timeout(*_args, **_kwargs): raise TimeoutError('SENTINEL')
        with mock.patch.dict(os.environ, {'GITHUB_TOKEN': 'SENTINEL'}), mock.patch.object(ACQUIRE.urllib.request, 'build_opener', return_value=mock.Mock(open=timeout)), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(ACQUIRE.main([str(self.root / 'download')]), 1)
        self.assertEqual(json.loads(output.getvalue()), {'schemaVersion': 1, 'status': 'closed', 'reason': 'acquisition'})
        with mock.patch.object(ACQUIRE.time, 'monotonic', side_effect=[0, 76]), self.assertRaises(ACQUIRE.Closed):
            self.run_acquire()
        self.assertFalse((self.root / 'download').exists())

    def test_blob_read_timeout_cleans_partial_private_inputs(self):
        opener = self.opener
        def timeout(request, timeout):
            if request.full_url == self.url:
                response = self.response(b'')
                response.read = mock.Mock(side_effect=TimeoutError('SENTINEL'))
                return response
            return opener(request, timeout)
        with mock.patch.dict(os.environ, {'GITHUB_TOKEN': 'SENTINEL'}), mock.patch.object(ACQUIRE.urllib.request, 'build_opener', return_value=mock.Mock(open=timeout)), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(ACQUIRE.main([str(self.root / 'download')]), 1)
        self.assertNotIn('SENTINEL', output.getvalue())
        self.assertFalse((self.root / 'download').exists())
        self.assertFalse(list(self.root.glob('.acquire-*')))

    def test_blob_redirect_is_not_followed_and_expiry_is_rechecked(self):
        opener = self.opener
        def again(request, timeout):
            if request.full_url == self.url:
                raise urllib.error.HTTPError(self.url, 302, 'SENTINEL', {'Location': 'https://evil.example'}, io.BytesIO())
            return opener(request, timeout)
        with mock.patch.dict(os.environ, {'GITHUB_TOKEN': 'SENTINEL'}), mock.patch.object(ACQUIRE.urllib.request, 'build_opener', return_value=mock.Mock(open=again)), self.assertRaises(urllib.error.HTTPError):
            ACQUIRE.acquire(self.root / 'download')
        self.assertFalse((self.root / 'download').exists())
        with mock.patch.dict(ACQUIRE.API, identity=mock.Mock(side_effect=[None, PROBE.Closed('identity')])), mock.patch.object(ACQUIRE, 'extract_zip') as extract, self.assertRaises(PROBE.Closed):
            self.run_acquire()
        extract.assert_not_called()
        self.assertFalse((self.root / 'download').exists())

    def test_outer_zip_exact_names_modes_and_sizes_before_write(self):
        for bad in ('../SENTINEL', '/SENTINEL', 'extra', 'sub/setup-receipt.json'):
            archive = self.root / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as zipped:
                zipped.writestr(bad, b'X'); zipped.writestr('runner-products.tar.gz', b'X')
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(ACQUIRE.Closed):
                ACQUIRE.extract_zip(archive, Path(directory))
                self.assertFalse(list(Path(directory).iterdir()))
        for mode, data in ((0o120777, b'target'), (0o104644, b'X'), (0o100644, b'X' * (PROBE.CAP + 1))):
            archive = self.root / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as zipped:
                info = zipfile.ZipInfo('setup-receipt.json'); info.external_attr = mode << 16
                zipped.writestr(info, data); zipped.writestr('runner-products.tar.gz', b'X')
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ACQUIRE.Closed): ACQUIRE.extract_zip(archive, Path(directory))
                self.assertFalse(list(Path(directory).iterdir()))


if __name__ == '__main__': unittest.main()
