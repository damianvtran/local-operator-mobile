import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `await-emulator-ready.sh` is the gate in front of the nightly's Maestro run, and
 * what it must get right is a SEQUENCE: a transport that drops mid-window resets
 * the count, a device that never stabilises fails loudly instead of passing or
 * retrying, and the warm-up never fails the run. A fake `adb` on PATH replays a
 * scripted sequence of `adb get-state` answers, so each of those is driven
 * deterministically — no emulator, no wall-clock (the probe interval is 0), and no
 * port or shared path: every case gets its own directory under a pid-stamped root.
 */

const SCRIPT = fileURLToPath(
	new URL("./await-emulator-ready.sh", import.meta.url),
);
const ROOT = mkdtempSync(join(tmpdir(), `await-emulator-${process.pid}-`));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

/**
 * The fake. `get-state` answers the next word of `$FAKE_STATES` (the last word
 * repeats), and every invocation is appended to `calls.log` so a test can assert
 * what was — and was not — run. `FAKE_AM_STATUS` is what `am start -W` prints.
 */
const FAKE_ADB = `#!/bin/sh
echo "$*" >> "$FAKE_DIR/calls.log"
case "$1" in
get-state)
	n=$(cat "$FAKE_DIR/n" 2>/dev/null || echo 0)
	set -- $FAKE_STATES
	i=0; pick=""
	for s in "$@"; do pick=$s; [ "$i" -ge "$n" ] && break; i=$((i + 1)); done
	echo $((n + 1)) > "$FAKE_DIR/n"
	echo "$pick"
	;;
shell)
	shift
	case "$1 $2" in
	"getprop sys.boot_completed") echo "\${FAKE_BOOT-1}" ;;
	"pm path") sleep "\${FAKE_PM_DELAY:-0}" & child=$!; echo "$child" > "$FAKE_DIR/sleeper.pid"; wait "$child"; echo "\${FAKE_PM-package:/system/framework/framework-res.apk}" ;;
	"cmd package") echo "priority=0 preferredOrder=0"; echo "com.example.app/.MainActivity" ;;
	"am start") sleep "\${FAKE_WARM_DELAY:-0}"; echo "\${FAKE_AM_STATUS-Status: ok}" ;;
	"am force-stop") ;;
	esac
	;;
esac
`;

let counter = 0;
const run = (
	states: string,
	env: Record<string, string> = {},
	args: string[] = [],
) => {
	const dir = join(ROOT, `case-${counter++}`);
	const bin = join(dir, "bin");
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(bin, "adb"), FAKE_ADB);
	chmodSync(join(bin, "adb"), 0o755);
	const started = Date.now();
	const result = spawnSync("sh", [SCRIPT, ...args], {
		timeout: 10_000,
		encoding: "utf8",
		env: {
			// A bare environment on purpose (nothing of the developer's or the runner's
			// leaks in); NODE_ENV is only here because `ProcessEnv` requires the key.
			NODE_ENV: "test",
			PATH: `${bin}:/usr/bin:/bin`,
			FAKE_DIR: dir,
			FAKE_STATES: states,
			EMULATOR_PROBE_INTERVAL_S: "0",
			...env,
		},
	});
	let calls = "";
	try {
		calls = readFileSync(join(dir, "calls.log"), "utf8");
	} catch {
		/* no adb call was made */
	}
	return {
		elapsed: Date.now() - started,
		code: result.status,
		out: `${result.stdout}${result.stderr}`,
		calls,
		sleeper: (() => {
			try {
				return Number(readFileSync(join(dir, "sleeper.pid"), "utf8"));
			} catch {
				return 0;
			}
		})(),
		stateProbes: calls.split("\n").filter((l) => l === "get-state").length,
	};
};

