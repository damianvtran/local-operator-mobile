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

/** Run the ACTUAL shell completion guard with a fixture adb, not an emulator.
 * The fake deliberately models am's default stream decoding: without -r it
 * hides INSTRUMENTATION_CODE. This keeps the original failure discriminating. */
const root = mkdtempSync(
	join(
		process.env.LOCAL_OPERATOR_SCRATCHPAD ??
			process.env.RUNNER_TEMP ??
			tmpdir(),
		"sound-raw-fixture-",
	),
);
afterAll(() => rmSync(root, { recursive: true, force: true }));
const script = fileURLToPath(
	new URL("./notification-sound-android-tests.sh", import.meta.url),
);
const rawSuccess =
	"INSTRUMENTATION_STATUS_CODE: 0\nINSTRUMENTATION_RESULT: stream=7/7 notification sound native checks passed\nINSTRUMENTATION_CODE: -1\n";
const fake = `#!/bin/sh
case "$*" in
  get-state) echo device ;;
  "shell getprop sys.boot_completed") echo 1 ;;
  "shell pm path android") echo package:/system/framework/framework-res.apk ;;
  install*|uninstall*) echo Success ;;
  "shell am instrument -w -r "*) cat "$FAKE_RAW"; exit "$FAKE_EXIT" ;;
  "shell am instrument -w "*) echo '7/7 notification sound native checks passed'; exit 0 ;;
  *) echo "unexpected fixture adb command: $*" >&2; exit 42 ;;
esac
`;
let sequence = 0;
function execute(raw = rawSuccess, status = 0, oldControl = false) {
	const dir = join(root, String(sequence++));
	mkdirSync(join(dir, "sound-apk"), { recursive: true });
	const adb = join(dir, "adb");
	writeFileSync(adb, fake);
	chmodSync(adb, 0o700);
	writeFileSync(join(dir, "sound-apk/test.apk"), "");
	writeFileSync(join(dir, "raw.log"), raw);
	let target = script;
	if (oldControl) {
		target = join(dir, "old-control.sh");
		writeFileSync(
			target,
			readFileSync(script, "utf8").replace(
				"instrument -w -r ",
				"instrument -w ",
			),
		);
	}
	return spawnSync("bash", [target], {
		encoding: "utf8",
		timeout: 8000,
		env: {
			...process.env,
			PATH: `${dir}:${process.env.PATH}`,
			RUNNER_TEMP: dir,
			FAKE_RAW: join(dir, "raw.log"),
			FAKE_EXIT: String(status),
			EMULATOR_STABLE_PROBES: "1",
			EMULATOR_PROBE_INTERVAL_S: "0",
			EMULATOR_READY_TIMEOUT_S: "3",
		},
	});
}

describe("raw instrumentation completion contract", () => {
	it("accepts complete raw 7/7 success with final -1", () => {
		const r = execute();
		expect(r.status, r.stderr).toBe(0);
	});
	it("accepts Android CRLF raw framing", () => {
		const r = execute(rawSuccess.replaceAll("\n", "\r\n"));
		expect(r.status, r.stderr).toBe(0);
	});
	it("old no-raw control fails despite pretty stream 7/7", () => {
		expect(execute(rawSuccess, 0, true).status).not.toBe(0);
	});
	it.each([
		["failed case", `INSTRUMENTATION_STATUS_CODE: -2\n${rawSuccess}`],
		[
			"final failure",
			rawSuccess.replace("INSTRUMENTATION_CODE: -1", "INSTRUMENTATION_CODE: 0"),
		],
		["abort", `INSTRUMENTATION_ABORTED: fixture\n${rawSuccess}`],
		["runner failure", `INSTRUMENTATION_FAILED: fixture\n${rawSuccess}`],
		["incomplete", rawSuccess.replace("INSTRUMENTATION_CODE: -1\n", "")],
		["wrong count", rawSuccess.replace("7/7", "6/7")],
		[
			"not exactly -1",
			rawSuccess.replace(
				"INSTRUMENTATION_CODE: -1",
				"INSTRUMENTATION_CODE: -10",
			),
		],
	])("refuses %s even if adb itself exits zero", (_label, raw) => {
		expect(execute(raw).status).not.toBe(0);
	});
	it("propagates transport failure despite apparent raw success", () => {
		expect(execute(rawSuccess, 23).status).not.toBe(0);
	});
});
