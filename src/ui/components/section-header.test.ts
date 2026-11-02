import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderFor } from "@/i18n";
import { SectionHeader } from "@/ui/components/section-header";
import { DirectionProvider, useComposedDir } from "@/ui/direction";

/**
 * The heading is one of the two places the composed-copy defect showed (design
 * review round 1, D1): `Wakes · 5 شیڈول شدہ` begins with a Latin letter, so the
 * label's inferred `dir="auto"` laid the whole line out left-to-right under the
 * Urdu page and the heading sat on the trailing edge. This pins the seam that
 * carries the fix — the label's own `Text`, and the `labelDir` the screen passes
 * it. The mechanism's own tests live in `src/ui/direction.test.ts`.
 */

/** The heading a screen composes: a fixed title and the real catalogue count. */
const HEADER = `Wakes · ${renderFor(
	"mobile.schedules.summary.wakes",
	{ count: 5 },
	"ur",
)}`;

/** The composition site: a screen that reads the page direction for its label. */
const ComposedHeading = () => {
	const composed = useComposedDir();
	return h(SectionHeader, { label: HEADER, labelDir: composed });
};

const render = (children: ReactNode, direction: "ltr" | "rtl"): string =>
	renderToStaticMarkup(
		h(DirectionProvider, { direction, locale: "ur", children }),
	);

describe("SectionHeader: a composed label states its paragraph direction", () => {
	it("rtl: the caller's labelDir reaches the label's Text as an explicit dir", () => {
		const markup = render(h(ComposedHeading, null), "rtl");
		expect(markup).toContain('dir="rtl"');
		expect(markup).not.toContain('dir="auto"');
		expect(markup).toContain(HEADER);
	});

	it("ltr: the same caller emits no dir, so the heading is unchanged", () => {
		const markup = render(h(ComposedHeading, null), "ltr");
		expect(markup).toContain('dir="auto"');
		expect(markup).not.toContain('dir="rtl"');
	});

	it("a caller that passes no labelDir keeps the inferred base: the opt-in is real", () => {
		const markup = render(h(SectionHeader, { label: "Connection" }), "rtl");
		expect(markup).toContain('dir="auto"');
	});
});
