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

import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { TOUCH_TARGET } from "@/ui/tokens.gen";

/** Join class names, dropping falsy entries. Local by design: `clsx` is not in
 * the shared dependency set, and this is all of it that the app needs. */
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
 *
 * The heights are MINIMUM heights, not fixed ones (design round 2, D69-5). At
 * 200 % text the label scales but a fixed box would not: a wrapped two-line
 * `label` is ~72 pt against the 44 pt `md` pill, so it overhung the fill by
 * ~14 pt top and bottom — unclipped, with the border crossing its own text —
 * measured on this slice's cells, the first to render these buttons at that
 * scale. `min-h-*` keeps the designed height whenever the label fits — every
 * 100 % cell in the captured matrix — and lets the box grow with the wrapped
 * label at large scales instead of hiding the overflow — the same shape
 * `screen.tsx`'s header uses (`min-h-14`, not `h-14`) and the same class the
 * design spec's source implementation already carried (`min-h-11`). `icon` and
 * `fab` keep fixed boxes: they carry no label, so nothing can wrap.
 */
const BUTTON_SIZES: Record<ButtonSize, string> = {
	sm: "min-h-8 px-3 gap-1.5",
	md: "min-h-11 px-4 gap-2",
	// `lg` is 50pt (`tokens.json` size.controls.lg.height), the one height that is
	// not on the 4pt scale, so no numeric `min-h-*` step exists for it. HAND-WRITTEN:
	// changing the token regenerates nothing here, and `BUTTON_VISUAL_HEIGHT.lg`
	// below must move with it.
	lg: "min-h-[50px] px-6 gap-2.5",
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
/**
 * Whether the field scrolls itself, which is a question about its CONTENT only.
 *
 * The resting floor is clamped to ONE placeholder line by design (D1/D20), so at
 * 200 % text the placeholder can be taller than the box. Feeding the placeholder's
 * height into this decision made the platform paint a scrollbar — and, on the web
 * build, the scrollbar's own corner glyph — on a field the reader had typed
 * nothing into, which is the most common state of the composer. A placeholder is
 * a hint that may be clipped; the reader's own text may not be lost. So the value
 * content alone decides, and `cap` is the six-line ceiling.
 */
/**
 * What a field tells the WEB about scrolling.
 *
 * `scrollEnabled` is native-only: react-native-web ignores it, so a false value
 * left the browser painting its own scrollbar and resize handle on an empty field
 * at 200 % (final audit D1 — a helper test was green while the real Settings
 * capture still showed chrome). Web needs the CSS spelling, and only when there
 * is nothing to scroll; past the cap it keeps the default `auto`, matching the
 * native prop.
 */
export const webFieldOverflow = (
	platform: string,
	scrollable: boolean,
): "hidden" | undefined =>
	platform === "web" && !scrollable ? "hidden" : undefined;

/**
 * The field's HEIGHT is the app's: it grows with the content to a cap and then
 * scrolls. A user-dragged height is a state the app cannot restore or lay out, so
 * the web build says `resize: none` on EVERY field — including a scrollable one —
 * while native keeps its own view behaviour untouched. This is the other half of
 * D1: `overflow: hidden` removed the scrollbar track, but the browser was still
 * painting the diagonal resize grip on an empty 200 % field.
 */
export const webFieldResize = (platform: string): "none" | undefined =>
	platform === "web" ? "none" : undefined;

export const fieldScrollsWithContent = (
	contentFloor: number,
	cap: number,
): boolean => contentFloor > cap;

/** The field's border, top and bottom, in CSS pixels: `fieldClasses` draws a 1px
 *  border, and the box is `border-box`, so a height set from the content's own
 *  measurement is short by exactly this much unless it is added back. */
export const FIELD_BORDER_Y = 2;

/**
 * The painted height of a field, in px.
 *
 * `contentFloor`, `oneLineBox` and `placeholderFloor` all describe the CONTENT box
 * (text + `FIELD_PAD_Y`); `cap` is a content budget (`maxLines × line`). Under
 * `border-box` the style's height is the border box, so the border must be added or
 * the field clips its last line by 2px — measured on S16/create-filled at 100%:
 * "content 88px in a 86px box (overflow-y: hidden)". The composer escapes only
 * because its own content report happened to come back two pixels larger; the
 * arithmetic was wrong for every field and visible wherever the report was exact.
 */
export const fieldBoxHeight = (
	contentFloor: number,
	oneLineBox: number,
	placeholderFloor: number,
	cap: number,
): number =>
	Math.min(Math.max(contentFloor, oneLineBox, placeholderFloor), cap) +
	FIELD_BORDER_Y;

/**
 * The field's height STYLE, per platform: who decides how tall the box is.
 *
 * WEB pins `height` from the content report (`fieldBoxHeight`). A `<textarea>`
 * has no content-driven height of its own, and react-native-web reports
 * `scrollHeight` on every input, so the report is live and the pin follows it.
 *
 * NATIVE must NOT pin it (TestFlight 800: the composer stayed one line on iOS
 * and the draft ran on out of sight below it, on both the new-conversation and
 * the agent-chat composer). On the New Architecture iOS emits
 * `onContentSizeChange` from ONE place only — `updateLayoutMetrics` in React
 * Native's `RCTTextInputComponentView.mm` — so the event fires only when the
 * field's LAYOUT changes. A `height` derived from that event is a closed loop:
 * the pinned height keeps the layout still, so a second line never reports,
 * so the height never moves. Web never showed it because its report does not
 * depend on layout. Instead native leaves the height to the text input's own
 * Yoga measure (`BaseTextInputShadowNode::measureContent`, which measures the
 * natively typed text, or the placeholder while empty, at the box's width) and
 * only bounds it: the same floor and the same cap `fieldBoxHeight` resolves,
 * as `minHeight`/`maxHeight`. An EMPTY field whose placeholder is held to a
 * line budget (`placeholderClamped`, the composer's §2.5 D1) is held AT its
 * floor, because the native measure of a wrapped placeholder would otherwise
 * grow the resting box the budget exists to keep still.
 *
 * `touchFloor` is the platform's touch minimum; it wins over the cap exactly as
 * the old `minHeight` key did (Yoga resolves min over max).
 */
export const fieldBoxStyle = (
	platform: string,
	box: {
		contentFloor: number;
		oneLineBox: number;
		placeholderFloor: number;
		cap: number;
		touchFloor: number;
		empty: boolean;
		placeholderClamped: boolean;
	},
): { height?: number; minHeight: number; maxHeight?: number } => {
	if (platform === "web") {
		return {
			height: fieldBoxHeight(
				box.contentFloor,
				box.oneLineBox,
				box.placeholderFloor,
				box.cap,
			),
			minHeight: box.touchFloor,
		};
	}
	const floor =
		Math.min(Math.max(box.oneLineBox, box.placeholderFloor), box.cap) +
		FIELD_BORDER_Y;
	return {
		minHeight: Math.max(box.touchFloor, floor),
		maxHeight:
			box.empty && box.placeholderClamped ? floor : box.cap + FIELD_BORDER_Y,
	};
};

/**
 * Whether the field may scroll. Web keeps the content-report decision
 * (`fieldScrollsWithContent`) because it also drives the `overflow` CSS there.
 * Native cannot use it: past the cap the box stops moving, so — for the reason
 * `fieldBoxStyle` gives — no further content report arrives and a decision fed
 * by it would stay `false` with line seven unreachable. A filled native field
 * therefore always scrolls (React Native's own multiline default); it has
 * nothing to scroll until it is at the cap, because below it the box IS the
 * content. An empty one never does, so the resting field cannot scroll its
 * placeholder (the design round's empty-field invariant).
 */
export const fieldScrollEnabled = (
	platform: string,
	scrollable: boolean,
	empty: boolean,
): boolean => (platform === "web" ? scrollable : !empty);

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
			return cx(
				base,
				fill,
				options.inComposer
					? "border-transparent web:focus-visible:border-accent"
					: "border-border-control",
			);
	}
};

