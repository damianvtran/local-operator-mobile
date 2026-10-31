import { healthLabel } from "@/features/session/health";
import { MIN_HEADER_NAME_CHARS } from "@/features/session/projection";
import { maxColumnWidth, type Viewport } from "@/ui/column";
import { headerStacks } from "@/ui/size-class";

/**
 * How many characters of the conversation name the session header can actually
 * show, so the truncation keeps BOTH ends instead of letting CSS eat the tail.
 *
 * `middleTruncate(title, 40)` was the rule this screen shipped with, and it never
 * ran for any real name: 40 characters is wider than a phone's header row, so a
 * 25-character name was handed to the layout whole and the platform clipped its
 * END — `Refactor th…` at 390 pt, `Refact…` at 320 (design round 1, D2). The
 * distinguishing part of a session name is its tail, which is exactly what an end
 * clip removes, so the budget has to come from the space the header really has.
 *
 * The row is `Screen`'s: `h-14 px-4 gap-2` with the leading control and the
 * title's siblings. Measured in installed headless Chrome at 320 pt (the narrowest
 * device the kit names), the h1's box was exactly `width − 32 − 44 − 8 − 127`: the
 * 16 pt gutters, the 44 pt back control, the row's 8 pt gap, and a 127 pt status
 * chip that used to sit beside it. The chip has moved into the status strip (D8),
 * so only the chrome above remains — and this module's whole job is to not be the
 * thing that yields to a status chip again.
 *
 * **The FIND LEVER is the row's second control now and it is chrome like any
 * other.** The D8-era arithmetic dropped the chip from the sum, and when the
 * find lever landed in the same slot its own comment argued an icon "cannot clip
 * the middle truncation's budget" — measured on the 2026-10-11 full-surface
 * pass, it can and did: the h1's real box on the web build is
 * `width − 32 − 48 − 8 − 48 − 8` (both controls at the web build's 48 pt
 * `IconButton` size, plus each one's 8 pt gap), while the budget still claimed
 * the chip's 127 pt back. The truncation therefore over-promised by ~50 pt at
 * every phone width and the platform re-clipped the tail it had just preserved —
 * every phone-sized session cell in that pass drew TWO ellipses (`Hello from…k
 * prov…` and `Refactor t…lay cli…` at 390, `Refactor the…elay cli…` at 430): the
 * exact D2 relapse this module exists to prevent. 48 pt is the widest platform's
 * box (web), so the constant stays honest for both platforms rather than
 * narrowing it on iOS — and the BACK control counts at the same 48, not the 44 an
 * earlier revision of this sum used: the pass's own U-07 rows measured the h1's
 * box at `width − 144` at every phone width, so a constant summing to 140 was a
 * box 4 pt wider than the row has (review round 1, F1). The budgets both sums
 * produce are pinned in `header.test.ts`.
 *
 * The samples and the defect: `docs/ux/audits/2026-10-11-full-surface-pass.md`.
 */
const HEADER_GUTTERS_PT = 32;
/* The leading cluster is `Screen`'s `headerLeading`, and the session screen's
 * is `<View className="flex-row items-center gap-1">` holding the back
 * `IconButton` and the `NavigationMark` from #118. The budget used to count only
 * back + gap (48 + 8), so it promised ~32 pt the row does not have — slack the
 * advance estimate used to absorb until the ⋮ arrived (review round 2 R2-M1,
 * design D1, QA Q7: an ended title at 390 pt measured 164 px in a 158 px box and
 * the platform clipped the tail the middle truncation had kept).
 *
 * These are the SAME constants the components render with, not a second copy of
 * their values: `NAVIGATION_MARK_PT` is `NavigationMark`'s own default `size`,
 * `LEADING_GAP_PT` is the `gap-1` on that cluster, and the 48s are the web
 * `IconButton` box the find lever and the back control both take. If the cluster
 * changes, this sum is the one place that must move with it. */
