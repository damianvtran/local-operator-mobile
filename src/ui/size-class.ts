import { maxColumnWidth } from "@/ui/column";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { LAYOUT } from "@/ui/tokens.gen";

/**
 * The adaptive layout vocabulary, in ONE place, and FREE OF `react-native`.
 *
 * Two screen streams and a review round have to agree about what "regular width"
 * means, so the numbers live here (and behind `LAYOUT`, which the token build
 * generates) rather than in each screen. A second definition of the tablet
 * breakpoint is the defect this file exists to prevent.
 *
 * It is a plain module rather than part of `layout.ts` because of this repo's own
 * test rule (`vitest.config.ts`): units run in Node, and anything a test touches
 * must not import `react-native`. The hook and the platform touch floor — which
 * genuinely need the platform — live in `layout.ts` and delegate the decision to
 * `layoutFor()` here, so the rules are asserted in a unit test and the platform
 * binding is not faked anywhere.
 *
 * The classes are deliberately iOS-shaped — compact/regular — because the app is a
 * phone app that grows into a tablet, and those two names are what the layout
 * decisions in `docs/design/components.md` § 22 are written against:
 *
 *  - **compact**: a phone. One column, push navigation.
 *  - **regular**: a tablet, or a phone in landscape with room to spare. Two panes
 *    where a list and a detail genuinely exist, a readable column everywhere else.
 *
 * Width decides, never the device model: a 1366 pt iPad and a 1366 pt browser
 * window deserve the same layout, and a folded phone is simply a narrow one.
 */

export type SizeClass = "compact" | "regular";

export type Orientation = "portrait" | "landscape";

export interface Layout {
	sizeClass: SizeClass;
	orientation: Orientation;
	/** The viewport, in CSS points. */
	width: number;
	height: number;
	/** The readable measure for a single-pane screen, or `null` when the screen is
	 *  already narrow enough that a cap would only add margins. */
	measure: number | null;
	/** Whether a two-pane layout has room to be worth it. */
	split: boolean;
}

/**
 * The numbers the token build does not carry yet.
 *
 * `design/tokens/tokens.json` already gives the readable measures and
 * `tabletBreakpoint` (read through `LAYOUT` below). These three are new layout
 * decisions, so they are declared once here — NOT copied into each screen — and the
 * manager has been told they belong in the token set.
 */
/** The width at which a list and a detail can share a screen. */
export const SPLIT_MIN_WIDTH = 900;

/** The list pane's width — wide enough for a row's two lines and its marks,
 *  narrow enough to leave the detail a readable column. */
export const SPLIT_PANE_WIDTH = 360;

/** Below this height two panes are slivers, whatever the width: 844x390 landscape
 *  is wide and short, and the keyboard covers half of it. */
export const SPLIT_MIN_HEIGHT = 700;

/** The width below which a screen header stacks its title above its controls —
 *  the FLOOR, and the default for a screen that passes nothing else.
 *
 *  Derived from the design round's measurements (D1): the busiest header — the
 *  sessions list, a count badge plus two 48 dp controls plus the avatar —
 *  reserves 248 dp of chrome (at the measured frame the title received 72 of
 *  the 320 dp, so the chrome took the rest), and the title ("Sessions" at the
 *  `display` step) needs 106 dp, so at 100 % text the title cannot fit below
 *  248 + 106 = 354 dp: at 320 it rendered "Ses…" (clientW 72, scrollW 106)
 *  while removing either control restored it (both 124/124 — zero slack at
 *  that width, and this PR's control is what tipped it).
 *
 *  That frame carried ONE badge. The merged header can carry two — the unread
 *  badge beside the asks badge — and the measured fit then rises to ~397 dp:
 *  in the round-2 probe the title clipped at 360, 375 AND 390 with both
 *  badges at 2-digit counts. Lifting THIS constant past every phone width
 *  would stack every other screen's (lighter) header too, so the sessions
 *  screen passes its live fit — `headerStackWidth` below — and this constant
 *  stays the floor: no lighter cluster ever stacks earlier than the reviewed
 *  behaviour, and only the heavier one moves. */
export const HEADER_STACK_WIDTH = 354;

