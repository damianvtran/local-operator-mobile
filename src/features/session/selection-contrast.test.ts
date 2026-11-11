import { describe, expect, it } from "vitest";

import {
	SELECTION_HIGHLIGHT_TARGET_ALPHA,
	SELECTION_INK_MIN,
	SELECTION_SURFACES,
	SELECTION_VISIBLE_MIN,
	selectionHighlight,
} from "@/features/session/text-selection";
import { type ColorRole, THEMES } from "@/ui/tokens.gen";

/**
 * The Android selection highlight is visible, and readable through
 * (PR #233 design R1, D1). The first cut used `accent-wash`, which measured
 * 1.00–1.37:1 against `message-surface`: drag handles with no visible range
 * between them. The highlight is now the accent at a per-theme alpha near 30 %
 * (`selectionHighlight`, `text-selection.ts`). This re-derives — with its own
 * WCAG arithmetic, not the module's — for EVERY palette in `tokens.gen.ts`:
 *
 *  - READABLE, always: `ink` over the composited fill >= 4.5:1 on every surface
 *    a selectable body sits on (answer, user bubble, tool well).
 *  - VISIBLE: the fill vs each surface >= 1.5:1 — unless the test itself
 *    proves no accent alpha at all can give 1.5:1 everywhere while keeping the
 *    ink readable. Then the chosen alpha must be the most visible readable one
 *    in the search window, and still >= 1.39:1 (measured worst, 1.396:1, against
 *    the accent-wash's 1.00:1). Proven, not listed, so a new palette cannot
 *    join the exceptions silently.
 *
 * Composited in sRGB with the alpha Android applies to an ARGB highlight.
 */
const channels = (hex: string): number[] =>
	[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));

const luminance = (rgb: readonly number[]): number => {
	const [r, g, b] = rgb.map((c) => {
		const channel = c / 255;
		return channel <= 0.03928
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: readonly number[], b: readonly number[]): number => {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
		number,
		number,
	];
	return (light + 0.05) / (dark + 0.05);
};

const over = (accent: string, alpha: number, bottom: string): number[] => {
	const fg = channels(accent);
	return channels(bottom).map((c, i) =>
		Math.round((alpha / 255) * (fg[i] as number) + (1 - alpha / 255) * c),
	);
};

type Palette = Record<ColorRole, string>;
const RRGGBBAA = /^#[0-9a-f]{8}$/i;

const measure = (colors: Palette, alpha: number) =>
	SELECTION_SURFACES.map((surface) => {
		const fill = over(colors.accent, alpha, colors[surface]);
		return {
			surface,
			visible: contrast(fill, channels(colors[surface])),
			ink: contrast(channels(colors.ink), fill),
		};
	});

const readable = (colors: Palette, alpha: number) =>
	measure(colors, alpha).every((m) => m.ink >= SELECTION_INK_MIN);
const worstVisible = (colors: Palette, alpha: number) =>
	Math.min(...measure(colors, alpha).map((m) => m.visible));

describe("the Android selection highlight across every palette (design R1, D1)", () => {
	it("targets ~30 % and never falls back to an opaque colour", () => {
		expect(SELECTION_HIGHLIGHT_TARGET_ALPHA / 255).toBeCloseTo(0.3, 2);
		const theme = THEMES[0];
		const colors = { ...(theme.colors as Palette), accent: "rgb(1, 2, 3)" };
		expect(selectionHighlight(colors)).toBeUndefined();
		// Guards against a vacuous pass if the catalogue import ever empties.
		expect(THEMES.length).toBeGreaterThan(1);
	});

	for (const theme of THEMES) {
		const colors = theme.colors as Palette;
		it(`${theme.id}: ink readable on it everywhere, visible wherever any alpha can be`, () => {
			const highlight = selectionHighlight(colors);
			expect(highlight).toMatch(RRGGBBAA);
			expect(highlight?.slice(0, 7)).toBe(colors.accent);
			const alpha = Number.parseInt(highlight?.slice(7) ?? "", 16);
			// ~30 %: the search window is 20 %–45 %.
			expect(alpha).toBeGreaterThanOrEqual(0x33);
			expect(alpha).toBeLessThanOrEqual(0x73);

			for (const m of measure(colors, alpha)) {
				expect(
					m.ink,
					`${theme.id}: ink on highlight over ${m.surface}`,
				).toBeGreaterThanOrEqual(SELECTION_INK_MIN);
			}

			const feasible = Array.from({ length: 255 }, (_, i) => i + 1).some(
				(a) =>
					readable(colors, a) &&
					worstVisible(colors, a) >= SELECTION_VISIBLE_MIN,
			);
			if (feasible) {
				for (const m of measure(colors, alpha)) {
					expect(
						m.visible,
						`${theme.id}: highlight vs ${m.surface}`,
					).toBeGreaterThanOrEqual(SELECTION_VISIBLE_MIN);
				}
				return;
			}
			let best = 0;
			for (let a = 0x33; a <= 0x73; a += 1) {
				if (readable(colors, a)) best = Math.max(best, worstVisible(colors, a));
			}
			expect(worstVisible(colors, alpha)).toBeCloseTo(best, 6);
			expect(worstVisible(colors, alpha)).toBeGreaterThanOrEqual(1.39);
		});
	}
});