describe("await-emulator-ready.sh", () => {
	it("rejects even a final successful command returned after the absolute deadline", () => {
		// Deterministic boundary control: communicate returns success but the clock
		// has crossed the deadline. No wall-clock race and no real adb involved.
		const code = `
import importlib.util
from unittest.mock import patch, MagicMock
spec = importlib.util.spec_from_file_location("gate", ${JSON.stringify(SCRIPT.replace(/\.sh$/, ".py"))})
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
child = MagicMock(pid=12345, returncode=0)
child.communicate.return_value = ("package:/android", None)
with patch.object(gate.subprocess, "Popen", return_value=child), patch.object(gate.os, "killpg") as reap, patch.object(gate.time, "monotonic", side_effect=[0, 2]):
    try:
        gate.adb(1, "shell", "pm", "path", "android")
    except TimeoutError as error:
        assert "finished after deadline" in str(error)
        reap.assert_called_once()
        print("late final success rejected and process group reaped")
    else:
        raise AssertionError("late success was admitted")
`;
		const result = spawnSync("python3", ["-c", code], { encoding: "utf8" });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain("late final success rejected");
	});

	it("rejects a stuck or late final successful pm probe and reaps its child", () => {
		const r = run("device", {
			EMULATOR_STABLE_PROBES: "1",
			EMULATOR_READY_TIMEOUT_S: "0.5",
			FAKE_PM_DELAY: "30",
		});
		expect(r.code).toBe(1);
		expect(r.out).toContain("exceeded deadline");
		expect(r.out).not.toContain("emulator stable:");
		expect(r.sleeper).toBeGreaterThan(0);
		expect(() => process.kill(r.sleeper, 0)).toThrow();
		expect(r.elapsed).toBeLessThan(4000);
	});
	it("bounds stuck warm-up independently and continues with a warning", () => {
		const r = run(
			"device",
			{
				EMULATOR_STABLE_PROBES: "1",
				EMULATOR_WARMUP_TIMEOUT_S: "0.5",
				FAKE_WARM_DELAY: "30",
			},
			["com.example.app"],
		);
		expect(r.code).toBe(0);
		expect(r.out).toContain("::warning title=Emulator warm-up skipped::");
		expect(r.elapsed).toBeLessThan(4000);
	});
	it("rejects invalid or zero stability configuration rather than failing open", () => {
		for (const value of ["abc", "0", "-1", "1.5"]) {
			const r = run("device", { EMULATOR_STABLE_PROBES: value });
			expect(r.code).toBe(2);
			expect(r.out).not.toContain("emulator stable:");
		}
	});

	it("returns after exactly the stable window on a healthy device", () => {
		const r = run("device", { EMULATOR_STABLE_PROBES: "3" });
		expect(r.code).toBe(0);
		expect(r.stateProbes).toBe(3);
		expect(r.out).toContain("emulator stable: 3 consecutive probes");
		expect(r.out).toContain("0 reset(s)");
	});

	it("restarts the window when the transport drops mid-way (the nightly's shape)", () => {
		// good, good, OFFLINE, then healthy: 2 + 1 bad + a full window of 3.
		const r = run("device device offline device", {
			EMULATOR_STABLE_PROBES: "3",
		});
		expect(r.code).toBe(0);
		expect(r.stateProbes).toBe(6);
		expect(r.out).toContain("emulator not stable yet (adb get-state: offline)");
		expect(r.out).toContain("1 reset(s)");
	});

	it("treats an unbooted guest or an unanswering package manager as not ready", () => {
		const unbooted = run("device", {
			EMULATOR_STABLE_PROBES: "2",
			EMULATOR_READY_TIMEOUT_S: "0.5",
			FAKE_BOOT: "",
		});
		expect(unbooted.code).toBe(1);
		expect(unbooted.out).toContain("sys.boot_completed");

		const noPm = run("device", {
			EMULATOR_STABLE_PROBES: "2",
			EMULATOR_READY_TIMEOUT_S: "0.5",
			FAKE_PM: "cmd: Can't find service: package",
		});
		expect(noPm.code).toBe(1);
		expect(noPm.out).toContain("pm path android");
	});

	it("fails LOUDLY when the device never stabilises — it is not a retry and not a pass", () => {
		const r = run("offline", {
			EMULATOR_STABLE_PROBES: "3",
			EMULATOR_READY_TIMEOUT_S: "0.5",
		});
		expect(r.code).toBe(1);
		expect(r.out).toContain(
			"::error title=Emulator never held a stable adb transport::",
		);
		expect(r.out).toContain("last failure:");
	});

	it("warms the app once and leaves it stopped when an app id is given", () => {
		const r = run("device", { EMULATOR_STABLE_PROBES: "1" }, [
			"com.example.app",
		]);
		expect(r.code).toBe(0);
		expect(r.out).toContain("warm-up: com.example.app reached its first frame");
		expect(r.calls).toContain("shell am force-stop com.example.app");
	});

	it("never fails the run over a warm-up it could not do", () => {
		const r = run(
			"device",
			{ EMULATOR_STABLE_PROBES: "1", FAKE_AM_STATUS: "Error: Activity class" },
			["com.example.app"],
		);
		expect(r.code).toBe(0);
		expect(r.out).toContain("::warning title=Emulator warm-up skipped::");
	});

	it("does not touch the app at all without an app id", () => {
		const r = run("device", { EMULATOR_STABLE_PROBES: "1" });
		expect(r.calls).not.toContain("am start");
		expect(r.calls).not.toContain("resolve-activity");
	});
});
