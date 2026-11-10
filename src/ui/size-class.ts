import { maxColumnWidth } from "@/ui/column";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { LAYOUT, TOUCH_TARGET } from "@/ui/tokens.gen";
import { FIELD_BORDER_Y } from "@/ui/variants";

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
 *  `layout.sidebar = { max: 400, min: 240 }` (the sliver is the platform touch
 *  floor, which the token set already carries as `TOUCH_TARGET`). --- */

/** The panel's ceiling, phone and tablet alike (design spec 2026-11-06 § 4).
 *
 *  It replaced Material's 280 pt mobile cap, which the operator read as a
 *  cramped list ("the drawer being slightly wider to show more of the
 *  conversations", build 453): at 280 the panel was 69.7 % of a 402 pt phone and
 *  the title column 247 pt. The ceiling is what binds in landscape and on a
 *  tablet, so a wide screen keeps a list-width panel instead of a half-screen
 *  sheet of rows; on every portrait phone below 444 pt (iOS) / 448 pt (other)
 *  the sliver binds first.
 *
 *  400, NOT the spec's 360: at 360 the ceiling rather than the sliver would bind
 *  on the larger iPhones (440 − 44 = 396), spending title width on a cap with no
 *  reason behind it. The ceiling is the smallest round value above every current
 *  iPhone's `vw − sliver` that still keeps a tablet's panel list-width. */
export const SIDEBAR_TABLET_MAX = 400;

/** The floor, so a narrow phone's panel still fits its rows' skeletons. */
export const SIDEBAR_MIN_WIDTH = 240;

/**
 * The panel's width for a viewport: `min(400, vw − touchFloor)`, floored at 240.
 *
 * The page left visible beside the panel (the "sliver") IS the platform touch
 * floor — 44 pt on iOS, 48 elsewhere — not a fixed 28. On iOS the scrimmed
 * sliver is the only ONE-HANDED way to close the drawer: the header ✕ is out of
 * thumb reach, there is no Escape or system Back, and the drawer has no
 * swipe-to-close. A 28 pt strip was a sub-floor close target (UX round 1 U1,
 * code M1, design D2), so the sliver is sized as a target, not as a visual cue;
 * the scrim's dim and the panel's overlay shadow do the "the page is still there"
 * work (the panel is borderless since TestFlight 578).
 *
 * `touchFloor` is a parameter rather than an import because this module must not
 * touch `react-native` (see the file header): the caller passes `TOUCH_FLOOR` from
 * `layout.ts`, and the tests pass both platforms' values from `touchFloorFor`.
 *
 * iOS (44): 402 pt phone → 358 (89 %); 440 → 396; 390 → 346; 320 → 276.
 * Other (48): 402 → 354; 320 → 272. The ceiling binds from 444 / 448 pt up: an
 * 844 pt landscape phone → 400 of SAFE content, which the drawer widens by its
 * left inset (59 pt → a 459 pt panel, a 385 pt page beside it; with no inset,
 * 400 and 444). The 240 floor binds below 284 / 288 pt, where the sliver gives
 * way to a usable list.
 */
export const sidebarWidthFor = (
	viewportWidth: number,
	touchFloor: number,
): number =>
	Math.max(
		SIDEBAR_MIN_WIDTH,
		Math.min(SIDEBAR_TABLET_MAX, viewportWidth - touchFloor),
	);

/** The FIVE-destination pane height below which the pinned routes starve the list.
 *
 * MEASURED, not chosen. At 320 × 568 / 200 % with the inbox as a sixth
 * destination the sidebar's own chrome is 140 pt above the list and the pinned
 * routes are 368 pt, so the list was left 60 pt against its own 185 pt of content
 * — a 46 pt section header plus a 139 pt row — and the first row sat entirely
 * below the list's viewport. The consequence was not cosmetic: `S15/ended` and
 * `S15/populated` are distinguished ONLY by that row's meta line, so both cells
 * photographed identically and the capture refused the run (`iPhone SE`,
 * 2026-10-27, run 40438251913; the same cells are distinct on main, which has one
 * destination fewer).
 *
 * 568 IS THE FIVE-ROUTE FLOOR, i.e. main's own behaviour: 140 + 185 + the five
 * destinations' 243 pt of routes fit 568 exactly. The six-route floor is 628
 * (`PINNED_ROUTE_ROW` adds the sixth), not the 693 the six-route arithmetic gives
 * — the list needs ONE row, and 628 leaves it the 136 pt a section header plus a
 * row measures, which is the same standard main is held to. The 693 figure in the
 * paragraphs above is the sum the measurement produced, not a threshold.
 */
