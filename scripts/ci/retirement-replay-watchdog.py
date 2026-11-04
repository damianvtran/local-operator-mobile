#!/usr/bin/env python3
"""Independent ALL-work watchdog, including synchronous Node I/O. Only groups
registered by the child through our private inherited pipe are terminated. No
foreign matching, app/SDK discovery, credentials logging, or budget renewal.
"""
import argparse
import json
import math
import os
from pathlib import Path
import select
import signal
import subprocess
import time


POLICY = json.loads(Path(__file__).with_name('retirement-replay-policy.json').read_text())
CAUSES = set(POLICY['failureCauses'])

def export_first_cause(root, evidence):
    cause = None
    source = root / 'seed-first-failure.json'
    if source.exists():
        try:
            value = json.loads(source.read_text())
            supplied = value.get('cause') if isinstance(value, dict) else None
            cause = supplied if isinstance(supplied, str) and supplied in CAUSES else 'other'
        except (ValueError, OSError): cause = 'other'
    if cause is not None:
        try:
            with (evidence / 'first-failure.json').open('x') as stream:
                json.dump({'cause': cause}, stream)
                stream.flush()
                os.fsync(stream.fileno())
        except FileExistsError: pass
    return cause


def cleanup_remaining(root, allowance):
    path = root / 'cleanup-start.json'
    now = time.time() * 1000
    if not path.exists():
        root.mkdir(parents=True, exist_ok=True)
        value = {'at': now, 'end': now + allowance * 1000}
        try:
            with path.open('x') as stream:
                json.dump(value, stream)
                stream.flush()
                os.fsync(stream.fileno())
        except FileExistsError:
            pass
    value = json.loads(path.read_text())
    if not all(type(value.get(key)) in (int, float) and math.isfinite(value[key]) for key in ('at', 'end')) or value['at'] > now or abs(value['end'] - value['at'] - allowance * 1000) > 0.01:
        raise ValueError('Cleanup clock invalid')
    remaining = max(0, min(allowance, (value['end'] - now) / 1000))
    # This host's monotonic clock is shared across worker/fallback processes.
    # Persist a second, nonrenewable bound so a wall-clock rollback cannot extend
    # the total cleanup interval. Never rewrite the original at/end receipt.
    memo = root / 'cleanup-supervisor.json'
    try:
        with memo.open('x') as stream:
            json.dump({'monotonicEnd': time.monotonic() + remaining}, stream)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        pass
    end = json.loads(memo.read_text())['monotonicEnd']
    if type(end) not in (int, float) or not math.isfinite(end): raise ValueError('Cleanup clock invalid')
    return max(0, min(remaining, end - time.monotonic()))


# Simulator boot + readiness run on their OWN clock, outside the 300s work budget.
# The worker announces the window on the private pipe ({"boot": "start"|"end"});
# while it is open the work deadline is frozen and the window itself is capped at
# BOOT_SECONDS. It MIRRORS REPLAY_BOOT_BUDGET_MS (retirement-replay-lifecycle.ts),
# which mirrors the proof harness's BOOT_READY_BUDGET_MS; a test pins them equal.
# Only ONE boot window is accepted per attempt, so it cannot be used to renew time.
BOOT_SECONDS = 300


