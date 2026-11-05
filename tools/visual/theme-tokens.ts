/**
 * The design tokens' canvas per theme, and whether the canvas-vs-token comparison
 * they feed can be made at all.
 *
 * Why this is its own module rather than two helpers inside `capture.ts`: the rule it
 * states is asserted from two places — the capture's own report and the gallery tile a
 * reviewer opens instead of the stdout — and the uncomparable-token case below is the
 * one that let a run print the all-clear over zero comparisons, so it needs a fixture
 * and a test that hold it still. `identical-states.ts` is the same shape for the same
 * reason.
 */

import { existsSync, readFileSync } from "node:fs";

import { DEFAULT_THEME_IDS, THEMES } from "../../src/ui/tokens.gen.ts";

/**
 * What the tokens gave the theme check, and — when it cannot be had — why.
 *
 * `perTheme` is written into the manifest's `meta.themeTokens` exactly as it always
 * has been: the two themes when they were read, `{}` when no tokens were named or
 * found, `null` when one was named and could not be read. Reshaping this to report a
 * skip would move an artifact other tools read, so the report lives in `reason` and on
 * stdout, and this field keeps its meaning.
 */
export interface CanvasTokens {
	/** Per-theme canvas colour, in the shape the manifest has always carried. */
	readonly perTheme: Record<string, { canvas: string | null }> | null;
	/** Why the canvas comparison cannot be made, or `null` when it can. */
	readonly reason: string | null;
}

/**
 * The canvas a token named for a theme, or `null` when it named none.
 *
 * An empty (or blank) value is *no canvas*, not a canvas: `rgbEquals` cannot compare
 * against `""`, so counting one as a token made the coverage tally say the frame was
 * compared while the verdict skipped the comparison by truthiness — and the run then
 * printed "every frame's resolved theme and canvas match its cell" over zero
 * comparisons. That is the defect this single predicate exists to close.
 */
export function canvasTokenFor(value: unknown): string | null {
	// The DECISION and the VALUE are the same test. This used to decide blankness on
	// `value.trim()` and then return the UNTRIMMED value, so a token written with padding
	// (" #22201c ") was accepted as a canvas and then compared against the rendered
	// `rgb(34, 32, 28)` by `rgbEquals`, which trims nothing — failing a cell that had
	// rendered correctly, which is the spurious red this one word removes.
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}

/**
 * Whether a frame's canvas can be compared against `expected` at all.
 *
 * The coverage tally and the per-record verdict BOTH go through this, never through a
 * test of their own: they used to differ (`expected === null` in the count, `expected ?
 * … : null` in the verdict), which is precisely how an uncomparable token came to be
 * counted as compared.
 */
export function canvasComparable(expected: string | null): expected is string {
	return canvasTokenFor(expected) !== null;
}

/**
 * The canvas the APP PAINTS for each mode — the palette the theme system resolves
 * when the reader has chosen nothing for that slot.
 *
 * WHY THIS IS THE EXPECTATION, not `design/tokens/tokens.json` (QA round 1,
 * Q164-1). The two files describe different things: `tokens.json` is the design
 * kit's BRAND layer, pinned to a kit slice and reconciled on the kit's release
 * cadence, while the colours a frame paints are the DESKTOP palettes the phone
 * ships (`design/themes/`, emitted as `THEMES` by `scripts/build-theme.ts`). They
 * agree on the light canvas and disagreed on the dark one — the desktop re-lit
 * its dark ladder on 2026-11-03 and the phone adopted it — so the gate compared
 * every dark frame against a ground the app no longer paints and reported 636
 * theme problems over an app that was right.
 *
 * The gate exists to prove the app APPLIED the palette it was generated with, so
 * it has to measure against that palette. `activelyPaintedCanvases` therefore reads
 * the emitted catalogue, and `design/tokens/tokens.json` is the fallback for a mode
 * the catalogue does not carry (a catalogue with no default for a slot is a bug
 * `tokens.gen.ts` itself prevents, but the fallback keeps this module usable with
 * a two-value token file alone).
 */
export function paintedCanvases(): Record<string, { canvas: string | null }> {
	const out: Record<string, { canvas: string | null }> = {};
	for (const [mode, id] of Object.entries(DEFAULT_THEME_IDS)) {
		const entry = THEMES.find((theme) => theme.id === id);
		out[mode] = { canvas: canvasTokenFor(entry?.colors.canvas) };
	}
	return out;
}

/**
 * The canvas a frame of `theme` must paint, and which file said so.
 *
 * The ORDER is the decision: the painted palette first, the kit's token file
 * second, nothing third. `source` is reported rather than inferred, so a reader
 * of the run can see which file the number came from without reading this
 * function.
 */
export function canvasExpectation(
	theme: string,
	perTheme: Record<string, { canvas: string | null }> | null,
	painted: Record<string, { canvas: string | null }> = paintedCanvases(),
): { canvas: string | null; source: "palette" | "tokens" | "none" } {
	const fromPalette = painted[theme]?.canvas ?? null;
	if (fromPalette !== null) return { canvas: fromPalette, source: "palette" };
	const fromTokens = perTheme?.[theme]?.canvas ?? null;
	if (fromTokens !== null) return { canvas: fromTokens, source: "tokens" };
	return { canvas: null, source: "none" };
}

/**
 * Read the design tokens' canvas per theme, so a frame can be checked against them.
 *
 * A missing token file is not a failure — the capture still produces frames — but it is
 * not agreement either, which is what `reason` carries.
 */
export function canvasTokens(tokensPath: string | undefined): CanvasTokens {
	// `{}`, not `null`: a token file that was never named or never found is the state
	// this field has always recorded as an empty table, and the manifest must not move
	// under a fix that is only about saying so.
	if (!tokensPath) {
		return { perTheme: {}, reason: "no --tokens path was given" };
	}
	if (!existsSync(tokensPath)) {
		return { perTheme: {}, reason: `no tokens file at ${tokensPath}` };
	}
	const tokens = JSON.parse(readFileSync(tokensPath, "utf8"));
	const tokensBag: unknown = tokens;
	if (typeof tokensBag !== "object" || tokensBag === null) {
		return { perTheme: null, reason: `${tokensPath} is not a JSON object` };
	}
	const color = (tokensBag as Record<string, unknown>).color;
	const surface =
		typeof color === "object" && color !== null
			? (color as Record<string, unknown>).surface
			: undefined;
	const canvas =
		typeof surface === "object" && surface !== null
			? (surface as Record<string, unknown>).canvas
			: undefined;
	if (typeof canvas !== "object" || canvas === null) {
		return {
			perTheme: null,
			reason: `${tokensPath} carries no color.surface.canvas per theme`,
		};
	}
	return {
		perTheme: {
			dark: {
				canvas: canvasTokenFor((canvas as Record<string, unknown>).dark),
			},
			light: {
				canvas: canvasTokenFor((canvas as Record<string, unknown>).light),
			},
		},
		reason: null,
	};
}