const NAVIGATION_MARK_PT = 28;
const LEADING_GAP_PT = 4;
const HEADER_CHROME_PT =
	HEADER_GUTTERS_PT + 48 + LEADING_GAP_PT + NAVIGATION_MARK_PT + 8 + 48 + 8;

/**
 * **The session-health control's own chrome on the TITLE line** (review round 1
 * M1, design D1, QA Q7 — the same D2 relapse this module exists to prevent:
 * the header gained the dot and the ⋮ and this sum did not move, so the title
 * was middle-truncated for a box ~72 pt wider than it had and the platform
 * clipped the tail again).
 *
 * - `dot` — the LIVE state draws its dot inline before the name: an 8 pt dot
 *   plus the control's 8 pt gap. Every other state draws its dot on the state
 *   line UNDER the name (beside the state word), which costs height, not width.
 * - `menu` — the ⋮ renders only while it has an item (Resume, so: ended): the
 *   kit's 48 pt `IconButton` plus the cluster's 8 pt gap.
 *
 * Both default to absent, so every caller that passes no extras — and every
 * figure `header.test.ts` pinned before the dot — is unchanged.
 */
export type HeaderExtras = { dot?: boolean; menu?: boolean; word?: boolean };
/* Chrome is rem-spaced, so on web BOTH its width and the glyph advance scale
 * with the reader. On native the chrome is in pt and only the advance scales;
 * the caller passes `Platform.OS !== "web"` for that case. */
const HEALTH_DOT_PT = 8 + 8;
const HEADER_MENU_PT = 48 + 8;
const extrasPt = (
	{ dot = false, menu = false, word = false }: HeaderExtras = {},
	scale = 1,
): number =>
	((dot ? HEALTH_DOT_PT : 0) +
		(menu ? HEADER_MENU_PT : 0) +
		(word ? STATE_WORD_PT : 0)) *
	scale;

/**
 * The wrap margin the stacked case keeps back from the two-line clamp's
 * break-free capacity — two characters per line.
 *
 * Derived from the remediation's own audit catch, not taste: 20 characters (the
 * full break-free capacity at 2x on `iphone-se`) word-wrapped to three lines
 * and the clamp cut the tail; 16 characters of the same name (`Hello
 * fr…rovider`) holds two lines. The margin is stated once, here, so the next
 * reader can move it with the evidence rather than re-deriving it.
 */
const STACKED_WRAP_SLACK = 4;

/**
 * **Calibrated at 100 % text, and the 2× case is a known, deferred residue.**
 *
 * On this head the type ramp is px-based while spacing and control sizes are
 * rem-derived, so scaling the environment's root font to 32 px leaves every text
 * run the same height while the header's own chrome (the `px-4` gutters, the 44 pt
 * leading control) DOUBLES. Both terms above are then wrong in the generous
 * direction: the chrome is bigger than the constant says and the advance is
 * unchanged, so a 2× render can clip a name this budget thought would fit. It is
 * not fixed here because it is the same defect as the design lane's D1 — the type
 * layer is #11's (`scaledTextVariables`), and re-cutting it in this stream would
 * collide with that work.
 *
 * What the post-#11 head needs, so this is a re-derivation rather than a
 * rediscovery: a scale factor on BOTH terms — the chrome by the root font
 * (`rem`), the advance by the same factor once the type ramp is in rem — with
 * `PixelRatio.getFontScale()` as the native half, where the chrome is pt-based and
 * only the ADVANCE scales.
 *
 * On the WEB build the root font is the only signal for the chrome term, and
 * `PixelRatio.getFontScale()` cannot stand in for it: react-native-web 0.21.3
 * hard-codes `fontScale: 1` in `Dimensions`, so its `getFontScale()` returns the
 * constant 1 whatever the environment's text scale is (`1 || pixelRatio` — the
 * fallback never runs). A constant is not a signal. An earlier revision of this
 * comment said it returns the DEVICE pixel ratio (3 on a 3× display) and would
 * "divide this budget by three"; that was wrong, and it is corrected here rather
 * than dropped because the conclusion it supported still holds (review round 4,
 * R4).
 */

