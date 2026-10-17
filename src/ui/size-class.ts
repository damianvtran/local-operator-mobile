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

/* --- the conversations panel's geometry (the home + sidebar slice). No token
 *  carries these yet, and by this file's own rule new layout numbers live HERE
 *  once and the manager is told they belong in the token set — proposed as
 *  `layout.sidebar = { mobileMax: 280, tablet: 320, sliver: 56 }`. --- */

/** Material's own temporary-drawer width rule: max 280 on mobile, 320 on tablet. */
export const SIDEBAR_MOBILE_MAX = 280;

/** The floor, so a narrow phone's panel still fits its rows' skeletons. */
export const SIDEBAR_MIN_WIDTH = 240;

/** What stays visible of the page behind the panel at the 320 pt floor — the
 *  same sliver Material's own example leaves at the right edge. */
export const SIDEBAR_SLIVER = 56;

/**
 * The panel's width for a viewport: `min(280, vw − 56)`, floored at 240.
 *
 * 390 pt phone → 280 (sliver 110); 320 pt phone → 264 (sliver 56). The sliver is
 * what keeps the page behind the panel legible enough to read as "darkened",
 * not gone — the temporary-drawer rule, not a sizing preference.
 */
export const sidebarWidthFor = (viewportWidth: number): number =>
	Math.max(
		SIDEBAR_MIN_WIDTH,
		Math.min(SIDEBAR_MOBILE_MAX, viewportWidth - SIDEBAR_SLIVER),
	);

/** In short landscape the stacked secondary routes cannot stay pinned without
 * taking the conversation list's height. Use the same height policy that rejects
 * a split pane there; portrait and roomy tablet layouts keep their pinned footer.
 * Scrolling the routes with the list preserves text scaling and target sizes. */
export const sidebarFooterScrolls = (layout: Layout): boolean =>
	layout.orientation === "landscape" && !layout.split;

/**
 * COMPACT SESSION CHROME: a phone held on its side, where the screen is shorter
 * than its own chrome.
 *
 * At 844x390 and 200 % text the session's header (stacked, 195 pt), status strip,
 * both panels and the composer (184 pt) add to well over the 390 pt screen: the
 * transcript measured 0 pt high and the composer sat entirely below the fold
 * (root scrollHeight 667 against 390). The remedy has to be a LAYOUT decision, not
 * a smaller font — the reader's text size is the thing being served — so the
 * secondary chrome shrinks and the two regions that cannot shrink any further
 * (the secondary chrome and the composer) are bounded and scroll internally.
 *
 * **Reach, stated.** Phones are portrait-locked natively (`app.config.ts`
 * `orientation: "portrait"`), so this form is reachable on Android >= 600 dp devices
 * (API 36 ignores the lock), tablets, multi-window and the web build; it is NOT
 * reachable on an iPhone or a small Android phone today.
 *
 * **The orientation comes from the SCREEN, not the window.** A portrait phone with
 * the keyboard up has a short WINDOW (390x300 under Android `adjustResize`) whose
 * width is greater than its height, so deciding from the window would flip the
 * whole screen into the landscape layout every time the reader started typing and
 * flip it back on dismiss. The physical screen does not move for a keyboard; it
 * moves only when the device is rotated. The WINDOW supplies the height test, so a
 * landscape tablet that has the room (>= `SPLIT_MIN_HEIGHT`) keeps the full chrome.
 */
export const compactChromeFor = (dims: {
	window: { width: number; height: number };
	screen: { width: number; height: number };
}): boolean =>
	dims.screen.width > dims.screen.height &&
	// The WINDOW must be landscape-shaped too: a 400x600 floating window on a landscape
	// tablet screen satisfies the two tests above and used to get landscape chrome in a
	// portrait-shaped window (UX U6).
	dims.window.width > dims.window.height &&
	dims.window.height < SPLIT_MIN_HEIGHT;

/**
 * The shares of the window height the compact session chrome may take, so the
 * transcript keeps the remainder. Shares, not constants: the same rule serves a
 * 390 pt iPhone and a 412 pt Android on their sides.
 *
 * The secondary region's share FALLS with text size because the fixed chrome (the
 * one-row header and the composer) grows with it: measured at 844x390 the header +
 * composer are 157 pt at 100 % and 177 pt at 200 %, so a constant share would either
 * starve the transcript at 200 % or waste the room at 100 %. The line is drawn from
 * the transcript's own floor — about 96 pt, two body lines — rather than from the
 * chrome: 390 - 157 - 4 - 96 = 133 pt at 100 % (0.34), and 390 - 177 - 4 - 96 = 113 pt
 * at 200 % (0.29, less the "+N more" cue's line, so 0.27 is spent on content).
 */
export const COMPACT_COMPOSER_SHARE = 0.45;

/** The pending card's scrolling content, as a share of the window. Its title row and
 *  its pinned controls (Approve/Deny/remember, or Submit) are outside this region, so
 *  the share buys only the reading of the command or question. */
export const COMPACT_PENDING_SHARE = 0.16;
export const compactChromeShare = (effectiveScale: number): number =>
	Math.min(0.34, Math.max(0.27, 0.34 - (effectiveScale - 1) * 0.07));