export const PINNED_ROUTES_BASE_FLOOR = 568;

/** One destination row at the 200 % step: the rail's six destinations measured
 *  368 pt, about 61 pt each including the grid's gaps. */
const PINNED_ROUTE_ROW = 60;

/** The pane height the pinned routes need with `routes` destinations at large text.
 *
 *  THE FLOOR FOLLOWS THE COUNT, deliberately: the sixth destination is what starved
 *  the list (measured above), so a relay that does not advertise the inbox has five
 *  and must see NO change — a rule that fired at five would take the pinned routes
 *  away from every short portrait phone on an older relay, which is the regression
 *  review round 7 named (R7-01).
 *
 *  The same conservative floor also protects short panes with six or more
 *  destinations at ordinary text sizes. The current rail includes a wrapping
 *  Team Bridge caption and connection status: actual 320×568 captures at 100%
 *  and 135% left zero list height despite the 200% path already scrolling.
 *  Text size is therefore not proof that this richer footer fits. Keeping one
 *  pre-paint route budget avoids a measured-layout toggle/reflow; ordinary
 *  five-route relays retain their previous pinned behavior.
 *
 *  `layout.height` is the VIEWPORT height, not the pane's. On native the safe-area
 *  insets come out of the pane, so a phone a little above the floor (780 with a
 *  large top inset, say) can still be short of the height the derivation needs. The
 *  floor is therefore a LOWER BOUND, and the margin it leaves is the inset budget
 *  rather than slack (code review round 7, R7-03).
 */
export const pinnedRoutesPaneFloor = (routes: number): number =>
	PINNED_ROUTES_BASE_FLOOR + Math.max(0, routes - 5) * PINNED_ROUTE_ROW;

/** Whether the stacked secondary routes scroll WITH the list instead of being
 *  pinned beneath it.
 *
 * Short landscape cannot keep them pinned, nor can a short portrait pane whose
 * richer footer exhausts the route budget. Large text has always used this
 * floor; six-or-more-route footers must use it at ordinary text sizes too.
 * Otherwise the smaller-text setting can make a list less reachable than 200%.
 *
 * A PREDICATE, deliberately: switching this after measuring the list would move
 * the footer on the second paint, and the capture's own check ("frames that
 * changed after first paint") would then be measuring a layout that is no
 * longer the one the reader saw first. Portrait and roomy tablet layouts keep
 * their pinned footer; scrolling the routes with the list preserves text scaling
 * and target sizes. */
export const sidebarFooterScrolls = (
	layout: Layout,
	options: { largeText?: boolean; routes: number },
): boolean => {
	if (layout.split) return false;
	if (layout.orientation === "landscape") return true;
	if (options.largeText !== true && options.routes <= 5) return false;
	return layout.height < pinnedRoutesPaneFloor(options.routes);
};

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

/**
 * The width below which the COMPUTERS header stacks, for the controls it carries.
 *
 * PR #122 gave the header "Switch computer" (U5: a bare "Switch" beside "Refresh"
 * did not say what it switches), and at the kit floor the cluster then out-grew
 * the line: at 390 pt with Back, the title measured 99 px of box for 138 px of
 * text and rendered "Comp…", and every width from the 354 floor to ~430 clipped it
 * the same way (design round 2, D10; UX U13). The sessions screen solved the same
 * failure with a measured fit (`headerStackWidth`), so this is that pattern for
 * this cluster rather than a shorter label (the label is the U5 fix).
 *
 * The pieces are the round-2 frames' readings at 100 % text:
 *
 * | piece                                         | measured |
 * |-----------------------------------------------|----------|
 * | row paddings (16 + 16)                        | 32       |
 * | each 8 dp gap between the header's children   | 8        |
 * | Back (`sm`)                                   | 52       |
 * | "Switch computer" (`sm`)                      | 119      |
 * | Refresh (`sm`) plus its 4 dp cluster gap      | 72       |
 * | "Computers" at the `display` step             | 138      |
 * | "Set up a computer" at the `display` step     | 227      |
 *
 * Consistency checks against the same frames: with Back, Switch and Refresh the
 * fit is 32 + 52 + 8 + 138 + 8 + 119 + 72 = 429, and the title measured 99 of 138
 * at 390 (390 − 291) and 139 of 139 at 430 — both reproduced; under a 401, with
 * Refresh hidden, 390 measured 170 of 170 (fit 357). "Set up a computer" was not
 * in a frame: its 227 is the bundled Figtree SemiBold's advance widths at 28 dp
 * with the step's −0.02 em tracking, the same computation that gives "Computers"
 * 137.8 against its measured 138. The kit floor still applies beneath, so no
 * lighter header stacks earlier than the reviewed behaviour.
 */
