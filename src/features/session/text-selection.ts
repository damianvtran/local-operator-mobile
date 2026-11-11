/**
 * Drag-to-select text in the transcript and Team Bridge — the platform policy
 * and the one-at-a-time "select text" mode store.
 *
 * WHY THIS EXISTS (operator report on the iOS TestFlight build: "you can't
 * really tap to select and drag a selection to copy"). The two platforms give
 * `<Text selectable>` very different powers in React Native 0.86.3:
 *
 *  - ANDROID: `ReactTextViewManager.setSelectable` calls
 *    `TextView.setTextIsSelectable(true)`
 *    (`ReactAndroid/.../views/text/ReactTextViewManager.kt:295-296`), which is
 *    the platform's full selection: long-press picks a word, drag handles
 *    extend it across lines, and the floating toolbar offers Copy / Share /
 *    Select all. Nested `<Text>` spans are one TextView, so a paragraph with
 *    links and code spans still selects as one run.
 *  - iOS (Fabric): `RCTParagraphComponentView` draws through
 *    `RCTParagraphTextView`, a plain `UIView` (`RCTParagraphComponentView.mm:29`),
 *    not a `UITextView`. `selectable` only adds a `UILongPressGestureRecognizer`
 *    that presents an edit menu (`:289-327`) whose single `copy:` writes the
 *    WHOLE attributed string (`:347-365`). No caret, no handles, no partial
 *    range — that is the reported bug.
 *
 * The only stock iOS view with drag handles is `UITextView`, which RN exposes as
 * a multiline `TextInput`. With `editable={false}` the Fabric input sets
 * `UITextView.editable = NO` (`RCTTextInputComponentView.mm:214-215`) and leaves
 * `selectable` at UIKit's default YES, which is exactly iMessage's read-only
 * selection. So iOS gets a MODE: long-press a message swaps its rendered view for
 * a read-only `TextInput` holding the message's plain text, focused with the
 * whole message pre-selected so the handles are on screen at once.
 *
 * Android must NOT use that mode: `editable={false}` there maps to
 * `view.isEnabled = false` (`ReactTextInputManager.kt:597-600`), and a disabled
 * EditText cannot select at all. Android keeps native `selectable` leaves.
 * Web keeps `selectable` too (react-native-web maps it to `user-select: text`,
 * which already drags across paragraphs).
 *
 * No new native dependency: both paths are stock RN, so no prebuild change.
 */
import { Platform } from "react-native";

type OS = typeof Platform.OS;

/** iOS needs the TextInput mode; every other platform selects natively. */
export const usesSelectionMode = (os: OS = Platform.OS): boolean =>
	os === "ios";

/** Whether leaf `<Text>` should carry `selectable`. Off on iOS on purpose: the
 *  Fabric `selectable` long-press recognizer would fire its whole-block Copy
 *  menu on the SAME long-press that enters the selection mode. */
export const leafSelectable = (os: OS = Platform.OS): boolean =>
	!usesSelectionMode(os);

/**
 * Whether a selection change should end the mode. Tapping inside a read-only
 * UITextView collapses its selection to a caret position; that is the reader
 * saying "done", so a collapsed range exits — but only after a real range was
 * seen, because the input reports `{0,0}` while it mounts, before the initial
 * select-all lands, and exiting on that would close the mode instantly.
 */
export const selectionEndsMode = (
	selection: { start: number; end: number },
	sawRange: boolean,
): boolean => sawRange && selection.start === selection.end;

/* ------------------------------------------------- the selection highlight */