/** Auto-grow to six lines, then scroll. A field that grows without bound pushes
 * the transcript off the top of the screen (components.md § 4). */
export const TEXTAREA_MAX_LINES = 6;
export const TEXTAREA_LINE_PX = 22;
export const TEXTAREA_MAX_PX = TEXTAREA_MAX_LINES * TEXTAREA_LINE_PX;

/**
 * The field's CONTENT ceiling (text + `py-2`), in px, before the border.
 *
 * Up to the shipped six the old rule stands, unchanged by construction:
 * `maxLines × 22`, held under `TEXTAREA_MAX_PX`, both at the reader's scale.
 * Note what that rule actually buys: it was measured on the 13 pt mono line
 * (22) while the field's own text is `text-body` on a 24 pt line inside 16 pt
 * of padding, so the "six-line" cap of 132 shows FOUR AND A BIT lines of a
 * draft — and `maxLines` above six could never raise it, because the
 * `TEXTAREA_MAX_PX` term clamped it straight back.
 *
 * TestFlight 836 ("I can only see a couple lines at a time"): the composer
 * asks for more, and it is counted in the lines the reader actually sees —
 * `maxLines × bodyLine + pad`, so eight means eight body lines. The keyboard-
 * and chrome-aware budget (`maxHeightPx`, `composerBudget`) still wins
 * wherever eight do not fit between the header and the keyboard; past the cap
 * the field scrolls itself.
 */
