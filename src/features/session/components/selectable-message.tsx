/**
 * `SelectableMessage` — wraps one message body (an answer's markdown, a user
 * prompt, a tool's output well, a Team Bridge message) so the reader can
 * long-press and drag-select part of it, then use the system Copy / Share menu.
 *
 * The platform split and its React Native source citations live in
 * `text-selection.ts`. In short: Android and web select natively on the leaf
 * `<Text selectable>`, so this component renders its children untouched there;
 * iOS has no drag handles on `<Text>`, so a long-press swaps the rendered body
 * for a read-only multiline `TextInput` (a `UITextView`) holding `text`, with
 * the whole message pre-selected so the handles show immediately.
 *
 * Constraints it keeps:
 *  - TAPS STILL WORK. Only `onLongPress` is attached; a link span, an image or
 *    a code block's copy-on-tap is a deeper responder and wins its own tap.
 *  - MEMOISATION HOLDS. Each instance subscribes to a boolean ("am I the active
 *    one?"), so entering the mode re-renders this row and the row it replaced,
 *    never the list. The context value is stable across renders.
 *  - THE MODE ENDS on a tap that collapses the selection, a tap outside the row
 *    (the lists call the store), on blur, when another message enters it, or
 *    when the row unmounts. NOT on a scroll (design R1, D3): the reader must be
 *    able to scroll to a long message's off-screen handle.
 *  - Formatting is dropped while selecting (the plain text is what Copy puts
 *    on the pasteboard, as in Slack's "Select text"); it returns on exit.
 *  - THE SELECTION IS UNCONTROLLED (PR #233 review R1, B1). Select-all is sent
 *    once, imperatively, after the view mounts; after that the reader's handles
 *    own the range. A `selection` prop would re-impose `{0, len}` on every drag
 *    (RN 0.86.3 `TextInput.js`: each `onSelectionChange` re-renders through
 *    `setLastNativeSelection`, `:531-534`, and the sync layout effect at
 *    `:208-216` re-sends the prop whenever the native range differs; native
 *    accepts it because a read-only input never bumps its event count).
 *  - THE TEXT IS A SNAPSHOT taken on entry, so a streaming answer cannot move
 *    the selection under the reader's handles (review R1, m3).
 *  - VOICEOVER STILL REACHES THE PARTS (review R1, M1). The long-press wrapper
 *    is `accessible={false}`: an accessible iOS container hides its children,
 *    which would swallow the links and the code block's copy button. VoiceOver
 *    users enter the mode through a "Select text" action on each body leaf.
 */
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type AccessibilityActionEvent,
	Pressable,
	Text,
	TextInput,
	type TextProps,
	View,
} from "react-native";

import {
	activeTextSelection,
	enterTextSelection,
	exitTextSelection,
	leafSelectable,
	noteTextSelectionTouch,
	selectionEndsMode,
	selectionHighlight,
	subscribeTextSelection,
	usesSelectionMode,
} from "@/features/session/text-selection";
import { useTokenColor } from "@/ui/appearance";

type TextSelectionContextValue = {
	/** Enter this message's selection mode (iOS); a no-op elsewhere, which also
	 *  keeps a nested Pressable's long hold from falling through to its tap. */
	enter: () => void;
	/** The theme's selection tint for leaf `<Text selectable>`. */
	selectionColor: string | undefined;
	/** Spread onto each body leaf: VoiceOver's way into the mode (iOS), empty
	 *  where the leaf selects natively or there is no mode. */
	accessibility: SelectTextAccessibility;
};

type SelectTextAccessibility = Pick<
	TextProps,
	"accessibilityActions" | "onAccessibilityAction"
>;

/** The custom rotor action's name; the label is what VoiceOver speaks. */
export const SELECT_TEXT_ACTION = "selectText";
const SELECT_TEXT_ACTIONS = [
	{ name: SELECT_TEXT_ACTION, label: "Select text" },
];

const NO_ACCESSIBILITY: SelectTextAccessibility = {};

const NOOP_CONTEXT: TextSelectionContextValue = {
	enter: () => {},
	selectionColor: undefined,
	accessibility: NO_ACCESSIBILITY,
};

const TextSelectionContext =
	createContext<TextSelectionContextValue>(NOOP_CONTEXT);

/** For leaves and nested pressables inside a `SelectableMessage`. */
export const useTextSelection = (): TextSelectionContextValue =>
	useContext(TextSelectionContext);

