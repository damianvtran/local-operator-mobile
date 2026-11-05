import assert from "node:assert/strict";

export function directXCTestPlan(project: string, udid: string, root: string) {
	const shared = [
		"-project",
		project,
		"-scheme",
		"TransportCarrier",
		"-configuration",
		"Debug",
		"-destination",
		`platform=iOS Simulator,id=${udid}`,
		"-sdk",
		"iphonesimulator",
		"-jobs",
		"1",
		"-derivedDataPath",
		`${root}/DerivedData`,
		"CODE_SIGNING_ALLOWED=YES",
		"CODE_SIGN_IDENTITY=-",
		"CODE_SIGN_STYLE=Manual",
		"DEVELOPMENT_TEAM=",
	];
	return {
		build: [...shared, "build-for-testing"],
		test: [
			...shared,
			"-resultBundlePath",
			`${root}/transport.xcresult`,
			"-parallel-testing-enabled",
			"NO",
			"-maximum-concurrent-test-simulator-destinations",
			"1",
			"-only-testing:TransportUITests/TransportUITests/testPairedTransport",
			"test-without-building",
		],
	};
}
export type DirectEvent = {
	event: string;
	authority?: string;
	verdict?: string;
	matching401?: boolean;
	elapsedMs?: number;
	runnerPID?: number;
};
const EVENTS = new Set([
	"method-entered",
	"welcome-ready",
	"authority",
	"ui-verdict",
	"listener-closed",
	"negative",
]);
const AUTHORITIES = new Set(["loopback-ipv4", "published-local"]);
const VERDICTS = new Set([
	"password-refused",
	"timeout",
	"unreachable",
	"host",
	"tls",
	"other",
]);
export function parseDirectEvents(text: string): DirectEvent[] {
	const result: DirectEvent[] = [];
	for (const line of text.split("\n")) {
		const i = line.indexOf("XCT_TRANSPORT ");
		if (i < 0) continue;
		try {
			const row = JSON.parse(line.slice(i + 14));
			if (!EVENTS.has(row.event)) continue;
			const safe: DirectEvent = { event: row.event };
			if (AUTHORITIES.has(row.authority)) safe.authority = row.authority;
			if (VERDICTS.has(row.verdict)) safe.verdict = row.verdict;
			if (typeof row.matching401 === "boolean")
				safe.matching401 = row.matching401;
			if (
				Number.isInteger(row.elapsedMs) &&
				row.elapsedMs >= 0 &&
				row.elapsedMs <= 900000
			)
				safe.elapsedMs = row.elapsedMs;
			if (Number.isInteger(row.runnerPID) && row.runnerPID > 0)
				safe.runnerPID = row.runnerPID;
			result.push(safe);
		} catch {
			/* Never persist arbitrary native/error text as event fields. */
		}
	}
	return result;
}
export function assertDirectXCTestResult(events: readonly DirectEvent[]) {
	assert(
		events.filter((e) => e.event === "method-entered").length === 1,
		"missing/duplicate selected test-method entry; zero-tests is not readiness",
	);
	assert(
		events.some(
			(e) =>
				e.event === "method-entered" &&
				typeof e.runnerPID === "number" &&
				e.runnerPID > 0,
		),
		"missing actual selected runner PID",
	);
	assert(
		events.some((e) => e.event === "welcome-ready"),
		"missing actual Welcome marker/attachment readiness",
	);
	const rows = events.filter((e) => e.event === "authority");
	assert.deepEqual(
		rows.map((e) => e.authority),
		["loopback-ipv4", "published-local"],
		"paired real-app authority observations required",
	);
	const successful = rows.filter(
		(e) => e.verdict === "password-refused" && e.matching401,
	);
	assert(
		successful.length > 0,
		"neither authority proved actual native GET401; stop",
	);
	assert(
		events.some((e) => e.event === "listener-closed"),
		"same listener was not closed",
	);
	const negative = events.find((e) => e.event === "negative");
	assert(
		negative &&
			successful.some((e) => e.authority === negative.authority) &&
			negative.verdict === "unreachable" &&
			negative.matching401 === false,
		"missing actual unreachable/no-new401 negative on the successful same authority",
	);
}
