import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyThemes } from "./capture.ts";
import { canvasExpectation, parseCanvasContext } from "./theme-tokens.ts";

/** Assert the real report boundary, not only its palette helper (R164-1).
 * Node strips types, so a missing required property previously printed undefined
 * even while the helper tests passed. This imports the CLI without launching it. */
describe("capture theme report provenance", () => {
	it("requires the canary to select fixture truth explicitly and rejects unknown contexts", () => {
		const caller = readFileSync(
			new URL("../../e2e/run-canary.ts", import.meta.url),
			"utf8",
		);
		expect(caller).toMatch(
			/"--canvas-context",\s*"fixture",\s*"--tokens",\s*tokens/,
		);
		const verifier = readFileSync(
			new URL("../mock-relay/verify.ts", import.meta.url),
			"utf8",
		);
		// Four direct fixture probes (hang, scale, readiness and teardown) bypass
		// run-canary; none may silently regain the app-palette default.
		expect([
			...verifier.matchAll(/"--canvas-context",\s*"fixture"/g),
		]).toHaveLength(4);
		expect(parseCanvasContext(undefined)).toBe("app");
		expect(parseCanvasContext("fixture")).toBe("fixture");
		expect(() => parseCanvasContext("automatic")).toThrow(
			"unknown canvas context",
		);
		// A fixture without its own token stays uncomparable, never borrowed from app.
		expect(canvasExpectation("dark", null, undefined, "fixture")).toEqual({
			canvas: null,
			source: "none",
		});
	});

	const tokens = {
		perTheme: { dark: { canvas: "#22201c" }, light: { canvas: "#f2ede3" } },
		reason: null,
	};
	const frame = (canvasColor = "rgb(34, 32, 28)") =>
		({
			cell: "path:/clean/clean",
			device: "fixture",
			scale: "100",
			theme: "dark",
			frames: [],
			measurements: {
				mountedElements: 10,
				reported: { theme: "dark", themeSource: "query" },
				resolvedColorScheme: "dark",
				canvasColor,
			},
		}) as unknown as Parameters<typeof verifyThemes>[0][number];

	it("compares explicit fixture captures to their supplied tokens, not the app palette (Q164-2)", () => {
		const report = verifyThemes([frame()], tokens, "fixture");
		expect(report.problems).toEqual([]);
		expect(report.canvasCompared).toBe(1);
		expect(report.canvasSource).toBe(
			"the explicit fixture token file (tokens)",
		);
	});

	it("still rejects that fixture canvas in the default app context", () => {
		const report = verifyThemes([frame()], tokens);
		expect(report.problems).toHaveLength(1);
		expect(report.problems[0]).toContain("#1d1b17");
	});

	it("still rejects a fixture that disagrees with its own supplied token", () => {
		const report = verifyThemes([frame("rgb(0, 0, 0)")], tokens, "fixture");
		expect(report.problems).toHaveLength(1);
		expect(report.problems[0]).toContain("#22201c");
	});

	it("returns the computed source for the actual success-log consumer", () => {
		const report = verifyThemes([], {
			perTheme: { dark: { canvas: "#22201c" }, light: { canvas: "#f2ede3" } },
			reason: null,
		});
		expect(report.canvasSource).toBe(
			"the expected canvas is the shipped palette's own value (palette)",
		);
		expect(report.canvasSource).not.toContain("undefined");
	});
});