export function computersHeaderStackWidth(input: {
	title: "Computers" | "Set up a computer";
	back: boolean;
	switcher: boolean;
	refresh: boolean;
}): number {
	const GAP = 8;
	let width = 32 + (input.title === "Computers" ? 138 : 227);
	if (input.back) width += 52 + GAP;
	/* The cluster, when it renders, is one more header child: one more gap. */
	if (input.switcher || input.refresh) width += GAP;
	if (input.switcher) width += 119;
	if (input.refresh) width += input.switcher ? 72 : 68;
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
	/* The extras get what the field's floor leaves, and NOTHING more — not even
	 *  for a failure notice. Round 2 gave the notice a floor of one touch row
	 *  out of a budget that could not hold it, and the composer then overspent
	 *  its bound by up to 44 px in windows 120-163 px tall below its top (code
	 *  #211 R3 M1): the controls row, which is what the bound exists to keep on
	 *  screen, was what left it. The notice scrolls in whatever is left; the
	 *  collapse that floor was guarding against (a 44 px limit from a stale
	 *  box, UX U1) is prevented at its cause by `heldComposerLimit`. */
	const extras = Math.min(extrasNatural, Math.max(0, room - touchFloor));
	const fieldBox = Math.max(touchFloor, room - extras);
	/* `field` is the CONTENT cap the Textarea receives (`maxHeightPx`), and the field
	 *  paints a border box: its height is that cap plus `FIELD_BORDER_Y` (U-07's fix).
	 *  Returning the box here made the composer overspend its share by the border, so
	 *  the paint budget is converted once, here, where it is decided — the caller and
	 *  the component then agree without either subtracting a constant of its own. */
	return { field: fieldBox - FIELD_BORDER_Y, extras };
};

/** Native iOS keeps the full window while the dock moves above the keyboard;
 * Android may resize it instead (overlap then is zero). Budget the WHOLE dock
 * against that remaining space, not just the textarea. The existing 8pt dock
 * gap lives outside its box. The caller intersects this with any tighter limit. */
export const composerKeyboardLimit = (
	windowHeight: number,
	keyboardOverlap: number,
): number => Math.max(TOUCH_TARGET.ios, windowHeight - keyboardOverlap - 8);

/**
 * The composer's ceiling from WINDOW geometry, or `null` when it already fits.
 *
 * Portrait phones have no short-landscape budget, so a six-line draft at 200 %
 * text grew the composer past the window bottom (design recheck D-c: surface
 * [12, 314.4, 296, 424.8], bottom 739 against a 568 pt window) — the field, the
 * chips and the action row were all unreachable.
 *
 * The rule is deliberately "overflow OR already at the window", not "always
 * window - top": the composer is bottom-anchored while it fits, so `top =
 * bottom - height` makes `window - top` an identity that can never let it grow,
 * and measuring it while EMPTY froze a long draft at two lines (observed at
 * 320 pt / 100 %: field 60 px against a 132 px cap). Here an unbounded pass may
 * grow until its painted bottom reaches the window; only then does the ceiling
 * bind. A one-pixel tolerance absorbs the integer rounding of both numbers.
 *
 * INVARIANT: the overflow decision must not depend on the output it controls.
 * The capped box does NOT sit on the edge: the composer spends the limit minus
 * its outer gap (`composerHostBound`), so a capped box ends exactly where a
 * bottom-anchored box that fits ends — `window - gap`. Geometry alone cannot
 * tell the two apart, and deciding from the capped height unbound the composer
 * on the very next measure, which regrew it past the window, which rebound it
 * (QA #206 round 3 Q3: 1011 / 639 px oscillating with no input at 390x844).
 * `capped` is the intrinsic fact instead: the composer is at its cap only when
 * its content wants at least the cap (`rendered = min(natural, cap)`), so while
 * it holds the answer stays the same, and the limit lets go only once the
 * content shrinks below the cap — when the unbound box genuinely fits.
 */
