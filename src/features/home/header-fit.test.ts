import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	COMPACT_BELL_SCALE,
	HEADER_SELECTOR_LEAD_PT,
	HEADER_SWITCHER_FLOOR,
	HOME_HEADER_GAP_PT,
	headerBellShowsCount,
	MENU_BADGE_INSET,
} from "@/features/home/header-fit";
import { TOUCH_FLOOR } from "@/ui/layout";
import { TYPE_STEPS } from "@/ui/tokens.gen";

/** The header's own source, whitespace-collapsed once: re-wrapping the JSX must
 *  not read as a layout change (the shape `rail-count.test.ts` uses on the pane). */
const SOURCE = readFileSync(
	new URL("home.tsx", import.meta.url),
	"utf8",
).replace(/\s+/g, " ");

/** The chip that fills the switcher's slot (M2b), collapsed the same way. */
const CHIP = readFileSync(
	new URL("../auth/computer-entry-points.tsx", import.meta.url),
	"utf8",
).replace(/\s+/g, " ");

/** A count-only gate on the bell's pill — the shape this round replaces.
 *  Hoisted, as the kit's own modules do, so a callback does not re-compile it
 *  (biome `useTopLevelRegex`). */
const _COUNT_ONLY_GATE = /inboxCount !== null && inboxCount > 0 \?/;

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
		/* Since M2b the slot holds `HeaderComputerChip`, so the floor is asserted
		 *  on the chip's own Pressable — slicing home.tsx from the testID would now
		 *  run into the BELL's markup and pass on the bell's floor. */
		expect(SOURCE).toMatch(
			/<HeaderComputerChip\s+testID=\{CONTROL\.computersButton\}/,
		);
		const from = CHIP.indexOf("export function HeaderComputerChip");
		const switcher = CHIP.slice(from, CHIP.indexOf("<Text", from));
		expect(switcher).toContain("min-w-0 flex-1");
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
		// The band's lower edge, one step below: 1.99 is still a pill. A threshold
		// compared with `<=` would move the yield a whole scale early, which no
		// measured cell would show (code review round 12, n-1).
		expect(headerBellShowsCount(1.99)).toBe(true);
	});

	it("retains unread state in a bell glyph, never a detached count pill", () => {
		const bell = SOURCE.slice(
			atId("homeNotifications"),
			SOURCE.indexOf("</Pressable>", atId("homeNotifications")),
		);
		expect(bell).toContain("waiting={inboxCount !== null && inboxCount > 0}");
		expect(bell).not.toContain("<Badge");
		expect(SOURCE).toContain("viewport.width >= 360 && effectiveScale < 1.5");
		expect(SOURCE).toContain('headerDensity="home"');
	});
});

/* TestFlight 578: "that top area in the new conversation seems really crowded
 * still, I think there needs to be a bit more padding to the left of the device
 * selector dropdown". The ☰'s count pill sat on the selector's edge. */
describe("the ☰'s count never touches the computer selector (TestFlight 578)", () => {
	/* The pill's width at 100 %: 1 pt border + 8 pt inset on each side around
	 *  `mono-label` glyphs at the mono advance (0.6 em, `list-row-meta.ts`).
	 *  SCOPE (code review m1): the inside-the-box claim is a 100 % claim. At
	 *  large text the pill grows LEADING (it is anchored at `end`), so a `99+`
	 *  reaches past the box's leading edge — pre-existing, and away from the
	 *  selector, which is what this block guards. Not capped with
	 *  `maxFontSizeMultiplier`: that caps only the OS factor on native, not the
	 *  app's own scale (CSS variables, `text-scale.ts`), and font scaling stays
	 *  on by design (`design/brand-kit.md` § 3.4). */
	const pillWidth = (label: string) =>
		2 * 1 + 2 * 8 + label.length * TYPE_STEPS["mono-label"].size * 0.6;

	it("keeps even the widest pill (`99+`) inside the menu button's own box at 100 %", () => {
		const trailing = TOUCH_FLOOR - MENU_BADGE_INSET.end;
		expect(trailing).toBeLessThan(TOUCH_FLOOR);
		expect(trailing - pillWidth("99+")).toBeGreaterThanOrEqual(0);
		/* On the 22 pt glyph's top-trailing corner: the pill starts left of the
		 *  glyph's trailing edge (33 pt) so it reads as the icon's badge. */
		expect(trailing - pillWidth("9")).toBeLessThan((TOUCH_FLOOR + 22) / 2);
	});

	it("grows the pill leading at any scale, so its trailing edge never moves toward the selector", () => {
		/* Anchored by `end`, the trailing edge is the inset alone, independent of
		 *  the pill's (scaled) width. */
		expect(Object.keys(MENU_BADGE_INSET).sort()).toEqual(["end", "top"]);
		expect(TOUCH_FLOOR - MENU_BADGE_INSET.end).toBeLessThan(TOUCH_FLOOR);
	});

	it("leaves at least 12 pt from the ☰ box and 16 pt from the pill to the selector", () => {
		expect(HOME_HEADER_GAP_PT + HEADER_SELECTOR_LEAD_PT).toBeGreaterThanOrEqual(
			12,
		);
		expect(
			MENU_BADGE_INSET.end + HOME_HEADER_GAP_PT + HEADER_SELECTOR_LEAD_PT,
		).toBeGreaterThanOrEqual(16);
	});

	it("wires the inset and the lead into the header, keeping the 44 pt floors", () => {
		const menu = readFileSync(
			new URL("../sessions/workspace-drawer.tsx", import.meta.url),
			"utf8",
		).replace(/\s+/g, " ");
		expect(SOURCE).toContain("<WorkspaceDrawerButton />");
		expect(menu).toContain("testID = CONTROL.homeSidebar");
		// Home's ☰ keeps MENU_BADGE_INSET; only the Team Bridge thread trigger
		// takes its own ringed inset (design D1-4).
		expect(menu).toContain(
			"style={bridgeTrigger ? BRIDGE_MENU_BADGE_INSET : MENU_BADGE_INSET}",
		);
		expect(menu).not.toContain("style={{ top: 2, end: 0 }}");
		expect(menu).toContain("minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR");
		/* `ms-2` is HEADER_SELECTOR_LEAD_PT; only beside the ☰ (not in the split). */
		expect(HEADER_SELECTOR_LEAD_PT).toBe(8);
		expect(SOURCE).toContain(
			'"min-w-0 flex-1 flex-row items-center gap-1", !split && "ms-2",',
		);
	});
});