export const textareaContentCap = (box: {
	maxLines: number;
	scale: number;
	bodyLine: number;
	pad: number;
	maxHeightPx?: number;
}): number => {
	const hard = box.maxHeightPx ?? Number.POSITIVE_INFINITY;
	if (box.maxLines > TEXTAREA_MAX_LINES)
		return Math.min(box.maxLines * box.bodyLine * box.scale + box.pad, hard);
	return Math.min(
		box.maxLines * TEXTAREA_LINE_PX * box.scale,
		TEXTAREA_MAX_PX * box.scale,
		hard,
	);
};

/** How many body lines the agent composer's field shows before it scrolls,
 *  when the screen has the room (TestFlight 836). */
export const COMPOSER_FIELD_MAX_LINES = 8;

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

/**
 * A tappable card that navigates or selects: a computer on Computers, the Team
 * Bridge entry. One family so the two read as the same kind of object, and both
 * as something to press (TestFlight 883, Ola: "It was not obvious that this was
 * clickable" — the row was text under a hairline and its pressed fill measured
 * 1.01:1 against the canvas, while the only bordered shapes were inert chips).
 *
 * - `border-control`, not `hairline`: 3.42:1 on canvas clears the 3:1 non-text
 *   floor; a hairline edge is 1.25:1 and does not read as a boundary.
 * - Pressed is `sunken` (1.14:1 on `surface`, the largest step the palette has);
 *   `row-hover` is 1.08:1 on surface and showed nothing under a finger.
 * - Selected is `row-selected`, never alone: the caller adds the accent check.
 * - 56 pt floor (`NAV_CARD_MIN_HEIGHT`), the switcher's two-line row height.
 */
export const navCardClasses = (state: ControlState = {}): string =>
	cx(
		"flex-row items-center gap-3 rounded-md border border-border-control px-3 py-3",
		state.selected
			? "bg-row-selected"
			: state.pressed
				? "bg-sunken"
				: "bg-surface",
	);

export const NAV_CARD_MIN_HEIGHT = 56;

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
export const badgeClasses = (
	tone: SemanticTone = "neutral",
	align: BadgeAlign = "start",
): string =>
	cx(
		align === "center" ? "self-center" : "self-start",
		"rounded-sm border px-2 py-0.5 text-meta",
		BADGE_TONES[tone],
	);

/**
 * Where a badge sits on its parent's cross axis.
 *
 * `start` is the default every existing caller was measured with: a badge in a
 * column (a card's header stack, a tag line) hugs its leading edge instead of
 * stretching to the column's width. A badge at the END of a centred `flex-row`
 * list row (the home pickers' "Default" / "This conversation") needs `center`:
 * `self-start` overrides the row's `items-center` and pins the pill to the row's
 * top edge, 11-13 pt above the label's centre line (design round 1, D1).
 */
export type BadgeAlign = "start" | "center";