export const composerLimit = (
	viewportHeight: number,
	top: number | null,
	height: number | null,
	capped = false,
): number | null => {
	if (top === null || height === null) return null;
	const overflows = capped || top + height >= viewportHeight - 1;
	if (!overflows) return null;
	/* The floor is the SMALLEST target the kit allows, not a share: a limit below
	 *  one control would collapse the composer rather than bound it. */
	return Math.max(TOUCH_TARGET.ios, Math.round(viewportHeight - top));
};

/** The box height the composer spends under a host `limit`: the limit is measured
 * to the window bottom, and the dock's outer gap (`composerOuterGap`) lives below
 * its box, so the box gets the limit minus that gap, never under one control. */
export const composerHostBound = (
	limit: number,
	gap: number,
	floor: number,
): number => Math.max(floor, limit - gap);

/** Whether the composer's measured box is held by the host limit — the `capped`
 * input of `composerLimit`. Only the HOST limit counts: the keyboard budget
 * (`composerKeyboardLimit`) is computed from window and keyboard geometry alone,
 * never from a measurement, so it cannot feed back; a box held by it is not
 * reported as capped, and the host limit then releases with nothing changing,
 * because the keyboard bound is the tighter of the two either way. The same
 * one-pixel rounding tolerance as `composerLimit`. */
export const composerAtHostCap = (
	height: number,
	limit: number | null,
	gap: number,
	floor: number,
): boolean =>
	limit !== null && height >= composerHostBound(limit, gap, floor) - 1;

/**
 * Whether the one-row status tray is painted. In short landscape it yields to a
 * pending approval or ask: that surface is pinned beside the composer and its
 * Approve/Deny (or Submit) controls are `shrink-0` at the touch floor, so the card
 * can only give up its scrolling body. At 844x390 the column is 338 pt without the
 * tray (header 52); the composer (125) + the card's pinned header, 56 pt body floor
 * and controls (205) + the wrapper's 4 leave nothing, so the 48 pt tray row #118
 * added pushed the pinned controls UNDER the composer at 200 % text (measured: the
 * Approve/Deny boxes at y 246-294 beneath a composer starting at y 260).
 *
 * The old inline region was already hidden for the same reason (UX U12: "a whole
 * region or none; the roster comes back the moment the decision is made") — the tray
 * replaced it without inheriting that rule. A portrait phone is tall enough to keep
 * the tray beside the card, so only `compact` yields.
 */
export const statusTrayVisible = (
	tray: boolean,
	compact: boolean,
	decisionPending: boolean,
): boolean => tray && !(compact && decisionPending);

/**
 * Which secondary-status surface a session screen uses — ONE decision, three
 * consumers, so the tray, the sheet and the inline region cannot disagree (design D2,
 * final visual audit).
 *
 * `phone` is a WIDTH question (`< tabletBreakpoint`), not `compact`: 430/390/360 are
 * phones, 1024 is not, and `compact` means short-landscape chrome. Gating the tray on
 * `compact` was the defect — a portrait phone is not short, so the old persistent
 * task/subagent bands stayed on the very screen the design fixed.
 *
 * `inlineSecondary` keeps the capped scroller exactly where it was designed: short
 * landscape (its rows and cue) and tablet (plain siblings). A portrait phone shows
 * the tray instead and must not ALSO render the old stack.
 */
export const sessionStatusLayout = (
	width: number,
	compact: boolean,
): {
	phone: boolean;
	tray: boolean;
	inlineSecondary: boolean;
	statusSheet: boolean;
} => {
	const phone = width < LAYOUT.tabletBreakpoint;
	return {
		phone,
		/* Short landscape ALREADY had the tray (that is where it was designed), so it
		 * keeps it: `tray` is phone-or-compact, and the sheet follows the tray. The
		 * inline stack belongs only where neither holds — a tablet column. Gating the
		 * tray on `phone` alone regressed landscape into a tray plus a live inline
		 * region plus a sheet nothing could open (review R8-1). */
		tray: phone || compact,
		inlineSecondary: !phone && !compact,
		statusSheet: phone || compact,
	};
};

/** The composer's painted box as its host holds it: `composerLimit`'s inputs,
 * plus the WINDOW the box was measured in. `top` is a window coordinate, so it
 * means nothing against any other window size (see `heldComposerLimit`). */
