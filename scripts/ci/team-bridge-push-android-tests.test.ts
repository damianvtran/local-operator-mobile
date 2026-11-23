import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/** #304 review R7-1: run the ACTUAL Team Bridge push completion guard against a
 * fixture adb. The guard used to grep a literal "15/15", which went stale when
 * a 16th native case landed and failed a fully green run; it now derives the
 * count from the runner's "$passed/$total" summary, with a floor of 16 so a
 * case silently dropped from the runner's list still fails. Same fixture
 * shape as notification-sound-android-tests.test.ts; the readiness budget is
 * wider than that file's because a loaded host can miss a 3 s probe deadline. */
const root = mkdtempSync(
	join(
		process.env.LOCAL_OPERATOR_SCRATCHPAD ??
			process.env.RUNNER_TEMP ??
			tmpdir(),
		"bridge-push-raw-fixture-",
	),
);
afterAll(() => rmSync(root, { recursive: true, force: true }));
const script = fileURLToPath(
	new URL("./team-bridge-push-android-tests.sh", import.meta.url),
);
const raw = (summary: string) =>
	`INSTRUMENTATION_STATUS_CODE: 0\nINSTRUMENTATION_RESULT: stream=${summary} team bridge push native checks passed\nINSTRUMENTATION_CODE: -1\n`;
const fake = `#!/bin/sh
case "$*" in
  get-state) echo device ;;
  "shell getprop sys.boot_completed") echo 1 ;;
  "shell pm path android") echo package:/system/framework/framework-res.apk ;;
  install*|uninstall*) echo Success ;;
  "shell am instrument -w -r "*) cat "$FAKE_RAW"; exit 0 ;;
  *) echo "unexpected fixture adb command: $*" >&2; exit 42 ;;
esac
`;
let sequence = 0;
function execute(log: string) {
	const dir = join(root, String(sequence++));
	mkdirSync(join(dir, "team-bridge-apk"), { recursive: true });
	const adb = join(dir, "adb");
	writeFileSync(adb, fake);
	chmodSync(adb, 0o700);
	writeFileSync(join(dir, "team-bridge-apk/test.apk"), "");
	writeFileSync(join(dir, "raw.log"), log);
	return spawnSync("bash", [script], {
		encoding: "utf8",
		timeout: 40000,
		env: {
			...process.env,
			PATH: `${dir}:${process.env.PATH}`,
			RUNNER_TEMP: dir,
			FAKE_RAW: join(dir, "raw.log"),
			EMULATOR_STABLE_PROBES: "1",
			EMULATOR_PROBE_INTERVAL_S: "0",
			EMULATOR_READY_TIMEOUT_S: "30",
		},
	});
}

describe("Team Bridge push native completion count", () => {
	it.each(["16/16", "17/17"])("accepts an all-passed %s run", (summary) => {
		const r = execute(raw(summary));
		expect(r.status, r.stderr).toBe(0);
	});
	it("accepts Android CRLF raw framing", () => {
		const r = execute(raw("16/16").replaceAll("\n", "\r\n"));
		expect(r.status, r.stderr).toBe(0);
	});
	it.each([
		["a failed case", raw("15/16")],
		["a case dropped from the runner (below the floor)", raw("15/15")],
		[
			"no summary at all",
			"INSTRUMENTATION_STATUS_CODE: 0\nINSTRUMENTATION_CODE: -1\n",
		],
		["two summaries", raw("16/16") + raw("16/16")],
	])("refuses %s", (_label, log) => {
		expect(execute(log).status).not.toBe(0);
	});
});
