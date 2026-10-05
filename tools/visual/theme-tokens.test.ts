import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	canvasComparable,
	canvasTokenFor,
	canvasTokens,
} from "./theme-tokens.ts";

/**
 * The canvas half of the theme check, held still.
 *
 * Why this exists: with a token the comparison cannot be made against, the run used to
 * count the frame as COMPARED and then print "every frame's resolved theme and canvas
 * match its cell" — an all-clear over zero comparisons, the shape this whole change
 * exists to stop. The empty-string token is the one that got through a review, so it is
 * a committed fixture (`fixtures/tokens-empty-canvas.json`) rather than a value minted
 * inside the test: the case is reviewable, and it stays fixed after this round.
 */
const fixture = (name: string): string =>
	fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** The tokens the design kit actually ships, so their shape is asserted, not assumed. */
const shippedTokens = fileURLToPath(
	new URL("../../design/tokens/tokens.json", import.meta.url),
);

describe("canvasTokenFor", () => {
	it("keeps a real colour and treats everything else as no canvas", () => {
		expect(canvasTokenFor("#22201c")).toBe("#22201c");
		// An empty or blank canvas is NO canvas: `rgbEquals` cannot compare against it,
		// so a token that reads as one is a comparison nobody can make.
		expect(canvasTokenFor("")).toBeNull();
		expect(canvasTokenFor("   ")).toBeNull();
		expect(canvasTokenFor(null)).toBeNull();
		expect(canvasTokenFor(undefined)).toBeNull();
		expect(canvasTokenFor(42)).toBeNull();
	});

	it("returns the value its own predicate accepted, never the padded original", () => {
		// The DECISION is `trim() !== ""`, so the VALUE has to be the trimmed one. Returning
		// the original made `rgbEquals` compare `"  #22201c  "` against a rendered
		// `rgb(34, 32, 28)` and fail a cell that had rendered correctly. The equivalence
		// below is the property that defect broke — both forms must reach the comparison as
		// the same string, so a padded tokens file and a clean one are one input.
		expect(canvasTokenFor("  #22201c  ")).toBe("#22201c");
		expect(canvasTokenFor("  #22201c  ")).toBe(canvasTokenFor("#22201c"));
		expect(canvasTokenFor("\t#f2ede3\n")).toBe("#f2ede3");
	});
});

describe("canvasComparable", () => {
	it("is the single predicate the tally and the verdict share", () => {
		expect(canvasComparable("#22201c")).toBe(true);
		expect(canvasComparable("")).toBe(false);
		expect(canvasComparable("   ")).toBe(false);
		expect(canvasComparable(null)).toBe(false);
	});
});

describe("canvasTokens", () => {
	it("reads the shipped tokens: both themes, and a comparison that can be made", () => {
		const tokens = canvasTokens(shippedTokens);
		expect(tokens.reason).toBeNull();
		expect(canvasComparable(tokens.perTheme?.dark?.canvas ?? null)).toBe(true);
		expect(canvasComparable(tokens.perTheme?.light?.canvas ?? null)).toBe(true);
	});

	it("reads an empty-string canvas as no canvas, so the frame cannot be counted as compared", () => {
		const tokens = canvasTokens(fixture("tokens-empty-canvas.json"));
		// The file is readable, so this is a PARTIAL token set: the reason the run
		// reports for the missing theme is derived where the frames are counted, from
		// this `null` — which is why it must not survive as "".
		expect(tokens.reason).toBeNull();
		expect(tokens.perTheme?.dark?.canvas).toBeNull();
		expect(canvasComparable(tokens.perTheme?.dark?.canvas ?? null)).toBe(false);
		expect(tokens.perTheme?.light?.canvas).toBe("#f2ede3");
		expect(canvasComparable(tokens.perTheme?.light?.canvas ?? null)).toBe(true);
	});

	it("reports an unreadable token file with a reason, and no per-theme table", () => {
		const tokens = canvasTokens(fixture("tokens-no-canvas.json"));
		expect(tokens.reason).not.toBeNull();
		expect(tokens.perTheme).toBeNull();
	});

	it("trims a padded canvas, so a padded file compares against the rendered colour", () => {
		// A committed fixture rather than a value minted here, for the same reason the
		// empty-string case has one: whitespace around a colour is what a hand-edited token
		// file looks like, so the case is reviewable and stays fixed after this round.
		const tokens = canvasTokens(fixture("tokens-padded-canvas.json"));
		expect(tokens.reason).toBeNull();
		expect(tokens.perTheme?.dark?.canvas).toBe("#22201c");
		expect(tokens.perTheme?.light?.canvas).toBe("#f2ede3");
		// The mutation this pins, in the shape the empty-token case uses — assert the
		// CONSEQUENCE, not the return value: the stored canvas must be exactly what the design
		// kit ships, because `rgbEquals` compares the stored string verbatim. Untrimmed, a
		// padded file recorded `"  #22201c  "`, matched no rendered colour, and failed a cell
		// that had rendered correctly.
		const shipped = canvasTokens(shippedTokens);
		expect(tokens.perTheme?.dark?.canvas).toBe(shipped.perTheme?.dark?.canvas);
		expect(tokens.perTheme?.light?.canvas).toBe(
			shipped.perTheme?.light?.canvas,
		);
		expect(tokens.perTheme?.dark?.canvas).toBe(
			tokens.perTheme?.dark?.canvas?.trim(),
		);
		expect(canvasComparable(tokens.perTheme?.dark?.canvas ?? null)).toBe(true);
	});

	it("reports no --tokens path, and a path that does not exist, as an empty table", () => {
		// `{}` and not `null`: this is what the manifest's `meta.themeTokens` has always
		// carried in these two states, so the artifact does not move under a reporting fix.
		const absent = canvasTokens(undefined);
		expect(absent.perTheme).toEqual({});
		expect(absent.reason).toBe("no --tokens path was given");
		const missing = canvasTokens(fixture("no-such-tokens.json"));
		expect(missing.perTheme).toEqual({});
		expect(missing.reason).toContain("no tokens file at");
	});
});
