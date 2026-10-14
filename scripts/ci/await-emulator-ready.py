#!/usr/bin/env python3
"""Supervise adb against absolute monotonic deadlines, including its descendants.

A loop-level elapsed check cannot bound a wedged adb, and checking only on failed
probes admits a final success AFTER the ceiling. Readiness and optional warm-up
have separate budgets: readiness failure is red; warm-up failure only warns.
"""
import math
import os
import signal
import subprocess
import sys
import time


def setting(name, default, positive=False):
    value = float(os.environ.get(name, default))
    if not math.isfinite(value) or value < 0 or (positive and value <= 0):
        raise ValueError(f"{name} must be {'positive' if positive else 'non-negative'} and finite")
    return value


def adb(deadline, *args):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("deadline exhausted before adb " + " ".join(args))
    # A timed-out shell/test double may have children holding its output pipe.
    # Own a process group and reap it on EVERY exit, not just TimeoutExpired.
    child = subprocess.Popen(
        ["adb", *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, start_new_session=True,
    )
    try:
        try:
            output, _ = child.communicate(timeout=remaining)
        except subprocess.TimeoutExpired:
            raise TimeoutError("adb " + " ".join(args) + " exceeded deadline") from None
        if time.monotonic() >= deadline:
            raise TimeoutError("adb " + " ".join(args) + " finished after deadline")
        if child.returncode:
            raise RuntimeError(f"adb {' '.join(args)}: {output.strip()}")
        return output.replace("\r", "").strip()
    finally:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.communicate()


def main():
    try:
        stable = setting("EMULATOR_STABLE_PROBES", "5", positive=True)
        if not stable.is_integer():
            raise ValueError("EMULATOR_STABLE_PROBES must be an integer")
        stable = int(stable)
        interval = setting("EMULATOR_PROBE_INTERVAL_S", "2")
        timeout = setting("EMULATOR_READY_TIMEOUT_S", "180")
        warm_timeout = setting("EMULATOR_WARMUP_TIMEOUT_S", "30")
    except ValueError as exc:
        print(f"::error title=Invalid emulator gate configuration::{exc}")
        return 2
    start = time.monotonic()
    deadline = start + timeout
    good = resets = 0
    reason = "deadline exhausted"
    while good < stable and time.monotonic() < deadline:
        try:
            state = adb(deadline, "get-state")
            if state != "device":
                raise RuntimeError(f"adb get-state: {state or '<no output>'}")
            boot = adb(deadline, "shell", "getprop", "sys.boot_completed")
            if boot != "1":
                raise RuntimeError(f"sys.boot_completed: {boot or '<no output>'}")
            package = adb(deadline, "shell", "pm", "path", "android")
            if not package.startswith("package:"):
                raise RuntimeError(f"pm path android: {package or '<no output>'}")
            good += 1
        except (RuntimeError, TimeoutError) as exc:
            reason = str(exc)
            resets += int(good > 0)
            good = 0
            print(f"emulator not stable yet ({reason})", flush=True)
        # The final successful probe is subject to the SAME ceiling.
        if time.monotonic() >= deadline:
            break
        if good < stable:
            time.sleep(min(interval, max(0, deadline - time.monotonic())))
    if good < stable or time.monotonic() >= deadline:
        print(f"::error title=Emulator never held a stable adb transport::{stable} consecutive good probes were not reached in {timeout:g}s; last failure: {reason}")
        return 1
    print(f"emulator stable: {stable} consecutive probes {interval:g}s apart after {time.monotonic() - start:.1f}s ({resets} reset(s) on the way)", flush=True)
    if len(sys.argv) > 1 and sys.argv[1]:
        app = sys.argv[1]
        warm_deadline = time.monotonic() + warm_timeout
        try:
            component = adb(warm_deadline, "shell", "cmd", "package", "resolve-activity", "--brief", app).splitlines()[-1]
            if not component.startswith(app + "/"):
                raise RuntimeError(f"no launcher activity resolved for {app}")
            result = adb(warm_deadline, "shell", "am", "start", "-W", "-n", component)
            if "Status: ok" not in result:
                raise RuntimeError("am start -W did not report Status: ok")
            adb(warm_deadline, "shell", "am", "force-stop", app)
            print(f"warm-up: {app} reached its first frame")
        except (RuntimeError, TimeoutError, IndexError) as exc:
            print(f"::warning title=Emulator warm-up skipped::{exc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
