#!/usr/bin/env python3
"""Independent deadline/memory/reap supervisor; emits closed JSON only.

The existing watchdog owns exact registered process groups and durable cleanup,
including crash/uncertain-create recovery. No JS finally is a safety boundary.
CoreSimulator's shared daemons are NOT claimed inside the group memory bound.
"""
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import subprocess
import sys
import time

HERE = Path(__file__).parent
WATCHDOG = runpy.run_path(str(HERE / 'retirement-replay-watchdog.py'))
INPUTS = runpy.run_path(str(HERE / 'retirement-runner-launch-only-inputs.py'))
PROTOCOL = ('readyReceived', 'readyReplySent', 'beforeObserveReceived', 'denialSent', 'protocolFailed')
STAGES = ('acquisition', 'toolchain', 'static-prepare', 'ownership', 'boot', 'bootstatus', 'runner-observation')
OUTCOMES = ('not-launched', 'early-exit', 'expected-test-failure', 'unexpected-zero', 'unrelated-failure', 'forced-stop', 'runner-start-timeout', 'post-denial-timeout', 'protocol-failure')
CLASSES = ('destination_unavailable', 'xctestrun_invalid', 'test_bundle_load_failed', 'test_failed', 'launch_timeout', 'cli_argument_refused', 'unknown', 'prepare_timeout', 'prepare_refused', 'prepare_exit')
TEST = 'RetirementSystemAlert.RetainedReplayTests.testSingleSeedReplay'


def memory_admitted(text, worker, groups):
    rows = []
    for line in text.splitlines():
        fields = line.split()
        if len(fields) != 3 or any(not value.isdigit() for value in fields):
            raise ValueError('closed')
        rows.append(tuple(map(int, fields)))
    controller = [rss for pid, _group, rss in rows if pid == worker]
    if len(controller) != 1:
        # The leader can exit between poll() and ps. Unknown is never an
        # affirmative memory measurement (the watchdog still reaps exactly).
        raise ValueError('closed')
    return controller[0] <= 512 * 1024 and sum(rss for _pid, group, rss in rows if group in groups) <= 2 * 1024 * 1024


# `ps` costs ~117ms measured; sampling it on every watchdog tick would itself
# become the load it is meant to bound, so the sample is throttled.
SAMPLE_INTERVAL = 1.0
_last_sample = 0.0


def sample_memory(worker, groups):
    global _last_sample
    import time as _time
    if _time.monotonic() - _last_sample < SAMPLE_INTERVAL:
        return True
    _last_sample = _time.monotonic()
    value = subprocess.run(['/bin/ps', '-axo', 'pid=,pgid=,rss='], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=1, check=True)
    if len(value.stdout) > 1024 * 1024:
        raise ValueError('closed')
    text = value.stdout.decode('ascii')
    try:
        return memory_admitted(text, worker, groups)
    except ValueError:
        # A normally exited leader can disappear after poll() but before ps.
        # Only proven absence avoids turning that race into a memory failure.
        try: os.kill(worker, 0)
        except ProcessLookupError: return True
        raise


def runner_failure(value):
    if not isinstance(value, dict) or set(value) != {'exitCode', 'command', 'errorClass', 'failingTest', 'failureCount', 'tailSha256'}:
        return None
    if (value['exitCode'] is not None and (type(value['exitCode']) is not int or not -255 <= value['exitCode'] <= 255)
            or value['command'] not in ('launch', 'prepare') or value['errorClass'] not in CLASSES
            or value['failingTest'] not in (None, TEST) or type(value['failureCount']) is not int
            or not 0 <= value['failureCount'] <= 99 or not isinstance(value['tailSha256'], str)
            or not re.fullmatch('[a-f0-9]{64}', value['tailSha256'])):
        return None
    return {key: value[key] for key in ('exitCode', 'command', 'errorClass', 'failingTest', 'failureCount', 'tailSha256')}


def closed_receipt(value):
    if not isinstance(value, dict): value = {}
    result = {'schemaVersion': 1, 'scope': 'runner-launch-only-diagnostic',
              'compiledRunnerSource': INPUTS['SOURCE'],
              # Fixed public identities straight from the pinned constants: a
              # worker-supplied value can never re-label the compiled runner.
              'runnerArtifactID': INPUTS['PROBE']['ARTIFACT'],
              'runnerArtifactExpiresAt': INPUTS['EXPIRY'],
              'controllerSource': value.get('controllerSource') if isinstance(value.get('controllerSource'), str) and re.fullmatch('[a-f0-9]{40}', value['controllerSource']) else None,
              'appBuildAttempted': False, 'mobileAcceptanceComplete': False,
              'processAttestation': False, 'sharedDaemonMemoryBounded': False,
              'workBudgetSeconds': 300, 'bootBudgetSeconds': 300, 'cleanupBudgetSeconds': 120,
              'controllerRSSLimitMiB': 512, 'ownedGroupRSSLimitMiB': 2048,
              'failure': value.get('failure') if value.get('failure') in ('none', 'preflight', 'launch', 'cleanup', 'internal') else 'internal',
              'stopOutcome': value.get('stopOutcome') if value.get('stopOutcome') in OUTCOMES else 'not-launched',
              'runnerFailure': runner_failure(value.get('runnerFailure')), 'stages': []}
    for key in ('sourceMatched', 'versionMatched', 'sdkMatched', 'staticMatched', 'testExecutionAttempted', 'cleanupComplete', 'inventoryAbsent', 'supervisorFailed', 'privateRemoved', 'ownedGroupsAbsent', 'controllerReaped', 'forcedStop'):
        result[key] = value.get(key) is True
    protocol = value.get('protocol') if isinstance(value.get('protocol'), dict) else {}
    result['protocol'] = {key: protocol.get(key) is True for key in PROTOCOL}
    stages = value.get('stages')
    if isinstance(stages, list):
        for stage in stages[:len(STAGES)]:
            if (isinstance(stage, dict) and stage.get('name') in STAGES and type(stage.get('elapsedMs')) is int
                    and 0 <= stage['elapsedMs'] <= 301000 and stage.get('ok') in (True, False)):
                result['stages'].append({'name': stage['name'], 'elapsedMs': stage['elapsedMs'], 'ok': stage['ok'] is True})
    return result