/**
 * The display step's advance in px per character, at 600 weight / 28 px — the
 * WIDEST per-character average measured across prose sample names in installed
 * headless Chrome at the shipped font: `13.34 / 12.26 / 13.14 / **14.06**` px per
 * character for four samples, with whole-string natural widths of 358 px for 28
 * characters and 307 px for 25. The value is the widest sample itself, not a
 * rounded-down neighbour: an earlier revision said "14" and called it the widest,
 * which was simply false (review round 4, R6), and the safety margin this divisor
 * is supposed to buy comes from being the maximum, not from the `floor` applied
 * after it.
 *
 * **What this does not cover, stated rather than implied:** the samples are Latin
 * prose. A name of wide glyphs — CJK (roughly 2× the Latin advance) or a run of
 * `W`s — exceeds this estimate, so its budget is generous and the platform's own
 * ellipsis trims the end. It never overflows the row, and the floor still holds,
 * so the failure mode is D2 for those names only (measured and accepted by QA
 * round 4 Q2). Covering them needs a real text measurement, which the web build
 * cannot give this component without a canvas.
 */
export const DISPLAY_ADVANCE_PT = 14.06;

/* THE STATE WORD BESIDE THE TITLE IN SHORT LANDSCAPE (review round 4, D15 /
 * QA N3). Since the Q9 fix the word rides the title's own row there, so it takes
 * width from the flex-1 title — and the budget did not charge it, so a non-live
 * compact title was middle-truncated to a length that did not fit and the
 * platform clipped the tail (measured: clientWidth 313 against scrollWidth 351
 * at 135 %). The price is the WIDEST word the control can say, charged in every
 * compact state — live included, where no word is drawn — so the title's
 * truncation is the same in every state and the name does not change shape when
 * the dot changes colour (D11). Derived from the catalogue's own words rather
 * than a magic number, and from the `meta` step the word is drawn in. */
const STATE_WORDS = [
	healthLabel("not_answering"),
	healthLabel("reconnecting"),
	healthLabel("ended"),
] as const;
const STATE_WORD_GAP_PT = 8; // the row's `gap-2`
/* One point of slack on top of the measured ink (design round 6, item 5): the
 * frame measures 79.22 pt for "Not answering", and a font-metric rounding must
 * not be able to eat the word's own price. The price is ceil((ink + 1) * 2)/2. */
const STATE_WORD_SLACK_PT = 1;
/* THE WORD'S OWN ADVANCE, MEASURED FROM A SHIPPED FRAME (design round 5, D16).
 * The previous price scaled the display step — `DISPLAY_ADVANCE_PT * 12/28 * 0.62`
 * = 3.74 pt per character — against a rendered 6.09: a 38 % under-charge, because
 * the small state word does not carry the display size's advance ratio. It left
 * "Not answered"/"Reconnecting" 11-15 pt past the title's box at 100 %, where the
 * middle ellipsis keeps the tail and the platform's own ellipsis then removes it
 * again — the double-cut class D1 fixed.
 *
 * Measured on the shipped bundle (844x390, dark, 100 %): the 13-character run is
 * 79.22 pt wide, i.e. 6.09 pt/char. This is a MEASUREMENT, not a derivation: if the
 * meta step's size or tracking changes, re-measure rather than re-scale this.
 * `header.test.ts` carries the same measured number as its guard, so a cheaper
 * price cannot ship green again. */
const META_ADVANCE_PT = 6.09;
export const STATE_WORD_PT =
	Math.ceil(
		(Math.max(...STATE_WORDS.map((word) => word.length)) * META_ADVANCE_PT +
			STATE_WORD_SLACK_PT) *
			2,
	) /
		2 +
	STATE_WORD_GAP_PT;
/** The widest state word the control can draw, for the guard that proves the
 *  price covers what renders. Exported so the test reads the SAME source the
 *  price derives from rather than re-listing the words. */
