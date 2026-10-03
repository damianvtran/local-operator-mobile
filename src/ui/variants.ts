/**
 * The design system's decision table.
 *
 * Every `variant × size × state → class names` decision lives here as a pure
 * function, and the components only render what these return. That split is not
 * stylistic: it is what makes the primitives testable in Node. A component that
 * computes its own classes can only be checked by rendering it, which needs React
 * Native; a function can be checked with `pnpm test`, and the class names are
 * exactly where the design kit's rules are easy to get quietly wrong.
 *
 * The rules these functions encode come from docs/design/components.md § 0-§ 11:
 *
 *   - A component names a ROLE, never a hue. No hex, no `bg-[#…]`, ever.
 *   - Disabled is a colour change, never an opacity change — an opacity-faded
 *     control also fades its ground, so the same button on `surface` and on
 *     `sunken` ends up two unspecified colours.
 *   - Pressed is a colour step, never a scale. A 0.97 scale is the clearest tell
 *     of a web view in a shell.
 *   - Every control's border is always present, so switching variant never
 *     changes the box size.
 *   - Touch floors are 44pt/48dp (`tokens.json § size.touchTarget`); a visually
 *     smaller control gets hit slop, never a smaller target.
 *
 * Class names resolve through the generated token layer (src/ui/theme.css), so
 * `bg-surface` is the `surface` role in whichever theme is active. A class the
 * kit does not define does not exist — Tailwind emits nothing for it and the
 * component renders unstyled with no error, which is why a typo here is a visual
 * defect rather than a build failure.
 */

/** Join class names, dropping falsy entries. Local by design: `clsx` is not in
 * the shared dependency set, and this is all of it that the app needs. */
import { TOUCH_TARGET } from "@/ui/tokens.gen";

export const cx = (
	...parts: Array<string | false | null | undefined>
): string => parts.filter(Boolean).join(" ");

/**
 * The touch floor, as a RULE rather than as a number.
 *
 * There were two constants called `TOUCH_FLOOR` in this kit — this one at 44, and
 * `layout.ts`'s platform-aware 48-on-web/Android — which is the shape that has
 * already bitten it once: a control importing the wrong one is a 44 pt target on the
 * build the audit measures. The rule lives here, where a Node test can read it
 * (`layout.ts` imports `react-native`, so no unit test may import it), and
 * `layout.ts` is the only thing that reads the platform.
 */
export const touchFloorFor = (platform: "ios" | "other"): number =>
	platform === "ios" ? TOUCH_TARGET.ios : TOUCH_TARGET.android;

export type ControlState = {
	pressed?: boolean;
	disabled?: boolean;
	busy?: boolean;
	selected?: boolean;
};

/** Hit slop that brings a smaller visual box up to the 44pt floor. The hit area
 * may never overlap another control's, so this is only used where the control
 * has at least 6pt of clear space around it. */
/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

export type ButtonVariant = "primary" | "outline" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "fab";

/**
 * Sizes, from components.md § 2. `sm` is the one place the 44pt floor is met by
 * slop rather than by the box, and it is limited to dense chrome.
 */
const BUTTON_SIZES: Record<ButtonSize, string> = {
	sm: "h-8 px-3 gap-1.5",
	md: "h-11 px-4 gap-2",
	// `lg` is 50pt (`tokens.json` size.controls.lg.height), the one height that is
	// not on the 4pt scale, so no `h-*` step exists for it. HAND-WRITTEN: changing
	// the token regenerates nothing here, and `BUTTON_VISUAL_HEIGHT.lg` below must
	// move with it.
	lg: "h-[50px] px-6 gap-2.5",
	icon: "h-11 w-11",
	fab: "h-14 w-14",
};

const BUTTON_TEXT: Record<ButtonSize, string> = {
	sm: "text-meta",
	md: "text-label",
	lg: "text-label",
	icon: "",
	fab: "",
};

