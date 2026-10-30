import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BackIcon } from "@/ui/components/back-icon";
import { DirectionProvider } from "@/ui/direction";

/* The glyph set is stubbed to named elements: `lucide-react-native` pulls in
 * `react-native-svg`, which ships Flow source Node cannot load. What is under test
 * is WHICH glyph the component picks, and a stub that renders its own name makes
 * that readable straight from the markup. */
vi.mock("lucide-react-native", () => {
	const glyph = (name: string) => (props: { color: string; size: number }) =>
		h("svg", { "data-glyph": name, "data-size": props.size, style: {} });
	return {
		ArrowLeft: glyph("ArrowLeft"),
		ArrowRight: glyph("ArrowRight"),
		ChevronLeft: glyph("ChevronLeft"),
		ChevronRight: glyph("ChevronRight"),
	};
});

const render = (
	direction: "ltr" | "rtl" | null,
	glyph?: "arrow" | "chevron",
) => {
	const children = h(BackIcon, { color: "red", size: 20, glyph });
	return renderToStaticMarkup(
		direction === null
			? children
			: h(DirectionProvider, { direction, children }),
	);
};

describe("BackIcon", () => {
	it("is the unmirrored arrow in LTR, and with no provider (the pre-RTL appearance)", () => {
		expect(render("ltr")).toContain('data-glyph="ArrowLeft"');
		expect(render(null)).toContain('data-glyph="ArrowLeft"');
	});

	it("swaps to the right-pointing arrow in RTL", () => {
		expect(render("rtl")).toContain('data-glyph="ArrowRight"');
	});

	it("does the same for the detail-header chevron", () => {
		expect(render("ltr", "chevron")).toContain('data-glyph="ChevronLeft"');
		expect(render("rtl", "chevron")).toContain('data-glyph="ChevronRight"');
	});

	it("mirrors by glyph, never by a transform (a transform would double-mirror)", () => {
		for (const direction of ["ltr", "rtl"] as const) {
			expect(render(direction)).not.toMatch(/transform|scale/i);
		}
	});

	it("passes size through unchanged in both directions", () => {
		expect(render("ltr")).toContain('data-size="20"');
		expect(render("rtl")).toContain('data-size="20"');
	});
});
