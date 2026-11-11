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
 *    or a scroll (the lists call the store), on blur, or when another message
 *    enters it.
 *  - Formatting is dropped while selecting (the plain text is what Copy puts
 *    on the pasteboard, as in Slack's "Select text"); it returns on exit.
 */
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useId,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { Pressable, Text, TextInput, type TextProps, View } from "react-native";

import {
	activeTextSelection,
	enterTextSelection,
	exitTextSelection,
	leafSelectable,
	noteTextSelectionTouch,
	selectionEndsMode,
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
};

const NOOP_CONTEXT: TextSelectionContextValue = {
	enter: () => {},
	selectionColor: undefined,
};

const TextSelectionContext =
	createContext<TextSelectionContextValue>(NOOP_CONTEXT);

/** For leaves and nested pressables inside a `SelectableMessage`. */
export const useTextSelection = (): TextSelectionContextValue =>
	useContext(TextSelectionContext);

/**
 * The selection colour role per platform. iOS takes it as the input's
 * `tintColor` (handles + caret, with UIKit deriving the translucent highlight),
 * so it wants the solid accent. Android paints `selectionColor` as an opaque
 * highlight BEHIND the glyphs, so the solid accent would bury the ink; the
 * accent wash is the palette's own "selected background" step.
 */
export const selectionColorRole = (os: string): "accent" | "accent-wash" =>
	os === "ios" ? "accent" : "accent-wash";

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
	const selectionColor = useTokenColor(
		selectionColorRole(usesSelectionMode() ? "ios" : "other"),
	);
	const id = useId();
	const selecting = useSyncExternalStore(
		subscribeTextSelection,
		() => activeTextSelection() === id,
		() => false,
	);
	const sawRange = useRef(false);
	/* Stable per text: a fresh object on an unrelated re-render (a theme flip)
	 *  would push select-all again and wipe the range the reader dragged. */
	const plain = useMemo(
		() => (selecting ? (typeof text === "function" ? text() : text) : ""),
		[selecting, text],
	);
	const initialSelection = useMemo(
		() => ({ start: 0, end: plain.length }),
		[plain],
	);

	const enter = useCallback(() => {
		if (disabled || !usesSelectionMode()) return;
		sawRange.current = false;
		enterTextSelection(id);
	}, [disabled, id]);

	const context = useMemo(
		() => ({ enter, selectionColor }),
		[enter, selectionColor],
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
					// Read-only UITextView: selectable with handles, never editable.
					editable={false}
					multiline
					// The row grows to the text; the transcript list does the scrolling.
					scrollEnabled={false}
					autoFocus
					// Pre-select the whole message so the handles are on screen at
					// once; the reader drags them in to the part they want.
					selection={initialSelection}
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
	const { selectionColor } = useTextSelection();
	return (
		<Text
			selectable={LEAF_SELECTABLE}
			selectionColor={selectionColor}
			{...props}
		/>
	);
}

/** UITextView's default text-container inset is RN's padding, which is 0 here;
 *  pinning it keeps the selection view on the rendered body's line box. */
const SELECTION_INPUT_STYLE = { padding: 0, margin: 0 } as const;