/** Visual box height per size, so a caller can ask for the matching hit slop. */
/** The ink a DISABLED control's label uses.
 *
 * `ink-dim`, not `ink-disabled`: measured against every surface a disabled control
 * can sit on, `ink-disabled` reads 2.16-2.96:1 — under the 3:1 floor for large text
 * and well under 4.5:1 for a label, and a label NAMES the action. The state is
 * carried by the fill and the border, not by making the words unreadable.
 */
export const CONTROL_DISABLED_INK = "text-ink-dim";

export const BUTTON_VISUAL_HEIGHT: Record<ButtonSize, number> = {
	sm: 32,
	md: 44,
	lg: 50,
	icon: 44,
	fab: 56,
};

/**
 * Variant and state, from components.md § 2's table. `border` is always present
 * (transparent where the variant has none) so the box never resizes.
 */
const BUTTON_VARIANTS: Record<
	ButtonVariant,
	{ rest: string; pressed: string; disabled: string }
> = {
	primary: {
		rest: "bg-accent border-transparent text-on-accent",
		// `accent-active` — one further colour step, at `instant` (80ms).
		pressed: "bg-accent-active border-transparent text-on-accent",
		// Fill `sunken`, ink `ink-disabled`.
		disabled: `bg-sunken border-transparent ${CONTROL_DISABLED_INK}`,
	},
	outline: {
		rest: "bg-surface border-border-control text-ink",
		pressed: "bg-elevated border-border-control text-ink",
		disabled: `bg-surface border-hairline ${CONTROL_DISABLED_INK}`,
	},
	quiet: {
		rest: "bg-transparent border-transparent text-ink-muted",
		pressed: "bg-elevated border-transparent text-ink",
		disabled: `bg-transparent border-transparent ${CONTROL_DISABLED_INK}`,
	},
	danger: {
		rest: "bg-danger-wash border-danger-border text-danger",
		// "same fill, heavier border": the border takes the semantic ink, which is
		// the only step available without inventing a colour the kit does not have.
		pressed: "bg-danger-wash border-danger text-danger",
		disabled: `bg-transparent border-transparent ${CONTROL_DISABLED_INK}`,
	},
};

export const buttonClasses = (
	variant: ButtonVariant,
	size: ButtonSize,
	state: ControlState = {},
): string => {
	const base =
		"flex-row items-center justify-center rounded-sm border font-medium";
	const look = state.disabled
		? BUTTON_VARIANTS[variant].disabled
		: state.pressed
			? BUTTON_VARIANTS[variant].pressed
			: BUTTON_VARIANTS[variant].rest;
	return cx(base, BUTTON_SIZES[size], BUTTON_TEXT[size], look);
};

/* -------------------------------------------------------------------------- */
/* IconButton                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Same box as Button `icon` (44×44), transparent fill, `ink-muted` ink.
 *
 * The icon itself must never receive the pointer — a press that lands on the
 * glyph has to resolve to the button — which is why the component sets
 * `pointerEvents="none"` on the icon and the styles here stay on the control.
 */
export const iconButtonClasses = (
	state: ControlState = {},
	options: { outlined?: boolean } = {},
): string =>
	cx(
		"h-11 w-11 items-center justify-center rounded-sm border",
		// The border is `border-control` only where the icon does not carry the
		// affordance alone; transparent otherwise, so the box never resizes when a
		// caller opts in.
		options.outlined ? "border-border-control" : "border-transparent",
		state.disabled
			? `bg-transparent ${CONTROL_DISABLED_INK}`
			: state.pressed
				? "bg-elevated text-ink"
				: "bg-transparent text-ink-muted",
	);

/* -------------------------------------------------------------------------- */
/* Input and Textarea                                                         */
/* -------------------------------------------------------------------------- */

export type FieldState = "rest" | "invalid" | "disabled";

/**
 * `body` = 16pt, always: below 16, iOS zooms the page on focus and the layout
 * moves under the reader's thumb (components.md § 0.1, § 4).
 */
