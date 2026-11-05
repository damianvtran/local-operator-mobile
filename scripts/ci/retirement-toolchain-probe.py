#!/usr/bin/env python3
"""NO-TEST evidence only. Private bytes never become diagnostic strings.

The only executable boundary is standalone xcodebuild version/help. Configuration
checks reuse the replay's existing validator, not an invented parser action.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import runpy
import selectors
import signal
import stat
import subprocess
import tarfile
import tempfile
import time
import zipfile

HERE = Path(__file__).parent
try:
    PRODUCTS = runpy.run_path(str(HERE / 'retirement-replay-products.py'))
except Exception:
    # A damaged policy/helper closes inside main instead of emitting its error.
    PRODUCTS = None
RUN = 41985836532
ARTIFACT = 13398590341
SIZE = 6844204
DIGEST = '861740ebe53e0ff6c6ec610c571216ffbfdeec20258b281c6e3c562458195786'
SOURCE = '4fff5e12296c3b6bd4ce3663988b9da8ca383227'
REPOSITORY = 'damianvtran/local-operator-mobile'
OPTIONS = ('-xctestrun', '-destination', '-parallel-testing-enabled',
           '-maximum-concurrent-test-simulator-destinations', '-only-testing',
           '-test-iterations', '-resultBundlePath')
CAP = 256 * 1024
MAX_ARCHIVE = 16 * 1024**2
MAX_MEMBER = 64 * 1024**2
MAX_TOTAL = 256 * 1024**2
MAX_MEMBERS = 20000
CODES = ('passed', 'identity', 'archive', 'configuration', 'toolchain-version',
         'command-exit', 'command-timeout', 'output-limit', 'deadline', 'internal')


class Closed(Exception):
    def __init__(self, code):
        self.code = code


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(65536), b''):
            value.update(block)
    return value.hexdigest()


def bounded_json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > CAP:
        raise Closed('identity')
    return json.loads(path.read_bytes())


def identity(value):
    """GitHub metadata is acquired outside the credential-free probe process."""
    try:
        expiry = datetime.datetime.fromisoformat(value['expires_at'].replace('Z', '+00:00'))
        if (value['id'] != ARTIFACT or value['size_in_bytes'] != SIZE
            or value['digest'] != 'sha256:' + DIGEST or value['expired'] is not False
            or value['workflow_run']['id'] != RUN
            or value['workflow_run']['head_sha'] != SOURCE
            or expiry <= datetime.datetime.now(datetime.timezone.utc)):
            raise ValueError()
    except Exception:
        raise Closed('identity') from None


def downloaded_zip(download):
    archive = download / 'runner.zip'
    if (archive.is_symlink() or not archive.is_file() or archive.stat().st_size != SIZE
        or digest(archive) != DIGEST):
        raise Closed('identity')
    # Bind the separately acquired inputs to the independently rehashed ZIP,
    # rather than trusting a self-consistent replacement tar/receipt pair.
    expected = {'setup-receipt.json': CAP, 'runner-products.tar.gz': MAX_ARCHIVE}
    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        if len(members) != 2 or {item.filename for item in members} != set(expected):
            raise Closed('identity')
        for item in members:
            target = download / item.filename
            if (item.file_size > expected[item.filename] or target.is_symlink()
                or not target.is_file() or target.stat().st_size != item.file_size):
                raise Closed('identity')
            value = hashlib.sha256()
            size = 0
            with zipped.open(item) as source:
                for block in iter(lambda: source.read(65536), b''):
                    size += len(block)
                    if size > expected[item.filename]:
                        raise Closed('identity')
                    value.update(block)
            if size != item.file_size or value.hexdigest() != digest(target):
                raise Closed('identity')


def command(tool, option, seconds=15):
    if option not in ('-version', '-help') or not 0 < seconds <= 15:
        raise Closed('internal')
    environment = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin'}
    if os.environ.get('DEVELOPER_DIR'):
        environment['DEVELOPER_DIR'] = os.environ['DEVELOPER_DIR']
    child = subprocess.Popen([str(tool), option], env=environment,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             start_new_session=True)
    started = time.monotonic()
    output = bytearray()
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            while True:
                remaining = seconds - (time.monotonic() - started)
                if remaining <= 0:
                    raise Closed('command-timeout')
                if not selector.select(min(remaining, 0.1)):
                    continue
                chunk = os.read(child.stdout.fileno(), min(65536, CAP + 1 - len(output)))
                if not chunk:
                    break
                output.extend(chunk)
                if len(output) > CAP:
                    raise Closed('output-limit')
        try:
            code = child.wait(timeout=max(0.001, seconds - (time.monotonic() - started)))
        except subprocess.TimeoutExpired:
            raise Closed('command-timeout') from None
        if code != 0:
            raise Closed('command-exit')
        return bytes(output)
    finally:
        # Reap descendants even when the leader exited, including pipe holders.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
        child.stdout.close()


def toolchain(tool=Path('/usr/bin/xcodebuild')):
    version = command(tool, '-version')
    if version.strip() != b'Xcode 26.6\nBuild version 17F113':
        raise Closed('toolchain-version')
    help_text = command(tool, '-help').decode('utf-8', errors='replace')
    return {'versionMatched': True, 'xcodeMajor': 26, 'xcodeMinor': 6,
            'buildMatched': True,
            'optionsPresent': {key: bool(re.search(r'(?<![\w-])' + re.escape(key) + r'(?=[:\s=]|$)', help_text)) for key in OPTIONS}}


def extract(archive, root):
    """Stream regular data with bounded metadata; never delegate link extraction.

    Internal relative symlinks occur in real Apple products. Create them last,
    after checking every destination/ancestor, so no write can traverse a link.
    Hardlinks and special modes are never necessary for this runner handoff.
    """
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE:
        raise Closed('archive')
    total = 0
    seen = set()
    links = []
    directories = []
    class BoundedInfo(tarfile.TarInfo):
        headers = 0
        declared = 0

        def _proc_member(self, tar):
            # tarfile consumes PAX/GNU extension payload BEFORE yielding a member.
            # Bound those headers here as well, before its internal read(size).
            BoundedInfo.headers += 1
            BoundedInfo.declared += self.size
            extension = self.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK)
            if (BoundedInfo.headers > MAX_MEMBERS * 2 or self.size < 0
                or self.size > (16384 if extension else MAX_MEMBER)
                or BoundedInfo.declared > MAX_TOTAL
                or self.type == tarfile.GNUTYPE_SPARSE):
                raise Closed('archive')
            return super()._proc_member(tar)

    with tarfile.open(archive, 'r|gz', tarinfo=BoundedInfo) as tar:
        for item in tar:
            name = PurePosixPath(item.name)
            if (len(seen) >= MAX_MEMBERS or item.name in seen or name.is_absolute()
                or '..' in name.parts or not name.parts or '\\' in item.name
                or name.parts[0] not in ('Products', 'runner-manifest.json')
                or (name.parts[0] == 'runner-manifest.json' and (len(name.parts) != 1 or not item.isfile()))
                or item.mode & ~0o777 or item.size < 0 or item.size > MAX_MEMBER
                or item.sparse is not None):
                raise Closed('archive')
            seen.add(item.name)
            total += item.size
            if total > MAX_TOTAL:
                raise Closed('archive')
            target = root.joinpath(*name.parts)
            if any(parent.is_symlink() for parent in (target, *target.parents)):
                raise Closed('archive')
            target.parent.mkdir(parents=True, exist_ok=True)
            if item.isdir():
                target.mkdir(exist_ok=True)
                directories.append((target, item.mode))
            elif item.isfile():
                with tar.extractfile(item) as source, target.open('xb') as out:
                    remaining = item.size
                    while remaining:
                        block = source.read(min(65536, remaining))
                        if not block:
                            raise Closed('archive')
                        out.write(block)
                        remaining -= len(block)
                target.chmod(item.mode)
            elif item.issym():
                if (PurePosixPath(item.linkname).is_absolute() or '\\' in item.linkname
                    or not (target.parent / item.linkname).resolve().is_relative_to((root / 'Products').resolve())):
                    raise Closed('archive')
                links.append((target, item.linkname))
            else:
                raise Closed('archive')
            # TarFile retains metadata even in stream mode; cap above bounds it.
    for target, link in links:
        if target.exists() or any(parent.is_symlink() for parent in target.parents):
            raise Closed('archive')
        target.symlink_to(link)
    for target, _ in links:
        if not target.resolve().is_relative_to((root / 'Products').resolve()) or not target.exists():
            raise Closed('archive')
    for target, mode in reversed(directories):
        target.chmod(mode)


def references(value, products, runner):
    target = value['RetirementSystemAlert']
    count = 0
    # Validate every macro-bearing string, not just the two required host paths.
    def walk(item):
        nonlocal count
        if isinstance(item, dict):
            for child in item.values(): walk(child)
        elif isinstance(item, list):
            for child in item: walk(child)
        elif isinstance(item, str) and re.search(r'__[A-Z][A-Z0-9_]*__', item):
            platforms = Path(os.environ.get('DEVELOPER_DIR') or '/Applications/Xcode.app/Contents/Developer') / 'Platforms'
            expanded = item.replace('__TESTROOT__', str(products)).replace('__TESTHOST__', str(runner)).replace('__PLATFORMS__', str(platforms))
            if re.search(r'__[A-Z][A-Z0-9_]*__', expanded):
                raise Closed('configuration')
            # Xcode's DYLD search variables contain colon-separated macro paths.
            # Treat each component independently; never mistake the full search
            # string for a single filename or silently ignore SDK references.
            for component in expanded.split(':'):
                path = Path(component)
                if (not path.is_absolute() or not path.exists()
                    or not any(path.resolve().is_relative_to(base.resolve()) for base in (products, platforms))):
                    raise Closed('configuration')
                count += 1
    walk(target)
    return count


def static_check(download, root):
    receipt = bounded_json(download / 'setup-receipt.json')
    if (receipt.get('runnerSourceSHA') != SOURCE or receipt.get('compileOutcome') != 'passed'
        or receipt.get('packageValidated') is not True or receipt.get('localNetworkingOnly') is not True
        or receipt.get('appBuildAttempted') is not False or receipt.get('testExecutionAttempted') is not False
        or receipt.get('tapAttempted') is not False or receipt.get('mode') != 'setup-only'
        or receipt.get('xcodeVersion') != 'Xcode 26.6\nBuild version 17F113'
        or receipt.get('simulatorSDKVersion') != '26.5'
        or receipt.get('compileExitCode') != 0 or receipt.get('stopReason') is not None):
        raise Closed('identity')
    archive = download / 'runner-products.tar.gz'
    if archive.is_symlink() or archive.stat().st_size > MAX_ARCHIVE or digest(archive) != receipt.get('runnerTarSHA256'):
        raise Closed('archive')
    extract(archive, root)
    manifest = root / 'runner-manifest.json'
    if digest(manifest) != receipt.get('runnerManifestSHA256'):
        raise Closed('archive')
    saved = bounded_json(manifest)
    if saved.get('source') != SOURCE:
        raise Closed('identity')
    tree = root / 'Products'
    # Existing plist readers are intentionally reused, but never handed a huge
    # hostile configuration: the archive's executable cap is not a plist cap.
    for path in (*tree.glob('*.xctestrun'), *tree.glob('**/Info.plist')):
        if path.is_symlink() or not path.is_file() or path.stat().st_size > CAP:
            raise Closed('configuration')
    original, value, runner = PRODUCTS['configuration'](tree)
    if value.get('__xctestrun_metadata__') != {'FormatVersion': 1}:
        raise Closed('configuration')
    if PRODUCTS['manifest'](tree) != saved['products'] or digest(original) != saved['xctestrunSHA256']:
        raise Closed('configuration')
    relative_config = 'DerivedData/Build/Products/' + str(original.relative_to(tree))
    with (runner / 'Info.plist').open('rb') as stream:
        executable = runner / plistlib.load(stream)['CFBundleExecutable']
    relative_binary = 'DerivedData/Build/Products/' + str(executable.relative_to(tree))
    if (receipt.get('xctestrunSHA256') != {relative_config: digest(original)}
        or receipt.get('runnerExecutableSHA256') != {relative_binary: digest(executable)}):
        raise Closed('configuration')
    before = references(value, tree, runner)
    if PRODUCTS['POLICY']['sessionBytes'] != 24 or PRODUCTS['POLICY']['bearerBytes'] != 32:
        raise Closed('configuration')
    environment = root / 'synthetic.json'
    synthetic = {'LO_REPLAY_MODE': 'observe-only', 'LO_REPLAY_CONTROL': 'http://127.0.0.1:1/rpc',
                 'LO_REPLAY_SESSION': '0' * 48, 'LO_REPLAY_BEARER': '0' * 64,
                 'LO_REPLAY_RUNNER_SOURCE': SOURCE}
    environment.write_text(json.dumps(synthetic))
    environment.chmod(0o600)
    private = tree / 'private.xctestrun'
    PRODUCTS['prepare'](root, environment, private)
    with private.open('rb') as stream:
        relocated = plistlib.load(stream)
    for field in ('EnvironmentVariables', 'TestingEnvironmentVariables'):
        if any(relocated['RetirementSystemAlert'][field].get(key) != value for key, value in synthetic.items()):
            raise Closed('configuration')
    if private.parent != original.parent or stat.S_IMODE(private.stat().st_mode) != 0o600:
        raise Closed('configuration')
    if references(relocated, tree, runner) != before:
        raise Closed('configuration')
    return {'manifestMatched': True, 'configurationMatched': True, 'formatVersion': 1,
            'sameParentRelocation': True, 'syntheticEnvironmentMatched': True,
            'referencesMatched': True, 'referenceCount': before,
            'dependentReferenceCount': len(value['RetirementSystemAlert'].get('DependentProductPaths', [])),
            'memberCount': len(saved['products'])}


def empty_result():
    return {'schemaVersion': 1, 'status': 'closed', 'reason': 'internal',
            'identityMatched': False, 'static': None, 'toolchain': None,
            'testExecutionAttempted': False, 'appBuildAttempted': False}


def main(argv=None):
    import sys
    argv = sys.argv[1:] if argv is None else argv
    # No argparse: its usage/errors would publish caller-controlled paths/argv.
    result = empty_result()
    def deadline(*_):
        raise Closed('deadline')
    previous = signal.signal(signal.SIGALRM, deadline)
    signal.setitimer(signal.ITIMER_REAL, 120)
    try:
        if len(argv) != 2:
            raise Closed('internal')
        download, metadata = map(Path, argv)
        identity(bounded_json(metadata))
        downloaded_zip(download)
        result['identityMatched'] = True
        with tempfile.TemporaryDirectory(prefix='toolchain-probe-') as temporary:
            try:
                result['static'] = static_check(download, Path(temporary))
            except Closed:
                raise
            except Exception:
                raise Closed('configuration') from None
            result['toolchain'] = toolchain()
        result.update(status='passed', reason='passed')
    except Closed as failure:
        result['reason'] = failure.code if failure.code in CODES else 'internal'
    except Exception:
        result['reason'] = 'internal'
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
    output = json.dumps(result, sort_keys=True)
    if len(output.encode()) > 16384:
        output = json.dumps(empty_result(), sort_keys=True)
    print(output)
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
