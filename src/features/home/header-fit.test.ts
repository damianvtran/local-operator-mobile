import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	COMPACT_BELL_SCALE,
	HEADER_SWITCHER_FLOOR,
	headerBellShowsCount,
} from "@/features/home/header-fit";
import { TOUCH_FLOOR } from "@/ui/layout";

/** The header's own source, whitespace-collapsed once: re-wrapping the JSX must
 *  not read as a layout change (the shape `rail-count.test.ts` uses on the pane). */
const SOURCE = readFileSync(
	new URL("home.tsx", import.meta.url),
	"utf8",
).replace(/\s+/g, " ");

/** The offset of a control's declared id, or a failure that names it. */
const atId = (id: string): number => {
	const at = SOURCE.indexOf(`testID={CONTROL.${id}}`);
	if (at < 0) throw new Error(`home.tsx declares no testID ${id}`);
	return at;
};

/**
 * The home header at large text (design review round 9, D24).
 *
 * The failing measurement, on `224d9f4` with the busy inbox at 320 pt / 200 %:
 * `computers-button` **36.4 pt** wide painting "…1", next to
 * `home-notifications` at **99.6 pt** — under the touch floor, naming nothing.
 * `minHeight` alone could not stop it: the flex row took the width from the one
 * control that had no width floor.
 *
 * Each assertion is one half of the fix, so reverting either half turns a check
 * red. That is the point — the defect was a LAYOUT that no test constrained.
 */
describe("the home header at large text", () => {
	it("keeps the switcher above the touch floor on BOTH axes", () => {
		expect(HEADER_SWITCHER_FLOOR).toBe(TOUCH_FLOOR);
		const from = atId("computersButton");
		const switcher = SOURCE.slice(from, SOURCE.indexOf("<Text", from));
		expect(switcher).toContain(
			"style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}",
		);
	});

	it("paints the bell's count only while the row can afford it", () => {
		// 135 % still fits BOTH a `99+` pill and a switcher over its floor (58.2 pt
		// at 100 % with `99+`, 65.5 pt beside a `5`). 200 % is the scale CI measured
		// the collapse at, so that is where the pill yields.
		expect(headerBellShowsCount(1)).toBe(true);
		expect(headerBellShowsCount(1.35)).toBe(true);
		expect(headerBellShowsCount(COMPACT_BELL_SCALE)).toBe(false);
		expect(headerBellShowsCount(3)).toBe(false);
	});

	it("gates the pill on that rule rather than on the count alone", () => {
		// A count-only condition is the regression: `99+` paints again at 300 % and
		// takes the switcher back under its floor.
		const from = atId("homeNotifications");
		const bell = SOURCE.slice(from, SOURCE.indexOf("</Pressable>", from));
		expect(bell).toContain("headerBellShowsCount(effectiveScale)");
		expect(bell).not.toMatch(/inboxCount !== null && inboxCount > 0 \?/);
	});
});