export const fieldClasses = (
	state: FieldState = "rest",
	options: { inComposer?: boolean } = {},
): string => {
	// Fill is `elevated` inside the composer and `surface` standalone.
	const fill = options.inComposer ? "bg-elevated" : "bg-surface";
	const base =
		"min-h-11 rounded-sm border px-3 py-2 text-body text-ink web:outline-none";
	switch (state) {
		case "disabled":
			return cx(base, `bg-sunken border-hairline ${CONTROL_DISABLED_INK}`);
		case "invalid":
			// "error is not a button state" but it IS a field state: the border takes
			// `danger` and the message sits adjacent in `body-sm`, never colour alone.
			return cx(base, fill, "border-danger");
		default:
			return cx(base, fill, "border-border-control");
	}
};

/** Auto-grow to six lines, then scroll. A field that grows without bound pushes
 * the transcript off the top of the screen (components.md § 4). */
export const TEXTAREA_MAX_LINES = 6;
export const TEXTAREA_LINE_PX = 22;
export const TEXTAREA_MAX_PX = TEXTAREA_MAX_LINES * TEXTAREA_LINE_PX;

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * An in-flow block. `hairline` is decorative — the 2.5–5 L* ground step is what
 * separates a card from the canvas — and elevation is a background step, never a
 * shadow (components.md § 5).
 */
export const cardClasses = (options: { inList?: boolean } = {}): string =>
	cx(
		"rounded-md border border-hairline bg-surface",
		options.inList ? "p-3" : "p-4",
	);

/* -------------------------------------------------------------------------- */
/* Badge and Chip                                                             */
/* -------------------------------------------------------------------------- */

export type SemanticTone =
	| "neutral"
	| "success"
	| "warning"
	| "danger"
	| "info";

const BADGE_TONES: Record<SemanticTone, string> = {
	neutral: "bg-accent-muted border-accent-border",
	success: "bg-success-wash border-success-border",
	warning: "bg-warning-wash border-warning-border",
	danger: "bg-danger-wash border-danger-border",
	info: "bg-info-wash border-info-border",
};

/**
 * A badge is NEVER interactive (components.md § 6). Making one a control would
 * turn its border-vs-own-fill pair into a 3:1 requirement it does not meet; a
 * static badge is exempt because it is resolved against the page.
 */
export const badgeClasses = (tone: SemanticTone = "neutral"): string =>
	cx("self-start rounded-sm border px-2 py-0.5 text-meta", BADGE_TONES[tone]);

/** The ink a badge's tone uses. Kept beside the fills so a new tone cannot be
 * added with a half-specified pair. */
export const badgeInkClasses = (tone: SemanticTone = "neutral"): string => {
	switch (tone) {
		case "success":
			return "text-success";
		case "warning":
			return "text-warning";
		case "danger":
			return "text-danger";
		default:
			// `accent-active` in light, `accent-hover` in dark — the pair the kit
			// specifies for ink on `accent-muted`. Expressed as a theme variant
			// because the two roles are not interchangeable across themes.
			return "text-accent-active dark:text-accent-hover";
	}
};

/**
 * A chip IS interactive — it opens a sheet — and carries a machine word (model,
 * effort), so its type is `mono-sm` and its target is the full 44pt.
 *
 * The ink is NOT here: this is the wrapper's fill, border and geometry. A label's
 * colour has to be on the label (`chipLabelClasses`) — see that function for why.
 */
/**
 * A skeleton bar's classes: ONE width, never two.
 *
 * Tailwind resolves `w-*` by stylesheet order, not by the order classes appear in
 * the attribute, so `${barClassName} w-full` silently beat a caller's `w-16` and
 * the bar painted 0 px inside a content-sized pill — two blank pills where a
 * loading state should have been, and a 122 pt sideways jump when the real label
 * arrived (design round 2 D13, QA round 4 Q1). The width is therefore a separate
 * argument with its own default, so a caller's width can never sit beside the
 * default, and this function is pure so a test can hold that as a rule rather
 * than as a reading of the rendered page.
 */