/** While a panel is OPEN the reader has chosen it, so it may take most of the screen
 *  (the transcript can drop to nothing; closing the panel gives the reading back). */
export const COMPACT_OPEN_PANEL_SHARE = 0.6;

/** The least height worth showing the closed region at: one `meta` line at 100 % plus
 *  its padding. Below it the region and its cue are dropped (see `snapRegion`). */
export const COMPACT_MIN_REGION = 40;

/**
 * How tall the closed secondary region should be, cut on a ROW boundary.
 *
 * A half-clipped line of red "1 failed" reads as a rendering defect and not as an
 * invitation to scroll (design D2, UX U1), so the region shows a whole number of the
 * rows it holds. `heights` are the rows' measured heights in display order; the result
 * is the tallest prefix that fits `cap` (after reserving `cue` for the "+N more" line
 * when something is hidden), never less than the first row's own height — and when the cap is too small to hold a
 * line, nothing is shown (height 0) only if the cap is under `COMPACT_MIN_REGION`.
 * `hidden` is how many rows that leaves below the fold.
 */
export const snapRegion = (
	heights: readonly number[],
	cap: number,
	cue: number,
): { height: number; hidden: number } => {
	const rows = heights.filter((height) => height > 0);
	const total = rows.reduce((sum, height) => sum + height, 0);
	if (total <= cap) return { height: total, hidden: 0 };
	const usable = Math.max(0, cap - cue);
	let height = 0;
	let shown = 0;
	for (const row of rows) {
		if (height + row > usable) break;
		height += row;
		shown += 1;
	}
	/* The FIRST row is shown whole whenever the cap can hold it, cue or no cue. A roster
	 *  header whose clauses wrap (12 failed, 2 parked, 1 running at 200 %) is one tall
	 *  row; cutting it to fit the cue's line sliced "1 running" through its glyphs, the
	 *  exact half-line defect this function exists to prevent. The cue may then push the
	 *  region a line past its share, which costs the transcript less than a clipped
	 *  status costs the reader. Only a first row taller than the whole cap is cut. */
	if (shown === 0) {
		/* A cap too small to hold even a readable line shows nothing: a clipped
		 *  sliver of one row plus a cue taller than the sliver is the half-line defect
		 *  this function exists to prevent (UX U3: a 7 pt region and a 38 pt cue in a
		 *  200 pt keyboard-shortened window). Height 0 with everything hidden tells the
		 *  screen to render neither region nor cue; the transcript gets the room. A
		 *  first row taller than a cap that CAN show a line is still cut at the cap and
		 *  stays scrollable. */
		if (usable < COMPACT_MIN_REGION) return { height: 0, hidden: rows.length };
		return {
			height: Math.min(rows[0] ?? 0, cap),
			hidden: rows.length - 1,
		};
	}
	return { height, hidden: rows.length - shown };
};

/**
 * The order of the session's secondary status rows.
 *
 * Wide: the order the column has always had (tasks, subagents, working line; the
 * status strip sits above the transcript, outside this region).
 * Compact: the region is short and cuts on a row boundary, so what survives the cut
 * has to be what a reader needs first. The live activity leads; but a roster with a
 * FAILED or PARKED child outranks it, because that is the row a reader would
 * otherwise miss (design D2, UX U1/U3). The status strip (context, cost) follows the
 * live rows and precedes the tasks list — it is one short row of information that a
 * reader checks more often than a task list they have already seen.
 */
export type RegionKey = "working" | "subagents" | "todos" | "strip";

export const regionOrder = (
	compact: boolean,
	rosterNeedsAttention: boolean,
): RegionKey[] =>
	compact
		? rosterNeedsAttention
			? ["subagents", "working", "strip", "todos"]
			: ["working", "subagents", "strip", "todos"]
		: ["todos", "subagents", "working"];

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

/**
 * How the compact composer's height budget is spent, in order of what must never leave
 * the screen: the receipt line (model/effort chips), the dictation row while it shows, and the field
 * row's touch floor are RESERVED first; the extras (attachments, alerts, the disabled reason) then take what
 * they naturally need out of what is left, and the field's ceiling is the remainder.
 *
 * Why a function: with the field and the extras in one scroller a 3-line draft at 200 %
 * pushed Send off a 390 pt screen (UX U1). Send, Stop and Attach live in the field's row
 * and the chips on the receipt line, so as long as `receipt + field + padding` fits the
 * budget they cannot scroll away. `field` is a hard ceiling for the textarea: past it the
 * FIELD scrolls its own text, never the controls beside it. `extras` is the extras
 * scroller's ceiling: past it THEY scroll, never the field row.
 */
export const composerBudget = (
	maxHeight: number,
	receiptHeight: number,
	extrasNatural: number,
	touchFloor: number,
	padding: number,
	/** The dictation row's box plus its margin while it is showing, else 0. It is part of
	 *  the pinned `main` fragment, so it is reserved with the receipt line; without it a
	 *  recording take pushed the composer past its share (reviewer m3). */
	dictationReserve = 0,
): { field: number; extras: number } => {
	const room = Math.max(
		touchFloor,
		maxHeight - receiptHeight - padding - dictationReserve,
	);
	const extras = Math.min(extrasNatural, Math.max(0, room - touchFloor));
	return { field: Math.max(touchFloor, room - extras), extras };
};
