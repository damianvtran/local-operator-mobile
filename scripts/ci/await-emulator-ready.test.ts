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
	"pm path") echo "\${FAKE_PM-package:/system/framework/framework-res.apk}" ;;
	"cmd package") echo "priority=0 preferredOrder=0"; echo "com.example.app/.MainActivity" ;;
	"am start") echo "\${FAKE_AM_STATUS-Status: ok}" ;;
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
	const result = spawnSync("sh", [SCRIPT, ...args], {
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
		code: result.status,
		out: `${result.stdout}${result.stderr}`,
		calls,
		stateProbes: calls.split("\n").filter((l) => l === "get-state").length,
	};
};

describe("await-emulator-ready.sh", () => {
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
			EMULATOR_READY_TIMEOUT_S: "0",
			FAKE_BOOT: "",
		});
		expect(unbooted.code).toBe(1);
		expect(unbooted.out).toContain("sys.boot_completed");

		const noPm = run("device", {
			EMULATOR_STABLE_PROBES: "2",
			EMULATOR_READY_TIMEOUT_S: "0",
			FAKE_PM: "cmd: Can't find service: package",
		});
		expect(noPm.code).toBe(1);
		expect(noPm.out).toContain("pm path android");
	});

	it("fails LOUDLY when the device never stabilises — it is not a retry and not a pass", () => {
		const r = run("offline", {
			EMULATOR_STABLE_PROBES: "3",
			EMULATOR_READY_TIMEOUT_S: "0",
		});
		expect(r.code).toBe(1);
		expect(r.out).toContain(
			"::error title=Emulator never held a stable adb transport::",
		);
		expect(r.out).toContain("last failure: adb get-state: offline");
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
