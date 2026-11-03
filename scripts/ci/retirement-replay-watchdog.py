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


def attempt(argv, root, work_end, allowance, cleanup_only=False):
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
    if cleanup_only:
        cleanup_end = time.monotonic() + cleanup_remaining(root, allowance)

    def drain():
        nonlocal pending
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
            end = cleanup_end if cleanup_end is not None else work_end
            if time.monotonic() >= end:
                stopped = 'cleanup-deadline' if cleanup_end is not None else 'work-deadline'
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
    return {'workerExit': code, 'stopReason': stopped, 'ownedGroupsTerminated': len(groups), 'groupsAbsent': not outstanding, 'workerReaped': reaped}


def supervise(work_argv, cleanup_argv, root, work_seconds=300, cleanup_seconds=120, cleanup_only=False):
    # Tests may shorten these caps; CLI exposes NO override or retry parameter.
    if work_seconds <= 0 or work_seconds > 300 or cleanup_seconds <= 0 or cleanup_seconds > 120:
        raise ValueError('Budget refused')
    started = time.monotonic()
    first = attempt(cleanup_argv if cleanup_only else work_argv, root, started + work_seconds,
                    cleanup_seconds, cleanup_only)
    if first['stopReason'] and root.exists():
        try:
            with (root / 'seed-first-failure.json').open('x') as stream:
                json.dump({'cause': 'deadline'}, stream)
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
    result = {'workBudgetSeconds': work_seconds, 'totalCleanupBudgetSeconds': cleanup_seconds,
              'first': first, 'fallback': fallback, 'elapsedMs': round((time.monotonic() - started) * 1000)}
    root.mkdir(parents=True, exist_ok=True)
    evidence = root / 'evidence'
    evidence.mkdir(mode=0o700, exist_ok=True)
    (evidence / 'watchdog.json').write_text(json.dumps(result, indent=2) + '\n')
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
