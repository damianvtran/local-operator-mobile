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
	NEEDS_BROWSER,
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
