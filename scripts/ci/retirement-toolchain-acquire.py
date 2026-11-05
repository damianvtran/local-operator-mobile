#!/usr/bin/env python3
"""One credentialed fixed-artifact download boundary; no executable dispatch.

Redirects are handled explicitly so the GitHub bearer can never follow a signed
blob URL. Only the verified raw ZIP is allowed to become extracted probe input.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import runpy
import shutil
import signal
import stat
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

API = runpy.run_path(str(Path(__file__).with_name('retirement-toolchain-probe.py')))
METADATA = f"https://api.github.com/repos/{API['REPOSITORY']}/actions/artifacts/{API['ARTIFACT']}"
ZIP_ENDPOINT = METADATA + '/zip'
FILENAMES = {'setup-receipt.json': API['CAP'], 'runner-products.tar.gz': API['MAX_ARCHIVE']}


class Closed(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def signed_blob(url):
    value = urllib.parse.urlsplit(url)
    host = value.hostname or ''
    query = urllib.parse.parse_qs(value.query, strict_parsing=True)
    # GitHub's Azure artifacts live under actions-results. Unknown providers or
    # layouts fail closed rather than becoming an arbitrary authenticated fetch.
    if (value.scheme != 'https' or value.username is not None or value.password is not None
        or value.port not in (None, 443) or value.fragment
        or not re.fullmatch(r'[a-z0-9-]+\.(?:blob\.core\.windows\.net|githubusercontent\.com)', host)
        or not value.path.startswith('/actions-results/')
        or '%' in value.path or '\\' in value.path or '//' in value.path
        or any(part in ('.', '..') for part in value.path.split('/'))
        or not (query.get('sig') or (host.endswith('.githubusercontent.com') and query.get('token')))
        or any(ord(char) <= 32 or ord(char) >= 127 for char in url)):
        raise Closed()
    return url


def read_bounded(response, maximum, deadline, output=None):
    data = bytearray()
    size = 0
    while True:
        if time.monotonic() >= deadline:
            raise Closed()
        block = response.read(min(65536, maximum + 1 - size))
        if time.monotonic() >= deadline:
            raise Closed()
        if not block:
            return bytes(data) if output is None else size
        size += len(block)
        if size > maximum:
            raise Closed()
        if output is None:
            data.extend(block)
        else:
            output.write(block)


def extract_zip(archive, destination):
    # Inspect every central-directory entry before writing any file. Outer ZIP
    # contents are a fixed two-file contract, not a general extraction utility.
    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        if len(members) != len(FILENAMES) or {item.filename for item in members} != set(FILENAMES):
            raise Closed()
        for item in members:
            mode = item.external_attr >> 16
            if (PurePosixPath(item.filename).name != item.filename or item.is_dir()
                or item.flag_bits & 1 or item.file_size > FILENAMES[item.filename]
                or item.file_size < 0 or item.compress_size > API['SIZE']
                or mode & 0o7000 or stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                raise Closed()
        for item in members:
            with zipped.open(item) as source, (destination / item.filename).open('xb') as output:
                size = read_bounded(source, FILENAMES[item.filename], time.monotonic() + 15, output)
            if size != item.file_size:
                raise Closed()
            (destination / item.filename).chmod(0o600)


def acquire(destination):
    opener = urllib.request.build_opener(NoRedirect)
    deadline = time.monotonic() + 75
    headers = {'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'], 'Accept': 'application/vnd.github+json'}
    with opener.open(urllib.request.Request(METADATA, headers=headers), timeout=15) as response:
        if response.status != 200:
            raise Closed()
        metadata = json.loads(read_bounded(response, API['CAP'], deadline))
    API['identity'](metadata)
    # With redirects disabled urllib represents the expected 302 as HTTPError.
    try:
        response = opener.open(urllib.request.Request(ZIP_ENDPOINT, headers=headers), timeout=15)
    except urllib.error.HTTPError as error:
        if error.code != 302:
            error.close()
            raise Closed() from None
        try:
            location = signed_blob(error.headers['Location'])
        finally:
            error.close()
    else:
        response.close()
        raise Closed()
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    try:
        with tempfile.TemporaryDirectory(prefix='.acquire-', dir=destination.parent) as temporary:
            private = Path(temporary)
            archive = private / 'runner.zip'
            # This request has NO authorization header and cannot redirect again.
            with opener.open(urllib.request.Request(location), timeout=15) as response, archive.open('xb') as output:
                if response.status != 200:
                    raise Closed()
                size = read_bounded(response, API['SIZE'], deadline, output)
            if size != API['SIZE'] or API['digest'](archive) != API['DIGEST']:
                raise Closed()
            API['identity'](metadata)  # Expiry is checked again after download.
            extract_zip(archive, private)
            keys = ('id', 'size_in_bytes', 'digest', 'expired', 'expires_at', 'workflow_run')
            (private / 'identity.json').write_text(json.dumps({key: metadata[key] for key in keys}))
            for name in (*FILENAMES, 'runner.zip', 'identity.json'):
                (private / name).chmod(0o600)
                (private / name).rename(destination / name)
    except BaseException:
        shutil.rmtree(destination)
        raise


def main(argv=None):
    import sys
    argv = sys.argv[1:] if argv is None else argv
    def deadline(*_):
        raise Closed()
    previous = signal.signal(signal.SIGALRM, deadline)
    signal.setitimer(signal.ITIMER_REAL, 90)
    try:
        if len(argv) != 1:
            raise Closed()
        acquire(Path(argv[0]))
        return 0
    except Exception:
        # Deliberately no exception/URL/header/argv output, including API errors.
        print('{"schemaVersion":1,"status":"closed","reason":"acquisition"}')
        return 1
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


if __name__ == '__main__':
    raise SystemExit(main())
