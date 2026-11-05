#!/usr/bin/env python3
"""Fixed runner admission, with compiled source distinct from controller source.

Acquisition alone sees the account credential. Its durable clock starts BEFORE
network access; the credential-free supervisor consumes the remainder, not 300
new seconds. No original-app metadata, package or build is involved.
"""
import datetime
import json
import os
from pathlib import Path
import runpy
import signal
import sys
import time
import urllib.request

HERE = Path(__file__).parent
PROBE = runpy.run_path(str(HERE / 'retirement-toolchain-probe.py'))
SOURCE = PROBE['SOURCE']
EXPIRY = '2026-11-06T07:54:42Z'
SWIFT = {
    'ReplayGuards.swift': 'ed464658182bb48fe9c1207a14cd160f4f387818cf2052ee078672445f06e6fb',
    'ReplayHostClient.swift': 'c9c16f4d0ca546fbd9431a2cb9083875b8b0b397b3c8bace62ab990a98e0b6ac',
    'RetainedReplayTests.swift': '5f5d94c502387f60a619bfa8209392e70a5861e0b7155f60ca1b16e1640ff3cb',
    'ReplayGuardTests.swift': '2785325e1fbe468666802344862681a60dccadb62bb96c17dc9b450237369281',
}


def epoch(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def expiry_gate(metadata, dispatch, job_start, now=None):
    PROBE['identity'](metadata)
    expires = epoch(metadata['expires_at'])
    now = time.time() if now is None else now
    if (metadata['expires_at'] != EXPIRY or expires - dispatch < 180 * 60
            or expires - job_start < 20 * 60 or expires <= now
            or dispatch > job_start or job_start > now):
        raise ValueError('closed')
    return expires


def acquire(root):
    root.mkdir(mode=0o700)
    started = time.monotonic()
    job_start = time.time()
    clock = {'monotonicStart': started, 'jobStart': job_start}
    write(root / 'work-clock.json', clock)
    # The workflow run creation timestamp is the authoritative queued dispatch
    # boundary. It is fetched only in this credentialed acquisition step.
    run_id = os.environ['GITHUB_RUN_ID']
    if not run_id.isdigit():
        raise ValueError('closed')
    url = f"https://api.github.com/repos/{PROBE['REPOSITORY']}/actions/runs/{run_id}"
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'], 'Accept': 'application/vnd.github+json'})
    helper = runpy.run_path(str(HERE / 'retirement-toolchain-acquire.py'))
    with urllib.request.build_opener(helper['NoRedirect']).open(request, timeout=10) as response:
        value = json.loads(helper['read_bounded'](response, PROBE['CAP'], started + 90))
    if value['id'] != int(run_id) or value['event'] != 'workflow_dispatch' or value['head_sha'] != os.environ['GITHUB_SHA']:
        raise ValueError('closed')
    dispatch = epoch(value['created_at'])
    # Refuse doomed inputs before downloading; metadata is checked again after.
    if epoch(EXPIRY) - dispatch < 180 * 60 or epoch(EXPIRY) - job_start < 20 * 60:
        raise ValueError('closed')
    helper['acquire'](root / 'download')
    metadata = PROBE['bounded_json'](root / 'download/identity.json')
    expiry_gate(metadata, dispatch, job_start)
    clock.update(dispatch=dispatch, acquisitionMs=round((time.monotonic() - started) * 1000))
    write(root / 'work-clock.json', clock)


def write(path, value):
    with path.open('w') as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())


def prepare(root, environment):
    download = root / 'download'
    clock = PROBE['bounded_json'](root / 'work-clock.json')
    metadata = PROBE['bounded_json'](download / 'identity.json')
    expiry_gate(metadata, clock['dispatch'], clock['jobStart'])
    PROBE['downloaded_zip'](download)
    if PROBE['bounded_json'](download / 'setup-receipt.json').get('sources') != SWIFT:
        raise ValueError('closed')
    for name, expected in SWIFT.items():
        if PROBE['digest'](HERE / 'retirement-ui' / name) != expected:
            raise ValueError('closed')
    # static_check binds receipt -> tar -> manifest -> every product/config hash,
    # exact ATS and same-parent macro resolution; do not replace it with parsing.
    tree = root / 'runner'
    tree.mkdir(mode=0o700)
    result = PROBE['static_check'](download, tree)
    private = tree / 'Products/private.xctestrun'
    private.unlink()  # Only the synthetic file just created by static_check.
    PROBE['PRODUCTS']['prepare'](tree, environment, private)
    write(root / 'static-receipt.json', result)


def refresh(root):
    clock = PROBE['bounded_json'](root / 'work-clock.json')
    expiry_gate(PROBE['bounded_json'](root / 'download/identity.json'), clock['dispatch'], clock['jobStart'])
    # Fixed hashed ZIP and receipt are rechecked; no token or network is available
    # here. Expiration is absolute, so this is not a renewable metadata cache.
    PROBE['downloaded_zip'](root / 'download')


if __name__ == '__main__':
    def timeout(*_):
        raise ValueError('closed')
    signal.signal(signal.SIGALRM, timeout)
    try:
        mode, raw, *extra = sys.argv[1:]
        signal.setitimer(signal.ITIMER_REAL, 90 if mode == 'acquire' else 45)
        root = Path(raw)
        if mode == 'acquire' and not extra:
            acquire(root)
        elif mode == 'prepare' and len(extra) == 1:
            prepare(root, Path(extra[0]))
        elif mode == 'refresh' and not extra:
            refresh(root)
        else:
            raise ValueError('closed')
    except Exception:
        # Never let an exception include signed download URLs or private paths.
        raise SystemExit(1)
