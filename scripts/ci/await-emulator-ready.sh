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
# a software-GL x86_64 AVD on a KVM-less-or-shared runner: `adb: device offline` is
# logged 6-7 times during EVERY boot wait, and `sys.boot_completed=1` (the only
# condition the emulator-runner action waits for) is reached while the guest is still
# dexopt-ing and its adbd can still drop the transport. A single successful probe is
# therefore not evidence the device will stay reachable, so this requires
# EMULATOR_STABLE_PROBES (default 5) consecutive good probes, EMULATOR_PROBE_INTERVAL_S
# (default 2) apart — ten quiet seconds — and any bad probe resets the count.
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
# not a check failed: it is reported as a ::warning and the run continues.
#
# Probes use plain `adb`, which honours ANDROID_SERIAL, so a job that pins a serial
# pins this too.

STABLE=${EMULATOR_STABLE_PROBES:-5}
INTERVAL=${EMULATOR_PROBE_INTERVAL_S:-2}
TIMEOUT=${EMULATOR_READY_TIMEOUT_S:-180}
APP=${1:-}

reason=""

# One probe = the three things Maestro's driver needs in its first seconds: the adb
# server lists the device as `device` (not offline/unauthorized), the guest finished
# booting, and the package manager answers (the driver's `pm`/instrumentation calls
# fail with "Can't find service: package" until it does).
probe() {
	state=$(adb get-state 2>&1)
	if [ "$state" != "device" ]; then
		reason="adb get-state: ${state:-<no output>}"
		return 1
	fi
	boot=$(adb shell getprop sys.boot_completed 2>&1 | tr -d '\r')
	if [ "$boot" != "1" ]; then
		reason="sys.boot_completed: ${boot:-<no output>}"
		return 1
	fi
	pm=$(adb shell pm path android 2>&1 | tr -d '\r' | head -n 1)
	case "$pm" in
	package:*) return 0 ;;
	*)
		reason="pm path android: ${pm:-<no output>}"
		return 1
		;;
	esac
}

start=$(date +%s)
good=0
resets=0
while [ "$good" -lt "$STABLE" ]; do
	if probe; then
		good=$((good + 1))
	else
		if [ "$good" -gt 0 ]; then resets=$((resets + 1)); fi
		good=0
		echo "emulator not stable yet ($reason)"
	fi
	elapsed=$(($(date +%s) - start))
	if [ "$good" -lt "$STABLE" ] && [ "$elapsed" -ge "$TIMEOUT" ]; then
		echo "::error title=Emulator never held a stable adb transport::${STABLE} consecutive good probes were not reached in ${TIMEOUT}s; last failure: ${reason:-none}"
		exit 1
	fi
	if [ "$good" -lt "$STABLE" ]; then sleep "$INTERVAL"; fi
done
echo "emulator stable: ${STABLE} consecutive probes ${INTERVAL}s apart after $(($(date +%s) - start))s (${resets} reset(s) on the way)"

if [ -n "$APP" ]; then
	component=$(adb shell cmd package resolve-activity --brief "$APP" 2>&1 | tr -d '\r' | tail -n 1)
	case "$component" in
	"$APP"/*)
		launched=$(adb shell am start -W -n "$component" 2>&1 | tr -d '\r')
		case "$launched" in
		*"Status: ok"*) echo "warm-up: $APP reached its first frame" ;;
		*) echo "::warning title=Emulator warm-up skipped::am start -W $component did not report Status: ok" ;;
		esac
		adb shell am force-stop "$APP" >/dev/null 2>&1
		;;
	*)
		echo "::warning title=Emulator warm-up skipped::no launcher activity resolved for $APP ($component)"
		;;
	esac
fi