def attempt(argv, root, work_end, allowance, cleanup_only=False, boot_seconds=BOOT_SECONDS):
    read_fd, write_fd = os.pipe()
    os.set_blocking(read_fd, False)
    environment = os.environ.copy()
    environment['LO_REPLAY_SUPERVISOR_FD'] = str(write_fd)
    child = subprocess.Popen(argv, env=environment, stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True, pass_fds=(write_fd,))
    os.close(write_fd)
    groups = set()
    pending = b''
    stopped = None
    cleanup_end = None
    boot = {'started': None, 'end': None, 'used': False, 'elapsed': 0.0}
    if cleanup_only:
        cleanup_end = time.monotonic() + cleanup_remaining(root, allowance)

    def drain():
        nonlocal pending, work_end
        while True:
            try:
                data = os.read(read_fd, 4096)
            except BlockingIOError:
                break
            if not data:
                break
            pending += data
            if len(pending) > 8192: raise ValueError('Invalid owned registry')
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                value = json.loads(line)
                if set(value) == {'boot'}:
                    now = time.monotonic()
                    if value['boot'] == 'start' and boot['started'] is None and not boot['used'] and not cleanup_only:
                        boot.update(started=now, end=now + boot_seconds, used=True)
                    elif value['boot'] == 'end' and boot['started'] is not None:
                        # Resume the work clock with exactly the time it had left.
                        paused = now - boot['started']
                        work_end += paused
                        boot.update(started=None, end=None, elapsed=boot['elapsed'] + paused)
                    else: raise ValueError('Invalid boot window')
                    continue
                if set(value) not in ({'group'}, {'retired'}): raise ValueError('Invalid owned registry')
                pid = next(iter(value.values()))
                if type(pid) is not int or pid <= 0 or pid in (os.getpid(), os.getpgrp()): raise ValueError('Invalid owned group')
                if 'group' in value: groups.add(pid)
                else: groups.discard(pid)

    def kill(group):
        try: os.killpg(group, signal.SIGKILL)
        except ProcessLookupError: return True
        except PermissionError: return False
        return True

    try:
        while child.poll() is None:
            drain()
            if cleanup_end is None and (root / 'cleanup-start.json').exists():
                cleanup_end = time.monotonic() + cleanup_remaining(root, allowance)
            if cleanup_end is not None:
                end, reason = cleanup_end, 'cleanup-deadline'
            elif boot['started'] is not None:
                end, reason = boot['end'], 'boot-deadline'
            else:
                end, reason = work_end, 'work-deadline'
            if time.monotonic() >= end:
                stopped = reason
                break
            select.select([read_fd], [], [], min(0.1, max(0, end - time.monotonic())))
    except Exception:
        stopped = 'supervisor-refused'
    finally:
        # Kill the worker FIRST, then drain every registration it could have
        # written before death. Gated native children cannot escape that record.
        try: join_end = time.monotonic() + cleanup_remaining(root, allowance)
        except Exception:
            join_end = time.monotonic()
            stopped = stopped or 'supervisor-refused'
        if child.poll() is None and not kill(child.pid): stopped = stopped or 'cleanup-error'
        reaped = True
        try: code = child.wait(timeout=max(0.001, join_end - time.monotonic()))
        except subprocess.TimeoutExpired:
            code, reaped, stopped = 1, False, 'cleanup-deadline'
        try: drain()
        except Exception: stopped = stopped or 'supervisor-refused'
        for group in groups:
            if not kill(group): stopped = stopped or 'cleanup-error'
        outstanding = set(groups)
        while outstanding and time.monotonic() < join_end:
            for group in list(outstanding):
                try: os.killpg(group, 0)
                except ProcessLookupError: outstanding.remove(group)
                except PermissionError: stopped = stopped or 'cleanup-error'
            if outstanding: time.sleep(min(0.02, max(0, join_end - time.monotonic())))
        if outstanding: stopped = stopped or 'cleanup-deadline'
        os.close(read_fd)
    return {'workerExit': code, 'stopReason': stopped, 'ownedGroupsTerminated': len(groups), 'groupsAbsent': not outstanding, 'workerReaped': reaped,
            'bootElapsedMs': round(boot['elapsed'] * 1000)}


def supervise(work_argv, cleanup_argv, root, work_seconds=300, cleanup_seconds=120, cleanup_only=False, boot_seconds=BOOT_SECONDS):
    # Tests may shorten these caps; CLI exposes NO override or retry parameter.
    if work_seconds <= 0 or work_seconds > 300 or cleanup_seconds <= 0 or cleanup_seconds > 120 or boot_seconds <= 0 or boot_seconds > BOOT_SECONDS:
        raise ValueError('Budget refused')
    started = time.monotonic()
    first = attempt(cleanup_argv if cleanup_only else work_argv, root, started + work_seconds,
                    cleanup_seconds, cleanup_only, boot_seconds)
    if (first['stopReason'] or first['workerExit'] != 0) and root.exists():
        try:
            with (root / 'seed-first-failure.json').open('x') as stream:
                cause = {'work-deadline': 'deadline', 'cleanup-deadline': 'deadline', 'boot-deadline': 'boot-timeout'}.get(first['stopReason'], 'other')
                json.dump({'cause': cause}, stream)
        except FileExistsError:
            pass
    # Exactly one fallback consumes only the SAME persisted cleanup allowance.
    fallback = None
    if not cleanup_only:
        remaining = cleanup_remaining(root, cleanup_seconds)
        if remaining > 0:
            fallback = attempt(cleanup_argv, root, time.monotonic(), cleanup_seconds, True)
        else:
            fallback = {'workerExit': 1, 'stopReason': 'cleanup-deadline', 'workerReaped': True}
    result = {'workBudgetSeconds': work_seconds, 'bootBudgetSeconds': boot_seconds, 'totalCleanupBudgetSeconds': cleanup_seconds,
              'first': first, 'fallback': fallback, 'elapsedMs': round((time.monotonic() - started) * 1000)}
    root.mkdir(parents=True, exist_ok=True)
    evidence = root / 'evidence'
    evidence.mkdir(mode=0o700, exist_ok=True)
    # The always() invocation must NEVER replace the killed worker's outcome.
    # Export first cause independently of worker finally (SIGKILL bypasses it).
    result['firstCause'] = export_first_cause(root, evidence)
    candidates = ['watchdog-run.json'] if not cleanup_only else [f'watchdog-cleanup-{n}.json' for n in range(1, 17)]
    for name in candidates:
        try:
            with (evidence / name).open('x') as stream:
                stream.write(json.dumps(result, indent=2) + '\n')
                stream.flush()
                os.fsync(stream.fileno())
            break
        except FileExistsError: continue
    else: raise ValueError('Exclusive watchdog receipt capacity reached')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['run', 'cleanup'], required=True)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.mode == 'run' and root.exists():
        raise SystemExit('Fresh replay root required')
    script = Path(__file__).with_name('retirement-ui-replay.ts')
    result = supervise(['node', str(script), '--run', str(root)],
                       ['node', str(script), '--cleanup', str(root)], root,
                       cleanup_only=args.mode == 'cleanup')
    failed = any(part and (part['workerExit'] != 0 or part['stopReason'])
                 for part in (result['first'], result['fallback']))
    raise SystemExit(1 if failed else 0)
