/**
 * The two environment decisions, tested where `vitest` can reach them (`scripts/**`).
 *
 * They exist because CI's first run of these self-checks reported five failures, three of
 * which were a check needing something the job did not have and reporting a DATA failure
 * for it. One of those could only ever fail — comparing emitted names against an empty
 * expectation list — so the reading order and the skip decision are both pinned here.
 */
import { describe, expect, it } from "vitest";
import {
	captureChecksRunnable,
	captureDiagnostic,
	captureSkipDecision,
	NEEDS_BROWSER,
	NEEDS_HOOK_PARSE,
	NEEDS_NAME_CONTRACT,
	nameContractUsable,
	readFirstAvailable,
} from "../tools/lib/ci-environment.ts";

describe("the name contract's source is read from the first available candidate", () => {
	it("prefers the working tree — the only candidate a depth-1 CI checkout has", () => {
		const resolved = readFirstAvailable([
			{ label: "working tree", read: () => "tree source" },
			{ label: "ref", read: () => "ref source" },
		]);
		expect(resolved.source).toBe("tree source");
		expect(resolved.from).toBe("working tree");
	});

	it("falls back to the branch ref and NAMES it, so the choice is visible", () => {
		const resolved = readFirstAvailable([
			{ label: "working tree", read: () => "" },
			{ label: "ref", read: () => "ref source" },
		]);
		expect(resolved.source).toBe("ref source");
		expect(resolved.from).toBe("ref");
	});

	it("returns an empty source AND the candidates it tried when nothing is readable", () => {
		const resolved = readFirstAvailable([
			{ label: "working tree", read: () => "" },
			{
				label: "ref",
				read: () => {
					throw new Error("no such ref");
				},
			},
		]);
		expect(resolved.source).toBe("");
		expect(resolved.tried).toEqual(["working tree", "ref"]);
	});

	it("treats a throwing candidate as unreadable rather than propagating it", () => {
		expect(() =>
			readFirstAvailable([
				{
					label: "boom",
					read: () => {
						throw new Error("x");
					},
				},
			]),
		).not.toThrow();
	});
});

describe("a capture failure says what the capture said", () => {
	it("surfaces the child's stderr instead of naming only the symptom", () => {
		const diagnostic = captureDiagnostic({
			status: 1,
			stdout: "",
			stderr: "Error: no display available for headless Chrome",
		});
		expect(diagnostic).toContain("exit 1");
		expect(diagnostic).toContain("no display available");
	});

	it("says so when the capture printed nothing at all", () => {
		expect(
			captureDiagnostic({
				status: null,
				signal: "SIGTERM",
				stdout: null,
				stderr: "",
			}),
		).toContain("killed by SIGTERM");
		expect(captureDiagnostic({ status: 1 })).toContain(
			"printed nothing at all",
		);
	});

	it("reports a spawn-level failure as the capture not starting, not as it printing nothing", () => {
		// `spawnSync`'s own `error` (E2BIG, ENOMEM, EACCES) is not the child's words. Read as
		// "exit null; the capture printed nothing at all" it names a cause the child never had.
		const diagnostic = captureDiagnostic({
			status: null,
			error: new Error("spawnSync node E2BIG"),
		});
		expect(diagnostic).toContain("could not be started");
		expect(diagnostic).toContain("E2BIG");
		expect(diagnostic).not.toContain("printed nothing at all");
	});
});

describe("the skip decision needs two facts, not a phrase from the output", () => {
	// The diagnostic these inputs are shaped as: what `captureDiagnostic` returns for a
	// capture that printed no manifest path.
	const diagnostic = (said: string): string =>
		`the capture produced no manifest path: exit 1; the capture said: ${said}`;

	it("skips only when the resolver found no browser AND the capture says so", () => {
		const decision = captureSkipDecision({
			chromeResolved: false,
			diagnostic: diagnostic(
				"Error: No Chrome found (a macOS app bundle, a Linux launcher, or CHROME_BIN).",
			),
		});
		expect(decision.skip).toBe(true);
		expect(decision.reason).toContain(NEEDS_BROWSER);
		// The capture's own words ride along, so the skip names what the capture saw.
		expect(decision.reason).toContain("No Chrome found");
	});

	it("FAILS a missing fixture instead of absorbing it as a skip (F9)", () => {
		// The classifier this replaced matched a bare `ENOENT` anywhere in the output, so a
		// missing repository file became an environment limit: a named skip, exit 0, and the
		// capture group's coverage silently gone.
		const decision = captureSkipDecision({
			chromeResolved: false,
			diagnostic: diagnostic(
				"Error: ENOENT: no such file or directory, open '…/e2e/fixtures/audit-canary/clean/clean.html'",
			),
		});
		expect(decision.skip).toBe(false);
		expect(decision.reason).toContain("ENOENT");
	});

	it("FAILS a launch failure on a host that has a browser, carrying the cause (F10)", () => {
		// `tools/lib/chrome.ts:203`'s own wording for a browser that will not come up. With
		// Chrome present the job fails and names that line, rather than being reclassified.
		const decision = captureSkipDecision({
			chromeResolved: true,
			diagnostic: diagnostic(
				"Error: Chrome never wrote DevToolsActivePort (30 s). stderr: zygote_host_impl_linux.cc(90)] Running as root without --no-sandbox is not supported.",
			),
		});
		expect(decision.skip).toBe(false);
		expect(decision.reason).toContain("DevToolsActivePort");
	});
});

describe("the name contract's decision is a value, not inline code (F15)", () => {
	it("separates an unreadable file from a readable file that parses to no names", () => {
		expect(nameContractUsable("", [])).toEqual({
			usable: false,
			reason: NEEDS_NAME_CONTRACT,
		});
		expect(nameContractUsable("const webRelayOverride = 1;", [])).toEqual({
			usable: false,
			reason: NEEDS_HOOK_PARSE,
		});
		expect(
			nameContractUsable("export function webRelayOverride() {}", ["lo-relay"]),
		).toEqual({ usable: true, reason: "" });
	});
});

describe("capture-dependent checks run only where there is a browser", () => {
	it("is runnable with Chrome and names what is missing without it", () => {
		expect(
			captureChecksRunnable({ path: "/Applications/Google Chrome.app/…" }),
		).toEqual({
			runnable: true,
			reason: "",
		});
		const without = captureChecksRunnable(null);
		expect(without.runnable).toBe(false);
		expect(without.reason).toBe(NEEDS_BROWSER);
		expect(without.reason).toContain("frames/audit job");
	});
});
