import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The sidebar footer's vertical clearance between the computer chip and the
 * Inbox count badge on the destinations bar below it (design round 1, D1).
 *
 * The badge is out of flow at `top: -N` from its icon, so it overhangs the
 * slot by N pt whenever the icon sits at the slot's top edge — which is where it
 * sits once the slot's content (icon + gap + label) reaches the slot's
 * `minHeight` as text scales up to the large-text switch. The only thing between
 * that overhang and the chip's bordered box is the footer column's gap, so the
 * gap must be at least the overhang at every scale. Content-only arithmetic is
 * the worst case: at 100 % on iOS the icon starts 1.6 pt down, which only helps.
 *
 * Asserted over the SOURCE, for the reason `tags-wiring.test.ts` records: the
 * pane reaches `uniwind` through `@/ui`, which the Node test environment cannot
 * import, and a rendered frame is the capture rig's job, not a unit's.
 */
const PANE = readFileSync(
	fileURLToPath(new URL("./conversations-pane.tsx", import.meta.url)),
	"utf8",
);

/* The footer's class list (it carries the `sidebarFooter` region testID), and
 *  the count's out-of-flow offset from its icon. Top-level for biome's
 *  useTopLevelRegex; they scan the source text, not a frame. */
const FOOTER_CLASS =
	/className="gap-(\d+(?:\.5)?) border-t border-hairline[^"]*"\s*\n(?:[^\n]*\n)?\s*testID=\{REGION\.sidebarFooter\}/;
const BADGE_TOP = /style=\{\{ top: -(\d+), start: \d+ \}\}/;

/* Tailwind's spacing scale: one step is 4 pt. */
const SPACING_STEP = 4;

describe("the sidebar footer", () => {
	it("keeps the Inbox badge clear of the computer chip at every scale", () => {
		const gap = PANE.match(FOOTER_CLASS);
		const badge = PANE.match(BADGE_TOP);
		expect(gap, "footer gap class not found").not.toBeNull();
		expect(badge, "inbox badge offset not found").not.toBeNull();
		const gapPt = Number(gap?.[1]) * SPACING_STEP;
		const overhangPt = Number(badge?.[1]);
		/* At least 1 pt of air, so the badge never touches the chip's outline. */
		expect(gapPt - overhangPt).toBeGreaterThanOrEqual(1);
	});
});