export function SelectableMessage({
	text,
	children,
	textClassName,
	disabled = false,
	testID,
}: {
	/** The plain text the selection view shows and Copy writes. A function is
	 *  read only on entering the mode, so a streamed answer is not flattened
	 *  on every token for a view nobody opened. */
	text: string | (() => string);
	children: ReactNode;
	/** Typography for the selection view, matching the rendered body. */
	textClassName: string;
	/** A clamped one-line preview is not a reading surface; no mode for it. */
	disabled?: boolean;
	testID?: string;
}) {
	/* The selection colour per platform. iOS takes it as the input's
	 *  `tintColor` (handles + caret; UIKit derives the translucent highlight),
	 *  so it wants the solid accent (handles >= 3.72:1 on every surface, design
	 *  R1). Android paints `selectionColor` as the highlight BEHIND the glyphs,
	 *  so it gets the accent near 30 % alpha (`selectionHighlight`, derived per
	 *  theme from its tokens) — the solid accent would bury the ink, and the old
	 *  `accent-wash` was invisible (design R1, D1). */
	const accent = useTokenColor("accent");
	/* The roles the Android highlight is derived against, read live like the
	 *  accent (`useTokenColor` tracks a theme switch). Five unconditional hook
	 *  calls rather than the palette object, so every row reads the same
	 *  source the rest of the app's non-className colours do. */
	const ink = useTokenColor("ink");
	const messageSurface = useTokenColor("message-surface");
	const userBubble = useTokenColor("user-bubble");
	const sunken = useTokenColor("sunken");
	// iOS: the solid accent as tint. Elsewhere: the translucent highlight.
	const selectionColor = usesSelectionMode()
		? accent
		: selectionHighlight({
				accent,
				ink,
				"message-surface": messageSurface,
				"user-bubble": userBubble,
				sunken,
			});
	const id = useId();
	const selecting = useSyncExternalStore(
		subscribeTextSelection,
		() => activeTextSelection() === id,
		() => false,
	);
	const sawRange = useRef(false);
	const input = useRef<TextInput>(null);
	/* Read through a ref so `enter` (and the context consumers) stay stable when
	 *  a caller hands a fresh function per render. */
	const latestText = useRef(text);
	latestText.current = text;
	/* The snapshot shown while selecting, taken once on entry (see the header:
	 *  a streamed token must not reset the reader's range). */
	const [plain, setPlain] = useState("");

	const enter = useCallback(() => {
		if (disabled || !usesSelectionMode()) return;
		sawRange.current = false;
		const current = latestText.current;
		setPlain(typeof current === "function" ? current() : current);
		enterTextSelection(id);
	}, [disabled, id]);

	/* A row that leaves the list while selecting (FlatList windowing unmounts
	 *  it once the reader scrolls far enough) takes the mode with it, so no
	 *  orphaned id keeps the store "active" with nothing on screen (design R1,
	 *  D3: scrolling no longer ends the mode by itself). Id-scoped, so a row
	 *  unmounting never closes the row that took over. */
	useEffect(() => () => exitTextSelection(id), [id]);

	/* Select-all ONCE per entry, imperatively (`TextInput.js:483-493`,
	 *  `setSelection` -> `setTextAndSelection`), so the handles are on screen at
	 *  once and are the reader's from then on. Keyed on entry, not on renders. */
	useEffect(() => {
		if (selecting) input.current?.setSelection(0, plain.length);
	}, [selecting, plain]);

	const accessibility = useMemo<SelectTextAccessibility>(
		() =>
			disabled || !usesSelectionMode()
				? NO_ACCESSIBILITY
				: {
						accessibilityActions: SELECT_TEXT_ACTIONS,
						onAccessibilityAction: (event: AccessibilityActionEvent) => {
							if (event.nativeEvent.actionName === SELECT_TEXT_ACTION) enter();
						},
					},
		[disabled, enter],
	);

	const context = useMemo(
		() => ({ enter, selectionColor, accessibility }),
		[enter, selectionColor, accessibility],
	);

	if (!usesSelectionMode() || disabled) {
		return (
			<TextSelectionContext.Provider value={context}>
				{children}
			</TextSelectionContext.Provider>
		);
	}

	if (selecting) {
		return (
			<View onTouchStart={noteTextSelectionTouch} testID={testID}>
				<TextInput
					ref={input}
					// Read-only UITextView: selectable with handles, never editable.
					editable={false}
					multiline
					// The row grows to the text; the transcript list does the scrolling.
					scrollEnabled={false}
					autoFocus
					// NO `selection` prop: select-all is the effect above, once.
					value={plain}
					selectionColor={selectionColor}
					className={textClassName}
					style={SELECTION_INPUT_STYLE}
					onSelectionChange={({ nativeEvent: { selection } }) => {
						if (selectionEndsMode(selection, sawRange.current)) {
							exitTextSelection(id);
							return;
						}
						if (selection.start !== selection.end) sawRange.current = true;
					}}
					onBlur={() => exitTextSelection(id)}
				/>
			</View>
		);
	}

	return (
		<TextSelectionContext.Provider value={context}>
			<Pressable
				// No `onPress`: taps belong to the links, images and code blocks
				// inside, and to the row around this body.
				onLongPress={enter}
				// Not one VoiceOver element: the links and copy buttons inside
				// must stay individually reachable (review R1, M1).
				accessible={false}
				testID={testID}
			>
				{children}
			</Pressable>
		</TextSelectionContext.Provider>
	);
}

const LEAF_SELECTABLE = leafSelectable();

/** A plain-`Text` body leaf inside a `SelectableMessage`: natively selectable
 *  where the platform supports drag handles on `Text` (Android, web), tinted
 *  with the theme's selection colour. On iOS it is a plain `Text`; the mode
 *  does the selecting. */
export function SelectableLeafText(props: TextProps & { className?: string }) {
	const { selectionColor, accessibility } = useTextSelection();
	return (
		<Text
			selectable={LEAF_SELECTABLE}
			selectionColor={selectionColor}
			{...accessibility}
			{...props}
		/>
	);
}

/** UITextView's default text-container inset is RN's padding, which is 0 here;
 *  pinning it keeps the selection view on the rendered body's line box. */
const SELECTION_INPUT_STYLE = { padding: 0, margin: 0 } as const;