/**
 * Android paints `selectionColor` as the highlight BEHIND the glyphs (web's
 * `::selection` ignores it — RNW `Text` drops the prop). The first cut used the
 * palette's `accent-wash`, which measured 1.00–1.37:1 against
 * `message-surface` across the shipped palettes (PR #233 design R1, D1):
 * handles with no visible range between them.
 *
 * The highlight is now the theme's ACCENT at a per-theme alpha near 30 %
 * (Android's own convention: its default highlight is the accent at reduced
 * alpha), derived from the theme's tokens against two bars on every surface a
 * selectable body sits on (`SELECTION_SURFACES`):
 *  - VISIBLE: the composited fill vs the surface >= 1.5:1;
 *  - READABLE: `ink` on the fill >= 4.5:1 (WCAG body text).
 *
 * WHY PER THEME, NOT ONE ALPHA: no single alpha clears both bars on all three
 * surfaces in every palette. Measured 2026-11-11 over the 59 palettes in
 * `tokens.gen.ts`: a fixed 0x4d left 11 palettes under 1.5:1 on `user-bubble`
 * and 3 on `sunken`, with `ink` under 4.5:1 on the bubble in 8; the per-palette
 * feasible ranges do not overlap (highest minimum 0x56, lowest maximum 0x43).
 * The search prefers the alpha closest to 30 % that clears every bar. Six light
 * palettes cannot clear 1.5:1 on `user-bubble` at ANY accent alpha while `ink`
 * keeps 4.5:1 on it (best 1.396–1.46:1); there readability wins and the fill
 * takes the best visibility that keeps it.
 * `selection-contrast.test.ts` proves that infeasibility rather than listing
 * exceptions, so a new palette cannot slip below the bars unnoticed.
 */
export const SELECTION_HIGHLIGHT_TARGET_ALPHA = 0x4d; // 77 / 255 = 30.2 %
/** The search window, 20 %–45 %: below it the fill is a tint nobody sees, above
 *  it the accent starts to read as a button, not a selection. */
const ALPHA_MIN = 0x33;
const ALPHA_MAX = 0x73;
export const SELECTION_VISIBLE_MIN = 1.5;
export const SELECTION_INK_MIN = 4.5;
export const SELECTION_SURFACES = [
	"message-surface",
	"user-bubble",
	"sunken",
] as const;

type SelectionPalette = Record<
	"accent" | "ink" | (typeof SELECTION_SURFACES)[number],
	string
>;

const HEX6 = /^#[0-9a-f]{6}$/i;

const rgb = (hex: string): [number, number, number] => [
	Number.parseInt(hex.slice(1, 3), 16),
	Number.parseInt(hex.slice(3, 5), 16),
	Number.parseInt(hex.slice(5, 7), 16),
];

