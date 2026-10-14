#!/bin/sh
#
# Hold the Maestro run back until the emulator's adb transport has been STABLE for a
# while, and (optionally) pay the app's cold-start cost before the first flow.
#
# Usage:  sh scripts/ci/await-emulator-ready.sh [<app-id>]
#
# POSIX `sh` on purpose: reactivecircus/android-emulator-runner runs every `script:`
# line as its own `/usr/bin/sh -c` (dash), and this file is one of those lines.
#
# WHY THIS EXISTS (runner capacity, not an app defect). The nightly's Maestro job
# "flaked once" in both of the last two runs that reached the flows (10/13 nightly
# 38343203340, 10/14 dispatch 38530472075), with the SAME signature: the FIRST flow's
# `launchApp` failed 3-5 s after Maestro started with
#     Command failed (host:transport:emulator-5554): device offline
#     DeviceServerDiedException … StatusRuntimeException: UNAVAILABLE
# while the other eight flows passed — and the invocation then re-ran all nine
# (+7 min) and the run still went green, so the flake read as a pass. The emulator is
# a software-GL x86_64 AVD on a shared runner (the existing KVM preflight passed): `adb: device offline` is
# logged up to 7 times during the observed boot waits, and `sys.boot_completed=1` (the only
# condition the emulator-runner action waits for) is reached while the guest is still
# doing post-boot work; we hypothesise its adbd can still drop the transport. A single successful probe is
# therefore not evidence the device will stay reachable, so this requires
# EMULATOR_STABLE_PROBES (default 5) consecutive good probes, EMULATOR_PROBE_INTERVAL_S
# (default 2) apart — an eight-second window — and any bad probe resets the count.
#
# THE WAIT IS A CEILING, NOT A DELAY: it returns after the stable window on a healthy
# device. It is bounded (EMULATOR_READY_TIMEOUT_S, default 180) and FAILS LOUDLY with
# the last probe's reason, so a device that really never stabilises is a named red,
# not a retry. This is deliberately not a blanket retry or a sleep.
#
# WARM-UP (only when an app id is given). The first flow after boot was also the
# slowest: F-6 took 1m15s on a pass (10/12 22:02) against 42-46 s for the same flow
# later in the set, with the flows' own 15 s element ceilings underneath it. Launching
# the installed app once, to its first resumed frame, moves the one-off dex/JIT and
# first-render cost out of the first flow's budget. The flows still `clearState`, so
# nothing from the warm-up reaches them. A failed warm-up is an optimisation lost,
# not a check failed: it is independently bounded at 30 s (EMULATOR_WARMUP_TIMEOUT_S),
# reported as a ::warning on failure, and the run continues.
#
# Probes use plain `adb`, which honours ANDROID_SERIAL, so a job that pins a serial
# pins this too.

# Python's monotonic clock and process groups make the ceiling cover a blocked
# adb, not just time BETWEEN probes. python3 ships on the hosted Ubuntu runner.
exec python3 "$(dirname "$0")/await-emulator-ready.py" "$@"