/**
 * The badge's LABEL line box, which is the whole of its height above the type.
 *
 * WHY IT IS CHOSEN BY SCALE RATHER THAN FIXED. A pinned `leading-4` (16 pt) is
 * what holds the two variants to one height at 100 %, and it is what every
 * caller's geometry was measured against — but at 300 % text the digits are 33 px
 * on that 16 pt line, so the ink ran 3.4 pt above and 1.1 pt below the pill and
 * the tops of the 9s vanished (design round 9, D25).
 *
 * Leaving `leading-none` on everywhere "fixed" 300 % by changing EVERY badge:
 * the bordered and sans badges fell 22 -> 18 pt, outside components.md § 6's
 * 20-22, and the mono family landed at 17 pt so the two no longer matched. 672
 * of 1200 frames moved (round 12, F-1 / D28). So the fixed line box is the
 * DEFAULT, and the late-bound one is the exception, taken only at the step where
 * the type actually overruns it.
 *
 * 2.3 is measured, not picked. The ink is 6 pt tall at 100 % and 16 pt at 200 %,
 * both inside the 20 pt pill — but the growth is linear, so it reaches ~18.4 pt
 * at 2.3x and ~19 pt at 2.35x, where iOS's largest accessibility step (AX3,
 * about 2.35x) sits: the fixed box overruns from there, and by 2.5x the ink is
 * as tall as the pill itself. The earlier claim that the box "holds through
 * 250 %" was wrong at exactly the size the largest Dynamic Type step uses
 * (QA round 8, Q12). Everything below 2.3x keeps the geometry it was measured
 * with, which is what F-1/D28 restored. */
export const BADGE_LINE_FOLLOWS_SCALE = 2.3;

/** The label's line class at a text scale: the fixed box below the step, the
 *  type's own above it. */
export const badgeLineClass = (scale: number): string =>
	scale >= BADGE_LINE_FOLLOWS_SCALE ? "leading-none" : "leading-4";

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

