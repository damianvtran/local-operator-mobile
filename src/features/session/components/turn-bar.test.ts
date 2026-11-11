import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Pins the turn bar's U-41/U-42 geometry at the SOURCE, because the audit ledger that
 * used to cover it is gone: `px-2.5` (10 pt) and `gap-1.5` (6 pt) are off the spacing
 * scale, and a ✓ in its own flex column plus a row-centred caret is what put the first
 * line 27.8 pt inside the row at 150 % text. Units run in Node and cannot render, so
 * this is a regression tripwire; the rendered proof is in the PR's artifact index.
 */
const source = readFileSync(new URL("./turn-bar.tsx", import.meta.url), "utf8");

describe("turn-bar.tsx geometry", () => {
	it("uses on-scale spacing only", () => {
		expect(source).not.toMatch(/\b(?:px|py|gap)-\d+\.5\b/);
	});

	it("keeps the caret keyed to the first line and the ✓ inline", () => {
		expect(source).toContain("items-start");
		expect(source).not.toContain("items-center");
		// The ✓ (or ✗ when a hidden call failed) now stands in the shared
		// 16 pt glyph box (`trace-rail.ts`), so the bar's words sit on the
		// 40 pt text rail with every other trace row.
		expect(source).toContain('{failed ? "✗" : "✓"}');
		expect(source).toContain("TRACE_GLYPH_BOX_CLASS");
	});

	it("keeps each detail's unit unbreakable", () => {
		expect(source).toContain("u00A0");
	});
});

describe("turn-bar.tsx copy face (PR 223 round 1, U1-3 / Q1-3)", () => {
	it("paints the translated details proportional, digits tabular — never mono", () => {
		// `font-mono` drew Urdu's cursive details as disconnected letters.
		expect(source).toContain('"text-meta text-ink-dim tabular-nums"');
		expect(source).not.toContain(
			'<Text className="font-mono text-mono-sm text-ink-dim tabular-nums">',
		);
	});
});

const foldSource = readFileSync(
	new URL("./fold-bar.tsx", import.meta.url),
	"utf8",
);
describe("fold-bar.tsx live glyph (PR 223 round 1, Q1-1 / U1-4)", () => {
	it("keeps `⟳` while running, open or closed, even after an earlier failure", () => {
		expect(foldSource).toContain(
			'const glyph = fold.running ? "⟳" : failed ? "✗" : "✓";',
		);
		expect(foldSource).toContain("active={fold.running && !open}");
		// The failure count still paints on the trailing edge.
		expect(foldSource).toContain("{fold.failedCount}");
	});
});

/**
 * Q2-1 (PR 223 round 2): `9s لگے · 8 اعمال` begins with the Latin unit, so RN-web's
 * default `dir="auto"` laid the bar's words out LTR inside the Urdu page and they
 * left the 40 pt start rail. The composed `Text` must state the page's base.
 * Rendered through real react-native-web markup, as `section-header.test.ts`.
 */
describe("TurnBar: composed summary states the page direction (Q2-1)", async () => {
	const { createElement: h } = await import("react");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const { DirectionProvider } = await import("@/ui/direction");
	const { TurnBar } = await import("./turn-bar");
	const markup = (direction: "ltr" | "rtl") =>
		renderToStaticMarkup(
			h(DirectionProvider, {
				direction,
				locale: direction === "rtl" ? "ur" : "en",
				children: h(TurnBar, {
					turnKey: "u1",
					facts: { steps: 8, durationS: 9 },
					headline: "do the thing",
					open: false,
					onToggle: () => {},
				}),
			}),
		);

	it("rtl: the summary Text carries an explicit dir=rtl", () => {
		expect(markup("rtl")).toContain('dir="rtl"');
	});

	it("ltr: no dir is stated, so en/fr/hi markup is unchanged", () => {
		expect(markup("ltr")).not.toContain('dir="rtl"');
	});
});