export type ComposerBox = {
	top: number;
	height: number;
	capped: boolean;
	viewportWidth: number;
	viewportHeight: number;
};

/**
 * Whether a published composer measurement is the one the host already holds.
 *
 * The composer publishes a fresh object on every layout pass, so identity says
 * nothing; the fields are the whole value. The host uses this to keep its
 * previous state object when nothing moved, which is what stops a no-op
 * measurement re-rendering the session screen (perf audit P15). It compares and
 * nothing else: it must never round, clamp or merge, because `composerLimit`
 * reads `capped` and the exact `top`/`height` to decide whether the cap holds,
 * and a tolerance here would be a second, different rule about the same box.
 * The window is part of the value: the same numbers measured in another window
 * are a different fact, and treating them as "unchanged" would keep a box that
 * `heldComposerLimit` has to throw away.
 */
export const sameComposerBox = (
	previous: ComposerBox | null,
	next: ComposerBox,
): boolean =>
	previous !== null &&
	previous.top === next.top &&
	previous.height === next.height &&
	previous.capped === next.capped &&
	previous.viewportWidth === next.viewportWidth &&
	previous.viewportHeight === next.viewportHeight;

/**
 * The host limit for the box the screen HOLDS, in the window it has NOW.
 *
 * The held box is a measurement from an earlier render. While the window keeps
 * its size that is fine (`composerLimit`'s loop settles on it), but after a
 * resize the box's `top` is a coordinate in a window that no longer exists.
 * Shrinking 390x844 to 320x568 left the empty composer's top (about 714) below
 * the new window bottom, so `composerLimit` read "overflowing" and answered its
 * floor, one control (44); the composer painted that, reported `capped` (its
 * content does want more than 44), and `capped` then HELD the collapsed size:
 * limit = window - top = the collapsed box's own height + gap, a fixed point.
 * A failed send in that state gave its notice an extras budget of zero (UX #211
 * U1: the scroller measured 342x0, nothing visible, until the window grew back).
 * The Android resizing keyboard and rotation are the same change.
 *
 * So a box from another window is no measurement at all: the answer is `null`
 * ("unbound") until the composer re-measures in this one, exactly the first-
 * paint state. That keeps #206's invariant — the reset is keyed on the window
 * size alone, an input the limit never controls, so it cannot loop.
 */
export const heldComposerLimit = (
	box: ComposerBox | null,
	viewport: { width: number; height: number },
): number | null => {
	const live =
		box !== null &&
		box.viewportWidth === viewport.width &&
		box.viewportHeight === viewport.height
			? box
			: null;
	return composerLimit(
		viewport.height,
		live?.top ?? null,
		live?.height ?? null,
		live?.capped ?? false,
	);
};

/**
 * The part of the composer's re-measure key that says "what sits above me
 * changed height", built from the heights the session screen already measures.
 *
 * WHY IT EXISTS (QA #211 round 3 Q5). The composer's ceiling is `window - top`,
 * and it only re-reads `top` when something tells it to: its own box changing
 * size (the dock's `onLayout`), the limit or the window changing, or this key.
 * A composer that is PUSHED — same size, new top — matched none of those. The
 * activity band above it takes its height from a shared value set in its own
 * `onLayout`, outside React, so after a window resize it lands a frame or more
 * after the composer measured, and on the web `onLayout` is a ResizeObserver
 * that never fires for a move. Two orders of that race, both measured at
 * 320x568 / 200 % with a long draft: the one measurement in the new window saw
 * a composer that still fit, the limit stayed unbound and the box ended at 635
 * in a 568 pt window; or it bound against the early top and the cap then held
 * while the box slid down, 615. Send and Attach were below the window in both.
 * Main never showed it only because it kept reading the stale pre-resize box
 * (the U1 defect `heldComposerLimit` removed), so it never needed the re-read.
 *
 * `before` is the pending card's y and `after` the height of the band between
 * the transcript and the composer (`RecoveryFacts`): everything in the column
 * that can change height under the composer without the composer's own size
 * changing. Discrete changes above it (find bar, panels, sheet) are the rest
 * of the key and stay with the caller.
 *
 * #206's invariant holds: this decides WHEN to measure, never what the
 * measurement says, and neither fact is sized by the composer's limit, so a
 * re-measure cannot change the key that asked for it.
 */
export const composerChromeKey = (facts: {
	before?: number;
	after?: number;
}): string => `${facts.before ?? ""}/${facts.after ?? ""}`;