export const chipClasses = (
	state: ControlState = {},
	options: { quiet?: boolean } = {},
): string =>
	options.quiet
		? cx(
				// Quiet: the shared composer ground is already a surface, so a chip there
				// is a target with states rather than a second box. The floor stays —
				// this changes the paint, never the geometry a thumb has to hit.
				"min-h-11 flex-row items-center gap-1.5 rounded-sm border border-transparent px-2",
				state.disabled
					? "bg-transparent"
					: state.selected
						? "bg-accent-muted"
						: "bg-transparent",
			)
		: cx(
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
		// No fixed min-height here: the row's floor is the platform `TOUCH_FLOOR`
		// (44 iOS / 48 other), applied by `ListRow` as a style because it is a
		// runtime value. The old 56 pt floor plus `py-2.5` made a one-line row 60 pt
		// and pitched the conversations 60–80 pt apart (design spec 2026-11-06 § 4);
		// with `py-2` a two-line row lands at ~56 pt by its own content and a
		// one-line row at the touch floor — both on the space scale.
		"flex-row items-center gap-3 px-4 py-2",
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

/**
 * `content` fits its content, capped at this fraction of the column.
 *
 * THE CAP WAS DOCUMENTED AND NOT IMPLEMENTED for as long as this table has
 * existed: the `content` entry was `null`, which `Sheet` reads as "no bound at
 * all", so a content-detent sheet could grow past the column it lives in and its
 * own header row would be drawn INSIDE the device's top unsafe band. MEASURED on
 * the capture that added the projects lifecycle's forms (this slice, at iphone-se
 * / 200 %): the create and milestone sheets put their first row at 6-15 pt
 * against a 20 pt declared inset, and the audit's U-05 rule failed them — the
 * frames show the sheet's title scrolled off the top of the screen. This constant
 * was declared beside the table for exactly that cap and referenced nowhere.
 *
 * Declared BEFORE the table that now uses it: a `const` read in an initializer
 * above its own declaration is a TDZ error at module load, not a compile error.
 */
export const SHEET_CONTENT_MAX_FRACTION = 0.6;

/** Detents, as a fraction of the scroll COLUMN — not of the viewport. The two
 * are the same number until a keyboard opens, which is when the mistake bites.
 *
 * The other two detents are bounded already; `content` was the one that was not.
 */
/**
 * WHICH DETENT A FOOTERED FORM TAKES, DECIDED HERE RATHER THAN IMPLIED.
 *
 * The forms (create a project; edit a milestone) take `content` — 0.6 — and that
 * choice was challenged in review round 1 on the ground that a six-control form
 * does not fit, with `full` (0.92) offered as the alternative. That round's
 * rejection of `full` was reasoned about the ACTION ("the form is taller than the
 * window at every detent"), and the pinned `footer` has since made the action's
 * reachability independent of the detent — so the reason moved and the decision
 * has to be re-stated rather than inherited.
 *
 * MEASURED, at the extreme corner (iphone-se, 200 %, which is a 320 pt phone at
 * the largest type step): the `content` cap splits 76 / 181 / 84 pt into header /
 * body / footer, so the body band is 181 pt for 926 pt of form. `full` would make
 * that band 362 pt. The decision is `content`, for three reasons:
 *
 *  1. The sheet is anchored over a listing or a detail the reader is working in,
 *     and it is a task handed out by that screen rather than a destination
 *     (`project-create.tsx` says why it is a sheet and not a route). At 0.92 the
 *     surface leaves ~26 pt of that context on the narrowest phone at 100 %, which
 *     reads as a page that happens to sit over another one.
 *  2. The load-bearing half of round 1's finding was the ANSWERING CONTROL and its
 *     refusal being out of reach, and the pinned footer settles that at any detent
 *     — the band the reader scrolls is a comfort question, not a reachability one.
 *  3. The cost is bounded and legible: the body scrolls, and the reader can see
 *     roughly a control and a half at the largest type step on the smallest phone.
 *
 * WHAT WOULD CHANGE IT, AND THE MEASURE THAT DECIDES (design round 3, D10 — the
 * trigger used to say "more than about three screens", which read two ways and the
 * two readings disagree on this very form): the measure is **bands of SCROLLING**,
 * `(body content − body band) / body band`, at the default scale on the narrowest
 * phone. The create form at 100 % on `iphone-se` is 538 pt of content in a 185 pt
 * band — 2.9 bands of content but only **1.9 bands of scrolling**, and 623 pt with a
 * retained draft, which is **2.4 bands of scrolling**. So the line is > 3 bands of
 * scrolling and this form sits under it, deliberately: at that point the detent is
 * what is making a sheet behave like a page, and `full` becomes the cheaper answer
 * than a longer scroll. Recorded so the next reader argues with a measurement
 * instead of with a reason that no longer applies.
 */
export const SHEET_DETENTS: Record<SheetDetent, number | null> = {
	content: SHEET_CONTENT_MAX_FRACTION,
	half: 0.5,
	full: 0.92,
};

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

/**
 * Where an alert's one action goes, and the classes that put it there.
 *
 *  - `none`: no action; the row keeps the classes every existing alert painted.
 *  - `trailing`: the remedy beside the message (design D2). The action's 44 pt
 *    box takes `-my-3` so it overlaps the alert's own 12 pt padding instead of
 *    stretching the alert to 70 pt (one line is 12 + 20 + 12 + 2 = 46, the
 *    spec's §3 figure), and the text block centres on it so a one-line message
 *    shares its line with Retry rather than sitting 12 pt above it.
 *  - `stacked`: at large text the remedy goes UNDER the message (UX U4): beside
 *    it, a 320 pt phone at 200 % wrapped the sentence into a five-line column
 *    270 pt tall. The flex direction is a STYLE (`alertStacked`), not a class,
 *    because `alertClasses` already carries `flex-row` and two direction
 *    classes on one node resolve by stylesheet order, not by intent.
 */
export type AlertActionLayout = "none" | "trailing" | "stacked";
export const alertActionLayout = (
	hasAction: boolean,
	scale: number,
): AlertActionLayout =>
	!hasAction ? "none" : scale > LARGE_TEXT_SCALE ? "stacked" : "trailing";
export const alertActionClasses = (layout: AlertActionLayout) => ({
	text:
		layout === "trailing"
			? "flex-1 flex-row items-start gap-2 self-center"
			: "flex-row items-start gap-2",
	action: layout === "stacked" ? "self-end -mb-3" : "self-center -my-3",
});
export const alertStacked = {
	flexDirection: "column",
	alignItems: "stretch",
} as const;

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

/* `lg` is the Team Bridge profile card's photo: 80 pt, drawn from the 256 px
 * variant so it stays sharp at 3x. Rows keep `sm`/`md`. */
export type AvatarSize = "sm" | "md" | "lg";

export const AVATAR_SIZES: Record<
	AvatarSize,
	{ box: string; text: string; px: number }
> = {
	sm: { box: "h-8 w-8", text: "text-meta", px: 32 },
	md: { box: "h-11 w-11", text: "text-label", px: 44 },
	lg: { box: "h-20 w-20", text: "text-title", px: 80 },
};

/** `radius.full` — an avatar is a circle, and `full` is the kit's token for it. */
export const avatarClasses = (size: AvatarSize = "md"): string =>
	cx(
		// `overflow-hidden` clips a photo to the circle. No border: a photo is its
		// own edge, and the desktop dropped avatar borders for the same reason.
		"items-center justify-center overflow-hidden rounded-full bg-accent-muted",
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
