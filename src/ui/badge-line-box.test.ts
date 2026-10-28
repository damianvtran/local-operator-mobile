import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	BADGE_LINE_FOLLOWS_SCALE,
	badgeClasses,
	badgeLineClass,
} from "@/ui/variants";

/** The component's own source, whitespace-collapsed: a re-wrap must not read as
 *  a geometry change. */
const SOURCE = readFileSync(
	new URL("./components/badge.tsx", import.meta.url),
	"utf8",
).replace(/\s+/g, " ");

/** A blanket large-text line box, the shape this round reverts. Hoisted so a
 *  callback does not re-compile it (biome `useTopLevelRegex`). */
const BLANKET_LEADING_NONE = /className=\{`leading-none /;

/**
 * A badge's height, which is its line box plus its padding and nothing else.
 *
 * THE REGRESSION THIS PINS (round 12, F-1 / D28). Fixing the 300 % ink overflow
 * with a blanket `leading-none` changed every badge at every scale: the bordered
 * and sans badges fell 22 -> 18 pt (outside components.md § 6's 20-22), mono
 * landed at 17 pt so the two families no longer matched, and the count pills rode
 * their digits to the top. 672 of 1200 frames moved. The owners' geometry is
 * `.leading-4` on the label, which is what these assertions hold.
 */
describe("a badge's line box, and therefore its height", () => {
	it("keeps the filled pill's own classes", () => {
		// `px-2 py-0.5` + a 16 pt line box = the 20 pt pill every count renders at.
		expect(SOURCE).toContain(
			'emphasis ? "self-start rounded-full border-0 bg-accent px-2 py-0.5"',
		);
	});

	it("keeps the bordered family's classes, and its 22 pt height", () => {
		// `rounded-sm border px-2 py-0.5 text-meta` on the box, `leading-4` on the
		// label: 16 + 4 padding + 2 border = 22 pt, the top of § 6's band.
		expect(badgeClasses("neutral")).toContain("px-2 py-0.5");
		expect(badgeClasses("neutral")).toContain("border");
	});

	it("uses the fixed line box at every scale but the steps that need otherwise", () => {
		for (const scale of [1, 1.35, 2, 2.25]) {
			expect(badgeLineClass(scale)).toBe("leading-4");
		}
		// iOS's largest accessibility step is about 2.35x, where the ink reaches
		// ~19 pt inside a 20 pt pill and overruns from there (QA round 8, Q12).
		expect(BADGE_LINE_FOLLOWS_SCALE).toBeCloseTo(2.3, 5);
		expect(badgeLineClass(2.35)).toBe("leading-none");
		// 300 %: 33 px digits on a 16 pt line is the overflow D25 measured.
		expect(badgeLineClass(3)).toBe("leading-none");
	});

	it("has no blanket large-text line box, and no height floor on one variant only", () => {
		// Both were the regression's shape: a hardcoded `leading-none`, and a
		// `min-h-5` that only the filled pill carried (so the families diverged).
		expect(SOURCE).toContain("badgeLineClass(scale)");
		expect(SOURCE).not.toContain("min-h-5");
		expect(SOURCE).not.toMatch(BLANKET_LEADING_NONE);
	});

	it("does not read the text scale itself", () => {
		// The provider reaches `uniwind`, which the Node test environment cannot
		// parse: a hook here breaks `semantics.test.ts`, the only test that renders
		// this component. The scale arrives as a prop from callers that know it.
		expect(SOURCE).not.toContain("useTextScale");
		expect(SOURCE).toContain("scale = 1");
	});
});