export const WIDEST_STATE_WORD = STATE_WORDS.reduce((wide, word) =>
	word.length > wide.length ? word : wide,
);

/**
 * The character budget for a viewport.
 *
 * The measure cap matters as much as the width: a 1366 pt tablet renders this
 * screen in a 640 pt column (`src/ui/column.ts`), and the header row is inside it,
 * so a budget computed from the viewport alone would promise ~90 characters and
 * clip at 30.
 *
 * The floor is the kit's own: `components.md` § F-6.1 owes at least
 * `MIN_HEADER_NAME_CHARS` characters so both ends of a name survive, so a budget
 * computed below it is raised to it rather than to zero.
 */
export const headerTitleChars = (
	{ width, height }: Viewport,
	extras: HeaderExtras = {},
	effectiveScale = 1,
	nativeChrome = false,
): number => {
	/* **Below the stack floor the header STACKS, and the title gets its own
	 * budget — bounded by the two lines it is allowed to draw.** `Screen` stacks
	 * when `headerStacks` says so (`src/ui/size-class.ts`); the width half of that
	 * predicate fires below `HEADER_STACK_WIDTH` (354), which is the session
	 * screen's case — it passes no `stackBelowWidth`. Stacked, the leading control
	 * sits on its OWN row above the title, so the title no longer shares its line
	 * with the back control or the find lever, and the single-line chrome sum above
	 * does not describe it: budgeting that way over-truncated a name the pre-fix
	 * frames rendered whole (`Release sweep` became `Releas…sweep` on `iphone-se`,
	 * ~110 pt of the 288 pt title box unused — QA round 1, Q1).
	 *
	 * **The first revision of this branch promised the row's FULL break-free
	 * capacity at 2x (20 characters at `iphone-se`) and the remediation's own audit
	 * re-drive caught it clipping**: the stacked title clamps at two lines
	 * (`numberOfLines={2}` — a cap, not a truncation point), a 2x line holds
	 * `floor((width − 32) / (2·advance))` = 10 characters break-free, and
	 * word-wrapped prose does not pack break-free — `Hello from…provider` (20
	 * characters) needed THREE lines at 2x, so the clamp cut its tail and drew a
	 * second ellipsis (`U-07: content 202px in a 134px box`, `S5/populated`,
	 * `iphone-se` 200 %). The usable budget is therefore the two clamped lines'
	 * break-free capacity MINUS a wrap margin of `STACKED_WRAP_SLACK` characters
	 * (two per line: a boundary can strand that much of a line's capacity before a
	 * space). At `iphone-se` that lands on the value the matrix's pre-fix strings
	 * rendered clean at every scale (16 — the pre-fix single-line arithmetic's own
	 * accident, and every se cell of run 2 audited clean at 2x), while still using
	 * more of the row than the single-line sum did. The scale half of
	 * `headerStacks` (> 1.4) deliberately does NOT change the budget: that case
	 * keeps the single-line arithmetic and the title wraps within its two permitted
	 * lines — the 2x residue this module documents above. */
	/* The branch is the SCREEN's predicate, not a width check of our own. `Screen`
	 * stacks on `headerStacks(effectiveScale, width)`, which fires on scale above
	 * 140 % as well as on a narrow viewport. A 390 pt phone at 200 % therefore
	 * STACKS — and the old `width < HEADER_STACK_WIDTH` test sent it down the
	 * inline formula, which then doubled the whole inline chrome the stacked title
	 * row does not even hold and collapsed the name to the 8-character floor
	 * (`Hell…der` where main gave 17). Regression against main, review round 2
	 * R2-M2 / design D1, and the tag-line header shares the same budget. */
	if (headerStacks(effectiveScale, width)) {
		/* Stacked, the ⋮ sits on the BACK row (`Screen`'s `stackedActionsBeside`),
		 *  never beside the title, so only the inline dot narrows the title's own
		 *  row. */
		const chromeScale = nativeChrome ? 1 : effectiveScale;
		/* THE ROW IS THE COLUMN, NOT THE VIEWPORT (CI run 40823746854, job
		 * 123288151628). The stacked title lives inside the content column, which
		 * is capped at `maxColumnWidth` (620 pt on a landscape tablet) — budgeting
		 * the raw viewport promised 68 characters where the rendered box holds 21
		 * per line, so at `tablet-landscape` 200 % a 65-character name needed three
		 * of its two permitted lines and the platform clipped the third
		 * (`content 202px in a 134px box`, U-04/U-07). `compactTitleChars` already
		 * caps; this branch did not. Below the cap the number is identical, so
		 * every phone cell keeps the budget it was proved with. */
		const row = Math.min(width, maxColumnWidth({ width, height }) ?? width);
		const titleRow =
			row -
			HEADER_GUTTERS_PT * chromeScale -
			extrasPt({ dot: extras.dot }, chromeScale);
		/* Two clamped lines at the ACTUAL scale, less the same wrap slack. The
		 *  previous budget hard-coded 2x and ignored the scaled dot/gutters; at
		 *  320/200% it promised 16 chars (2x14.06) while the dot row was left
		 *  with 16 fewer points than that, so the dot was pushed onto its own
		 *  line. The kit's 8-char floor still preserves both ends. */
		const perLine = Math.max(
			1,
			Math.floor(titleRow / (DISPLAY_ADVANCE_PT * effectiveScale)),
		);
		return Math.max(MIN_HEADER_NAME_CHARS, perLine * 2 - STACKED_WRAP_SLACK);
	}
	const row = Math.min(width, maxColumnWidth({ width, height }) ?? width);
	const chromeScale = nativeChrome ? 1 : effectiveScale;
	const available =
		row - HEADER_CHROME_PT * chromeScale - extrasPt(extras, chromeScale);
	return Math.max(
		MIN_HEADER_NAME_CHARS,
		Math.floor(available / (DISPLAY_ADVANCE_PT * effectiveScale)),
	);
};

