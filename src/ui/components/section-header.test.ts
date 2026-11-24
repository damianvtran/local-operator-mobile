import { readFileSync } from "node:fs";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderFor } from "@/i18n";
import {
	SECTION_HEADER_LABEL_CLASS,
	SectionHeader,
} from "@/ui/components/section-header";
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

describe("SectionHeader: RTL cursive tracking", () => {
	it("removes tracking from an Urdu label without requiring labelDir", () => {
		const markup = render(h(SectionHeader, { label: "ترتیبات" }), "rtl");
		expect(markup).toContain("letter-spacing:0");
		expect(markup).toContain('dir="auto"');
	});

	it("also removes tracking when composed copy begins in Latin", () => {
		const markup = render(h(ComposedHeading, null), "rtl");
		expect(markup).toContain("letter-spacing:0");
		expect(markup).toContain('dir="rtl"');
	});

	it("preserves a native caller's writingDirection while removing tracking", () => {
		const markup = render(
			h(SectionHeader, {
				label: HEADER,
				labelDir: { style: { writingDirection: "rtl" } },
			}),
			"rtl",
		);
		expect(markup).toContain("letter-spacing:0");
		expect(markup).toContain("direction:rtl");
	});

	it("keeps LTR headings and Latin-only RTL headings on the original token", () => {
		for (const label of ["Connection", "Connexion", "कनेक्शन", "ترتیبات"]) {
			expect(render(h(SectionHeader, { label }), "ltr")).not.toContain(
				"letter-spacing:0",
			);
		}
		expect(
			render(h(SectionHeader, { label: "Connection" }), "rtl"),
		).not.toContain("letter-spacing:0");
		expect(SECTION_HEADER_LABEL_CLASS).toBe(
			"text-mono-label uppercase text-ink-muted",
		);
	});
});

/* The heading's ink (UX pass, settings): the all-caps mono label was painted
 * `ink-dim`, the CAPTION ink, so at 11 pt it read fainter than the body text it
 * heads. The token source names the role for it — `ink-muted`'s role note lists
 * "panel headers" — so the test reads the kit rather than restating a class. */
describe("SectionHeader: the label paints the kit's panel-header ink", () => {
	const tokens = JSON.parse(
		readFileSync(
			new URL("../../../design/tokens/tokens.json", import.meta.url),
			"utf8",
		),
	) as { color: { ink: Record<string, { role: string }> } };
	const panelHeaderInk = Object.entries(tokens.color.ink).find(([, token]) =>
		token.role.includes("panel headers"),
	)?.[0];

	it("names the role the token source assigns to panel headers", () => {
		expect(panelHeaderInk).toBe("ink-muted");
		expect(SECTION_HEADER_LABEL_CLASS.split(" ")).toContain(
			`text-${panelHeaderInk}`,
		);
		expect(SECTION_HEADER_LABEL_CLASS).not.toContain("text-ink-dim");
	});
});