/** Whether a screen header stacks its title above its controls: at large text
 *  (`LARGE_TEXT_SCALE`, the scale the stacked layout was designed against), or
 *  on a viewport too narrow for the header's single line to fit (`stackBelow`,
 *  defaulting to the kit's floor). A screen whose action cluster is heavier
 *  than the floor — the sessions list's live count badges — passes its own
 *  measured fit (`headerStackWidth`), so the decision stays one function, in
 *  one place, pinned by the unit test rather than argued by a comment. */
export function headerStacks(
	effectiveScale: number,
	width: number,
	stackBelow: number = HEADER_STACK_WIDTH,
): boolean {
	return effectiveScale > LARGE_TEXT_SCALE || width < stackBelow;
}

/** The measured single-line chrome and title of the sessions header (R2-1,
 *  round 2): the row's paddings (16+16), the title↔cluster gap (8), the
 *  cluster's three 48 dp controls with their two 4 dp gaps, and "Sessions" at
 *  the `display` step. */
const HEADER_BARE_WIDTH = 192 + 106;

/** Each live count badge's measured width INCLUDING its 4 dp cluster gap, and
 *  the measured step per further digit — the round-2 probe's own readings
 *  (one decimal), so the table in the doc below and the code cannot drift. */
const UNREAD_BADGE = { base: 29.27, digit: 7.26 } as const;
const ASKS_BADGE = { base: 55.14, digit: 6.84 } as const;

/**
 * The width below which the SESSIONS header stacks, for its LIVE badge set —
 * the round-2 re-derivation (R2-1), from measurement rather than estimate.
 *
 * The merged header's action cluster carries up to two count badges (the
 * unread badge beside the asks badge), and each live one moves the fit. The
 * readings, all at 100 % text in the round-2 probe over this build:
 *
 * | piece                                      | measured |
 * |--------------------------------------------|----------|
 * | chrome 192 + title 106 (see above)         | 298      |
 * | unread badge, 1 digit / each further digit | 29.27 / 7.26 |
 * | asks badge, 1 digit / each further digit   | 55.14 / 6.84 |
 *
 * The sum is rounded UP once, so the bound errs toward stacking a hair early
 * rather than clipping a hair late. The kit constant is the FLOOR: a set whose
 * fit is below it (no badge at all, or single-digit badges) keeps the reviewed
 * behaviour, and only a heavier cluster moves the trigger. Consistency check:
 * one asks badge, 1 digit — 298 + 55.14 = 353.14 → 354, the shipped constant,
 * reproduced exactly.
 */
export function headerStackWidth(
	unreadCount: number | null,
	asksCount: number,
): number {
	const digitCount = (count: number): number =>
		Math.max(1, String(Math.trunc(count)).length);
	let width = HEADER_BARE_WIDTH;
	if (unreadCount !== null && unreadCount > 0)
		width +=
			UNREAD_BADGE.base + UNREAD_BADGE.digit * (digitCount(unreadCount) - 1);
	if (asksCount > 0)
		width += ASKS_BADGE.base + ASKS_BADGE.digit * (digitCount(asksCount) - 1);
	return Math.max(HEADER_STACK_WIDTH, Math.ceil(width));
}

/** The pure decision, so it is testable and is not a rendering side effect. */
export function layoutFor(width: number, height: number): Layout {
	const orientation: Orientation = width > height ? "landscape" : "portrait";
	const sizeClass: SizeClass =
		width >= LAYOUT.tabletBreakpoint ? "regular" : "compact";
	const roomForTwoPanes =
		width >= SPLIT_MIN_WIDTH && height >= SPLIT_MIN_HEIGHT;
	return {
		sizeClass,
		orientation,
		width,
		height,
		measure: measureFor(width, height),
		split: roomForTwoPanes,
	};
}

function measureFor(width: number, height: number): number | null {
	/* Delegated, not re-derived. This was a second implementation of the same rule
	 *  and it disagreed with the first at exactly the size the rule exists for:
	 *  `column.ts` classifies a device by its SHORTER side (a phone on its side is
	 *  still a phone) and returns 620 for 844x390, while this returned 640 by looking
	 *  at the width. `Screen` renders through `column.ts` and `ReadableColumn` through
	 *  `layout.measure`, so the disagreement was one screen away from putting a 640 pt
	 *  column inside a 620 pt cap. One implementation now, and this one is a call. */
	return maxColumnWidth({ width, height });
}