/**
 * The character budget for the COMPACT (short-landscape) header, where the title is ONE
 * row at the `title` role (20 px) instead of the stacking `display` role (28 px).
 *
 * `headerTitleChars` assumes the display advance and, above the stack width, a title
 * that never grows past one line at 100 %. In compact the title is scaled by the
 * reader's text size and never stacks, so a budget that ignores both promised ~33
 * characters on a 915 pt screen at 200 % where the row holds ~23: `middleTruncate` ran,
 * then the row's own ellipsis clipped the end as well and the tail — which middle
 * truncation exists to keep — was lost (design D4). The advance here is the display
 * advance scaled by the role ratio (20/28) and by the text scale.
 */
const TITLE_TO_DISPLAY = 20 / 28;
/* THE TITLE'S OWN ADVANCE IN THE COMPACT ROW, MEASURED (design round 6, D19).
 * The model was `DISPLAY_ADVANCE_PT * 20/28` = 10.04 pt per character, but the
 * shipped run renders 9.40: promising 10.04 while 9.40 is what paints promised
 * ~5 more characters than the row can show at 135 %, which is the wide gap the
 * frame measured. Same rule as `META_ADVANCE_PT`: a measurement, not a
 * derivation — re-measure if the title step changes. */
const COMPACT_TITLE_ADVANCE_PT = 9.4;
export const compactTitleChars = (
	{ width, height }: Viewport,
	effectiveScale: number,
	extras: HeaderExtras = {},
	nativeChrome = false,
): number => {
	const row = Math.min(width, maxColumnWidth({ width, height }) ?? width);
	const chromeScale = nativeChrome ? 1 : effectiveScale;
	const available =
		row - HEADER_CHROME_PT * chromeScale - extrasPt(extras, chromeScale);
	const advance = COMPACT_TITLE_ADVANCE_PT * Math.max(1, effectiveScale);
	return Math.max(MIN_HEADER_NAME_CHARS, Math.floor(available / advance));
};