export const skeletonBarClasses = (input?: {
	/** Height and shape; a text-line height by default. */
	barClassName?: string;
	/** The bar's width; `w-full` for a list placeholder. */
	widthClassName?: string;
}): string =>
	`${input?.barClassName ?? "h-4"} ${input?.widthClassName ?? "w-full"} rounded-sm`;

export const chipClasses = (state: ControlState = {}): string =>
	cx(
		"min-h-11 flex-row items-center gap-1.5 rounded-sm border px-3",
		state.disabled
			? "bg-surface border-hairline"
			: state.selected
				? "bg-accent-muted border-accent-border"
				: "bg-surface border-border-control",
	);

/**
 * The chip label's ink, per § 6: `ink-muted` at rest, `accent-active` (light) /
 * `accent-hover` (dark) when selected, disabled when it cannot be used.
 *
 * It is expressed on the TEXT rather than left to the wrapper, because a
 * react-native-web Text declares its own `color: black` and therefore does not
 * inherit one: a chip whose label named no ink role rendered black on the chip's
 * own `surface` fill — 1.41:1 in the dark theme, i.e. effectively invisible. The
 * same trap is documented at `buttonLabelClasses` in button.tsx; a primitive whose
 * label names no ink role is the defect, so every new one needs this helper.
 */
export const chipLabelClasses = (state: ControlState = {}): string =>
	state.disabled
		? `${CONTROL_DISABLED_INK}`
		: state.selected
			? "text-accent-active dark:text-accent-hover"
			: "text-ink-muted";

/* -------------------------------------------------------------------------- */
/* ListRow                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The session row. The whole row is the control; it is never disabled.
 *
 * The 12-wide indicator slot is reserved for EVERY state, so every title starts
 * at the same x forever — indicators change colour, never geometry.
 */
export const listRowClasses = (state: ControlState = {}): string =>
	cx(
		// 56pt is `tokens.json` size.list.rowMinHeight; `min-h-14` would be the same
		// number, but the row is specified in pt, so the value is kept literal and
		// this comment names where it comes from. HAND-WRITTEN like `lg` above.
		"min-h-[56px] flex-row items-center gap-3 px-4 py-2.5",
		state.selected
			? // Selection is never colour alone: the caller also renders the title in
				// the accent role. `row-selected` alone is a 1.0x luminance difference.
				"bg-row-selected"
			: state.pressed
				? "bg-row-hover"
				: "bg-transparent",
	);

/** The one reserved indicator slot: 12×12, whatever the state. */
export const LIST_ROW_INDICATOR_CLASS = "h-3 w-3 items-center justify-center";

/**
 * The indicator ladder, first match wins (components.md § 7).
 *
 * The order is the whole design: an approval gate runs *inside* a turn, so the
 * row that most needs the reader carries `pending` and `streaming` at once.
 * Testing streaming first replaces the danger pulse with a neutral spinner on
 * exactly that row.
 */
export type ListRowAttention = "pending" | "streaming" | "unread" | "none";

export const listRowIndicator = (flags: {
	ready?: boolean;
	pending?: boolean;
	streaming?: boolean;
	unread?: boolean;
}): ListRowAttention => {
	if (!flags.ready) return "none";
	if (flags.pending) return "pending";
	if (flags.streaming) return "streaming";
	if (flags.unread) return "unread";
	return "none";
};

/* -------------------------------------------------------------------------- */
/* Sheet, dialog                                                              */
/* -------------------------------------------------------------------------- */

/** Bottom-anchored, never centred: a centred dialog on a phone is under neither
 * thumb (components.md § 8). `frame` is the composer's radius and is not reused
 * here; a sheet takes `lg` on its top corners. */
export const SHEET_SURFACE_CLASS =
	"rounded-t-lg border border-hairline bg-elevated";

/** Detents, as a fraction of the scroll COLUMN — not of the viewport. The two
 * are the same number until a keyboard opens, which is when the mistake bites. */