def read_private(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16384:
        return {}
    try: return json.loads(path.read_bytes())
    except Exception: return {}


def public_write(output, value):
    encoded = json.dumps(closed_receipt(value), separators=(',', ':'))
    if len(encoded.encode()) > 16384: raise ValueError('closed')
    with output.open('w') as stream:
        stream.write(encoded + '\n')
        stream.flush()
        os.fsync(stream.fileno())


def run(mode, root, output):
    # No caller-supplied command, native flag, artifact ID or source override.
    if mode not in ('run', 'cleanup'): raise ValueError('closed')
    script = HERE / 'retirement-runner-launch-only.ts'
    command = ['node', str(script)]
    prior = read_private(output)
    if mode == 'cleanup' and not root.exists():
        if not prior: raise ValueError('closed')
        return prior.get('failure') == 'none' and prior.get('cleanupComplete') is True
    root.mkdir(mode=0o700, exist_ok=True)
    result = None
    failed = False
    original_failed = prior.get('failure') not in (None, 'none')
    try:
        remaining = 300
        if mode == 'run':
            clock = INPUTS['PROBE']['bounded_json'](root / 'work-clock.json')
            elapsed = time.monotonic() - clock['monotonicStart']
            if elapsed < 0 or elapsed >= 300 or clock['acquisitionMs'] > 90000:
                raise ValueError('closed')
            remaining -= elapsed
        result = WATCHDOG['supervise'](command + ['--run', str(root)], command + ['--cleanup', str(root)], root,
                                       work_seconds=remaining, cleanup_only=mode == 'cleanup', memory_check=sample_memory)
        failed = any(part and (part['workerExit'] != 0 or part['stopReason'] or not part.get('workerReaped') or not part.get('groupsAbsent')) for part in (result['first'], result['fallback']))
    except Exception:
        failed = True
        # Bad acquisition/clock still gets exact owned cleanup, under the same
        # persisted 120s allowance, not an unsupervised JS finally.
        try:
            result = WATCHDOG['supervise'](command + ['--run', str(root)], command + ['--cleanup', str(root)], root, cleanup_only=True, memory_check=sample_memory)
        except Exception:
            pass
    value = read_private(root / 'launch-receipt.json') or prior
    value = closed_receipt(value)
    cleanup = read_private(root / 'replay-cleanup.json')
    value['cleanupComplete'] = cleanup.get('cleanupComplete') is True
    value['inventoryAbsent'] = cleanup.get('inventoryAbsent') is True
    value['supervisorFailed'] = failed or prior.get('supervisorFailed') is True
    parts = [part for part in ((result or {}).get('first'), (result or {}).get('fallback')) if part]
    value['ownedGroupsAbsent'] = bool(parts) and all(part.get('groupsAbsent') is True for part in parts)
    value['controllerReaped'] = bool(parts) and all(part.get('workerReaped') is True for part in parts)
    value['forcedStop'] = prior.get('forcedStop') is True or value['stopOutcome'] in ('runner-start-timeout', 'post-denial-timeout', 'forced-stop') or any(part.get('stopReason') for part in parts)
    if failed or original_failed and value['failure'] == 'none': value['failure'] = 'internal'
    try:
        # Keep only ownership journals for the always() recovery. Raw runner
        # result attachments, config/secret material and pinned bytes never leave.
        for name in ('download', 'runner', 'private.xcresult'):
            path = root / name
            if path.exists(): shutil.rmtree(path)
        for name in ('launch-environment.json',):
            (root / name).unlink(missing_ok=True)
        value['privateRemoved'] = True
    except Exception:
        value['privateRemoved'] = False
        value['failure'] = 'cleanup'
    value['cleanupComplete'] = value['cleanupComplete'] and value['ownedGroupsAbsent'] and value['controllerReaped']
    if not value['cleanupComplete'] or not value['inventoryAbsent']: value['failure'] = 'cleanup'
    if value['supervisorFailed'] and value['failure'] == 'none': value['failure'] = 'internal'
    public_write(output, value)
    if mode == 'cleanup': shutil.rmtree(root)
    return value['failure'] == 'none'


if __name__ == '__main__':
    try:
        if len(sys.argv) != 4: raise ValueError('closed')
        successful = run(sys.argv[1], Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve())
        raise SystemExit(0 if successful else 1)
    except Exception:
        # No exception strings, traceback, private argv or account material.
        raise SystemExit(1)