/** WCAG 2.x relative luminance of an sRGB triple (0–255). */
const luminance = (c: readonly number[]): number => {
	const [r, g, b] = c.map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two sRGB triples. */
export const contrastRatio = (
	a: readonly number[],
	b: readonly number[],
): number => {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** `top` at `alpha` (0–255) over the opaque `bottom`, blended in sRGB the way
 *  Android composites an ARGB highlight. */
export const composite = (
	top: string,
	alpha: number,
	bottom: string,
): [number, number, number] => {
	const a = alpha / 255;
	const t = rgb(top);
	return rgb(bottom).map((c, i) =>
		Math.round(a * (t[i] as number) + (1 - a) * c),
	) as [number, number, number];
};

/** The worst visibility and worst ink contrast of `alpha` across the surfaces. */
export const highlightMargins = (
	palette: SelectionPalette,
	alpha: number,
): { visible: number; ink: number } => {
	let visible = Number.POSITIVE_INFINITY;
	let ink = Number.POSITIVE_INFINITY;
	for (const surface of SELECTION_SURFACES) {
		const fill = composite(palette.accent, alpha, palette[surface]);
		visible = Math.min(visible, contrastRatio(fill, rgb(palette[surface])));
		ink = Math.min(ink, contrastRatio(rgb(palette.ink), fill));
	}
	return { visible, ink };
};

/** The alpha byte for a palette: closest to 30 % clearing both bars; else the
 *  most visible one that keeps ink readable; else the 30 % target. */
export const selectionHighlightAlpha = (palette: SelectionPalette): number => {
	let best: number | null = null;
	let fallback: { alpha: number; visible: number } | null = null;
	for (let alpha = ALPHA_MIN; alpha <= ALPHA_MAX; alpha += 1) {
		const m = highlightMargins(palette, alpha);
		if (m.ink < SELECTION_INK_MIN) continue;
		if (
			m.visible >= SELECTION_VISIBLE_MIN &&
			(best === null ||
				Math.abs(alpha - SELECTION_HIGHLIGHT_TARGET_ALPHA) <
					Math.abs(best - SELECTION_HIGHLIGHT_TARGET_ALPHA))
		) {
			best = alpha;
		}
		if (fallback === null || m.visible > fallback.visible) {
			fallback = { alpha, visible: m.visible };
		}
	}
	return best ?? fallback?.alpha ?? SELECTION_HIGHLIGHT_TARGET_ALPHA;
};

const highlightCache = new Map<string, string | undefined>();

/**
 * The theme's Android selection highlight, `#rrggbbaa` (RN's colour parser
 * reads CSS order). A palette with any non-`#rrggbb` value returns `undefined`
 * — the platform's own default highlight — never the opaque accent, which
 * would bury the ink it is meant to mark. Memoised per palette: every
 * `SelectableMessage` asks, and the answer only changes with the theme.
 */
export const selectionHighlight = (
	palette: SelectionPalette,
): string | undefined => {
	const key = [
		palette.accent,
		palette.ink,
		...SELECTION_SURFACES.map((s) => palette[s]),
	].join();
	if (highlightCache.has(key)) return highlightCache.get(key);
	const valid = key.split(",").every((value) => HEX6.test(value));
	const value = valid
		? `${palette.accent}${selectionHighlightAlpha(palette).toString(16).padStart(2, "0")}`
		: undefined;
	highlightCache.set(key, value);
	return value;
};

/* ------------------------------------------------------------ the mode store */

/**
 * At most ONE message is in selection mode, app-wide. A module store (not React
 * state in the list) so entering/leaving re-renders only the two rows whose
 * boolean flipped — each row subscribes to `activeId === myId`, and the list's
 * memoised rows never see the change. Lists end the mode on a TAP outside the
 * selecting row (`textSelectionContainerTouch` / `…TouchEnd`), never on a
 * scroll (PR #233 design R1, D3): a long answer's far handle is off-screen, and
 * the reader has to scroll to reach it — UIKit handles cannot cross, so a
 * scroll exit would pin every selection to the message's first or last
 * character. A row leaving the list (FlatList windowing unmounts it) ends the
 * mode from the row's own unmount cleanup.
 */
let activeId: string | null = null;
let touchInside = false;
/* A touch began outside the selecting row and has not yet turned into a
 *  scroll: it ends the mode on lift, if it lifts as a tap. */
let outsidePending = false;
const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of [...listeners]) listener();
};

export const subscribeTextSelection = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const activeTextSelection = (): string | null => activeId;

export const enterTextSelection = (id: string): void => {
	if (activeId === id) return;
	activeId = id;
	emit();
};

/** Leave the mode. With an id, only if that row is the active one (a row's own
 *  blur must not close a row that took over after it). */
export const exitTextSelection = (id?: string): void => {
	if (activeId === null) return;
	if (id !== undefined && activeId !== id) return;
	activeId = null;
	touchInside = false;
	outsidePending = false;
	emit();
};

/** The selecting row marks a touch as its own. Touch events bubble child-first,
 *  so this runs before the list's `textSelectionContainerTouch` for the same
 *  touch. */
export const noteTextSelectionTouch = (): void => {
	if (activeId !== null) touchInside = true;
};

/** A list's `onTouchStart`: a touch that did not start in the selecting row
 *  MAY be a tap outside it. Whether it is is known only on lift — the same
 *  touch could be the drag that scrolls to the far handle (design R1, D3). */
export const textSelectionContainerTouch = (): void => {
	if (activeId === null) return;
	if (touchInside) {
		touchInside = false;
		outsidePending = false;
		return;
	}
	outsidePending = true;
};

/** A list's `onScrollBeginDrag`: the pending outside touch was a scroll, not a
 *  tap, so it keeps the mode. */
export const textSelectionContainerScroll = (): void => {
	outsidePending = false;
};

/** A list's `onTouchEnd`: an outside touch that lifted without scrolling is a
 *  tap outside the row, which ends the mode (iMessage/Slack behaviour). */
export const textSelectionContainerTouchEnd = (): void => {
	if (!outsidePending) return;
	outsidePending = false;
	exitTextSelection();
};

/** A list's `onTouchCancel`: the touch went to another responder (typically the
 *  scroll view taking it over), so it was not a tap. */
export const textSelectionContainerTouchCancel = (): void => {
	outsidePending = false;
};