export type SheetDetent = "content" | "half" | "full";

export const SHEET_DETENTS: Record<SheetDetent, number | null> = {
	content: null, // fit content, capped at 60% of the column
	half: 0.5,
	full: 0.92,
};

export const SHEET_CONTENT_MAX_FRACTION = 0.6;

export const DIALOG_SURFACE_CLASS =
	"rounded-lg border border-hairline bg-elevated p-4";

/* -------------------------------------------------------------------------- */
/* Alert and banner                                                           */
/* -------------------------------------------------------------------------- */

/**
 * An inline alert. Every severity carries a WORD or a GLYPH besides the colour —
 * a colour-only signal for danger or status is the anti-pattern the kit names.
 */
const ALERT_TONES: Record<
	SemanticTone,
	{ fill: string; ink: string; glyph: string }
> = {
	neutral: {
		fill: "bg-accent-wash border-accent-border",
		ink: "text-ink",
		glyph: "·",
	},
	info: {
		fill: "bg-info-wash border-info-border",
		ink: "text-ink",
		glyph: "·",
	},
	success: {
		fill: "bg-success-wash border-success-border",
		ink: "text-ink",
		glyph: "✓",
	},
	warning: {
		fill: "bg-warning-wash border-warning-border",
		ink: "text-ink",
		glyph: "!",
	},
	danger: {
		fill: "bg-danger-wash border-danger-border",
		ink: "text-ink",
		glyph: "✗",
	},
};

export const alertClasses = (tone: SemanticTone = "info"): string =>
	cx(
		"flex-row items-start gap-2 rounded-md border p-3",
		ALERT_TONES[tone].fill,
		ALERT_TONES[tone].ink,
	);

export const alertGlyph = (tone: SemanticTone = "info"): string =>
	ALERT_TONES[tone].glyph;

/** The word carrying the severity, in the semantic colour, for the same reason
 * the glyph exists: never colour alone. */
export const alertWordClasses = (tone: SemanticTone = "info"): string => {
	switch (tone) {
		case "danger":
			return "text-danger";
		case "warning":
			return "text-warning";
		case "success":
			return "text-success";
		default:
			return "text-ink-muted";
	}
};

/**
 * The banner is the PAGE's status, distinct from the inline alert in that it
 * responds to nothing the reader just did. One action, and it exits on the first
 * successful poll rather than on a dismiss (components.md § 21).
 */
export const bannerClasses = (tone: "danger" | "warning"): string =>
	cx(
		"w-full flex-row items-center gap-2 border-b px-4 py-2",
		tone === "danger"
			? "bg-danger-wash border-danger-border"
			: "bg-warning-wash border-warning-border",
	);

/** The leading word or glyph, in the severity's colour. A banner is the loudest
 * status the app has, so the non-colour channel is not optional here either. */
export const bannerInkClasses = (tone: "danger" | "warning"): string =>
	tone === "danger" ? "text-danger" : "text-warning";

/** Text glyphs, never icons: they survive every system font (§ 9, § 21). */
export const bannerGlyph = (tone: "danger" | "warning"): string =>
	tone === "danger" ? "✗" : "!";

/* -------------------------------------------------------------------------- */
/* Segmented control                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A track of options choosing ONE value. Selection is never colour alone: the
 * selected item also takes the heavier label weight, because an accent tint at a
 * 1.0x luminance ratio is not a difference a low-vision reader can see.
 */
export const segmentedTrackClasses =
	"flex-row rounded-sm border border-hairline bg-sunken p-0.5";

