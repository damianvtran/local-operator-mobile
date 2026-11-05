/**
 * The retained ORIGINAL proof app is pinned in THREE places that run in three
 * different languages at three different times:
 *
 * - `retirement-ui-guards.ts` (`RETAINED`): the host's authorization model;
 * - `retirement-ui/ReplayGuards.swift` (`ReplayGuards.source/bundle/tar`): the
 *   XCTest runner's own check, compiled into the runner on the macOS host;
 * - `retirement-replay-products.py` (`preflight`): the compile host's artifact
 *   metadata check (id, run, source) before any SDK work.
 *
 * WHY THIS TEST EXISTS. Re-pinning to a new original is a routine step every
 * time a retained artifact expires, and a PARTIAL re-pin is the failure mode:
 * the sites would each refuse in their own way minutes into a scarce macOS
 * replay window (or worse, one stale site would check an identity nobody holds
 * any more). This test reads the three files as text and fails unless every
 * identity field agrees across every site where it appears, so a partial pin
 * cannot reach CI green. It reads source text deliberately: the Swift file only
 * compiles on the macOS runner, and the Python check is exercised elsewhere.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RETAINED } from "./retirement-ui-guards.ts";

const ci = import.meta.dirname;

/** Every identity value the Swift runner pins, by field. */
export function swiftPins(text: string) {
	const field = (name: string) => {
		const match = text.match(new RegExp(`static let ${name} = "([0-9a-f]+)"`));
		if (!match) throw new Error(`ReplayGuards.swift: no ${name} pin`);
		return match[1];
	};
	return {
		sourceSHA: field("source"),
		bundleSHA256: field("bundle"),
		tarSHA256: field("tar"),
	};
}

/** Every identity value the Python preflight pins: URL id, checked id, run, source, returned id. */
export function pythonPins(text: string) {
	const all = (pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1]);
	const urlIDs = all(/actions\/artifacts\/(\d+)'/g);
	const checkedIDs = all(/value\.get\('id'\) != (\d+)/g);
	const runIDs = all(/get\('id'\) != (\d+) or value\['workflow_run'\]/g);
	const sources = all(/get\('head_sha'\) != '([0-9a-f]{40})'/g);
	const returnedIDs = all(/'artifactID': (\d+), 'expiresAt': expiry/g);
	for (const [name, values] of Object.entries({
		urlIDs,
		checkedIDs,
		runIDs,
		sources,
		returnedIDs,
	}))
		if (values.length !== 1)
			throw new Error(
				`products.py: expected one ${name}, got ${values.length}`,
			);
	return {
		artifactIDs: [...urlIDs, ...checkedIDs, ...returnedIDs].map(Number),
		runID: Number(runIDs[0]),
		sourceSHA: sources[0]!,
	};
}

/** All disagreements between the three sites, as readable strings. */
interface Pins {
	artifactID: number;
	runID: number;
	sourceSHA: string;
	bundleSHA256: string;
	tarSHA256: string;
}
export function pinDisagreements(
	ts: Pins,
	swift: ReturnType<typeof swiftPins>,
	python: ReturnType<typeof pythonPins>,
) {
	const out: string[] = [];
	const same = (field: string, a: unknown, b: unknown, where: string) => {
		if (a !== b) out.push(`${field}: guards.ts ${a} != ${where} ${b}`);
	};
	same("sourceSHA", ts.sourceSHA, swift.sourceSHA, "ReplayGuards.swift");
	same(
		"bundleSHA256",
		ts.bundleSHA256,
		swift.bundleSHA256,
		"ReplayGuards.swift",
	);
	same("tarSHA256", ts.tarSHA256, swift.tarSHA256, "ReplayGuards.swift");
	same("sourceSHA", ts.sourceSHA, python.sourceSHA, "products.py");
	same("runID", ts.runID, python.runID, "products.py");
	for (const id of python.artifactIDs)
		same("artifactID", ts.artifactID, id, "products.py");
	return out;
}

describe("retained original: the three pin sites agree", () => {
	it("guards.ts, ReplayGuards.swift and products.py name ONE identity", () => {
		const swift = swiftPins(
			readFileSync(join(ci, "retirement-ui", "ReplayGuards.swift"), "utf8"),
		);
		const python = pythonPins(
			readFileSync(join(ci, "retirement-replay-products.py"), "utf8"),
		);
		expect(pinDisagreements(RETAINED, swift, python)).toEqual([]);
	});
	it("every field's shape is checked, so a typo cannot pass as agreement", () => {
		expect(RETAINED.sourceSHA).toMatch(/^[0-9a-f]{40}$/);
		expect(RETAINED.bundleSHA256).toMatch(/^[0-9a-f]{64}$/);
		expect(RETAINED.tarSHA256).toMatch(/^[0-9a-f]{64}$/);
		expect(Number.isSafeInteger(RETAINED.artifactID)).toBe(true);
		expect(Number.isSafeInteger(RETAINED.runID)).toBe(true);
	});
	it("a partial pin is caught for each field at each site", () => {
		const swift: ReturnType<typeof swiftPins> = {
			sourceSHA: RETAINED.sourceSHA,
			bundleSHA256: RETAINED.bundleSHA256,
			tarSHA256: RETAINED.tarSHA256,
		};
		const python: ReturnType<typeof pythonPins> = {
			artifactIDs: [
				RETAINED.artifactID,
				RETAINED.artifactID,
				RETAINED.artifactID,
			],
			runID: RETAINED.runID,
			sourceSHA: RETAINED.sourceSHA,
		};
		expect(pinDisagreements(RETAINED, swift, python)).toEqual([]);
		for (const key of ["sourceSHA", "bundleSHA256", "tarSHA256"] as const)
			expect(
				pinDisagreements(RETAINED, { ...swift, [key]: "0".repeat(40) }, python),
			).toHaveLength(1);
		expect(
			pinDisagreements(RETAINED, swift, { ...python, runID: 1 }),
		).toHaveLength(1);
		expect(
			pinDisagreements(RETAINED, swift, { ...python, sourceSHA: "0" }),
		).toHaveLength(1);
		for (let i = 0; i < 3; i++) {
			const ids = [...python.artifactIDs];
			ids[i] = 1;
			expect(
				pinDisagreements(RETAINED, swift, { ...python, artifactIDs: ids }),
			).toHaveLength(1);
		}
	});
});