/**
 * A segmented option's LABEL ink — the ladder, in one place.
 *
 * The ink has to be on the TEXT rather than left to the wrapper: a
 * react-native-web `Text` declares its own `color` and does not inherit the
 * wrapper's (the trap `chipLabelClasses` documents). `Segmented` therefore
 * names the label ink itself, and before this helper it kept a SECOND copy of
 * the ladder below — a copy that had drifted, painting a disabled option's
 * label with the palette's exempt `ink-disabled` while this file's own
 * `segmentedItemClasses` already said `CONTROL_DISABLED_INK`. Two spellings of
 * one decision is the defect; the option renders one of them, and nothing in a
 * passing run could tell which.
 *
 * Why the disabled branch is `ink-dim` and not `ink-disabled`: the option
 * NAMES the value it selects, so it takes the kit's disabled-label ink
 * (`CONTROL_DISABLED_INK`, pinned by `variants.test.ts`) rather than the exempt
 * role. `ink-disabled` is exempt under SC 1.4.3 as an inactive control's text —
 * so a disabled label in it is not a conformance failure — but it measures
 * 2.42:1 light / 2.50:1 dark on the track's `sunken` fill, and the kit's policy
 * (Button, Chip, field) is that a label that names its action stays readable.
 */
export const segmentedLabelClasses = (state: ControlState = {}): string =>
	state.disabled
		? CONTROL_DISABLED_INK
		: state.selected
			? "text-accent-active dark:text-accent-hover"
			: "text-ink-muted";

/**
 * The option's own box. Its fill is the state signal; its ink is delegated so
 * the wrapper and the label cannot disagree about it.
 */
export const segmentedItemClasses = (state: ControlState = {}): string =>
	cx(
		"min-h-11 flex-1 flex-row items-center justify-center rounded-sm px-3",
		state.disabled || !state.selected ? "bg-transparent" : "bg-accent-muted",
		segmentedLabelClasses(state),
	);

/** The selected label's extra weight — the second, non-colour channel. */
export const segmentedLabelWeight = (selected: boolean): string =>
	selected ? "font-semibold" : "font-normal";

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `elevated`, NOT `sunken`. Measured: a `sunken` bar sits at ~1.3:1 and vanishes
 * in a still frame, so the loading state reads as an empty one — and the resting
 * tone has to be visible on its own, because reduced motion removes the pulse
 * first (components.md § 19).
 */
export const skeletonClasses = (options: { lines?: number } = {}): string =>
	cx("rounded-sm bg-elevated", options.lines ? "" : "h-4 w-full");

export const SKELETON_PULSE_MS = 1400;

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Empty is not an error: no warning colour, no apology, and always a second line
 * naming the action. An empty state with no second line is a dead end
 * (components.md § 20).
 */
export const emptyStateClasses =
	"flex-1 items-center justify-center gap-3 px-6 py-10";

/* -------------------------------------------------------------------------- */
/* Divider, avatar                                                            */
/* -------------------------------------------------------------------------- */

/** A rule, not a box: `hairline` because it is decorative and never the sole
 * boundary of required content. */
export const dividerClasses = "h-px w-full bg-hairline";

export type AvatarSize = "sm" | "md";

export const AVATAR_SIZES: Record<
	AvatarSize,
	{ box: string; text: string; px: number }
> = {
	sm: { box: "h-8 w-8", text: "text-meta", px: 32 },
	md: { box: "h-11 w-11", text: "text-label", px: 44 },
};

/** `radius.full` — an avatar is a circle, and `full` is the kit's token for it. */
export const avatarClasses = (size: AvatarSize = "md"): string =>
	cx(
		"items-center justify-center rounded-full bg-accent-muted",
		AVATAR_SIZES[size].box,
	);

/* -------------------------------------------------------------------------- */
/* Toast                                                                      */
/* -------------------------------------------------------------------------- */

/** One at a time: a second replaces the first, because a queue on a phone is a
 * stack of things nobody reads. Never for a failure — a toast that disappears
 * cannot carry an action (components.md § 10). */
export const toastClasses =
	"flex-row items-center gap-2 rounded-md border border-hairline bg-elevated px-4 py-3";

/** Long enough for one short line to be read: 1.5 × `duration.beat`. */
export const TOAST_MIN_MS = 1050;
export const TOAST_EXIT_MS = 120;
