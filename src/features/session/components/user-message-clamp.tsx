import {
	createContext,
	type RefObject,
	useCallback,
	useContext,
	useId,
	useRef,
	useState,
} from "react";
import { type LayoutChangeEvent, Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { userBubbleFill } from "@/features/session/user-bubble";
import {
	needsUserMessageClamp,
	nextUserMessageExpanded,
	USER_MESSAGE_FADE_LINES,
	userMessageClipHeight,
	userMessageControlMarginTop,
	userMessageLineHeight,
} from "@/features/session/user-message-clamp";
import { t } from "@/i18n";
import { ROLE } from "@/ui/a11y";
import { useTheme } from "@/ui/appearance";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";

/**
 * The clamp-and-release wrapper around the reader's own message text: the
 * desktop's eight-line clamp with `Show more` / `Show less`
 * (`user-message-clamp.ts` carries the why and the numbers).
 *
 * A WRAPPER, NOT A TEXT PROP. The message's `<Text>` is passed in untouched —
 * no `numberOfLines`, no `onTextLayout`, no restyle — because text
 * selectability on transcript rows is owned elsewhere, and a `numberOfLines`
 * clamp both truncates what a selection can reach and reports only the
 * visible lines. Instead the content sits in an inner view whose height is
 * its FULL laid-out height (a column child does not shrink: RN's `flexShrink`
 * default is 0), inside an outer view that clips to the clamp height.
 *
 * NO MEASURE LOOP, NO JUMP. The clip is applied from the first frame, before
 * any measurement, so a long message never paints in full and then snaps
 * shut; the measurement only decides whether the fade and the control show.
 * The inner view's height does not depend on the clip, so re-measuring can
 * never feed back into itself, and the state is a primitive that React
 * bails out of when a re-layout reports the same height. The same path works
 * on react-native-web, where `onTextLayout` never fires.
 *
 * The expand state is the CALLER's when it supplies both halves (the list's
 * row-open map, so windowing does not re-clamp a message the reader opened,
 * and a find landing on the row opens it); otherwise it is held here.
 */
/**
 * How a clamp asks its scroller to keep a collapsing bubble's top in view
 * (design follow-up to PR #235, D2; `collapseScrollOffset` carries the why).
 * PROVIDED BY THE SCROLLER, not passed down as a prop: the transcript list
 * owns the scroll offset and its viewport, while the clamp sits two components
 * deep in a memoised row — and in the list's footer for a pending echo, which
 * is not a row at all. A context reaches both without threading a callback
 * through every row's props (and re-rendering every memoised row when it
 * changed). Absent (`null`), a clamp outside a scroller collapses in place.
 */
export const UserMessageCollapseContext = createContext<
	((anchor: View) => void) | null
>(null);

export const UserMessageClamp = ({
	expanded: controlledExpanded,
	onToggle,
	anchorRef,
	testID,
	children,
}: {
	expanded?: boolean;
	onToggle?: (next: boolean) => void;
	/** The bubble whose top `Show less` keeps in view (D2). The bubble, not this
	 *  clamp: the clamp sits inside the bubble's padding (and under a pending
	 *  echo's attachment count), and it is the bubble's edge the reader reads
	 *  as "the message". Omitted, the clamp's own top is used. */
	anchorRef?: RefObject<View | null>;
	testID?: string;
	/** The message. A FUNCTION form is handed the clamp's open-if-closed
	 *  action (`expand`, below) for a body that must open the clamp itself —
	 *  the iOS selection mode (PR #237 review, R1-m1). A render function rather
	 *  than a context because the row builds its body outside the clamp, where
	 *  no hook can read one. */
	children: React.ReactNode | ((expand: () => void) => React.ReactNode);
}) => {
	const [ownExpanded, setOwnExpanded] = useState(false);
	const expanded =
		controlledExpanded !== undefined && onToggle !== undefined
			? controlledExpanded
			: ownExpanded;
	const [contentHeight, setContentHeight] = useState<number | null>(null);
	const { effectiveScale } = useTextScale();
	const clipHeight = userMessageClipHeight(effectiveScale);
	const clamped =
		contentHeight !== null &&
		needsUserMessageClamp(contentHeight, effectiveScale);

	const keepInView = useContext(UserMessageCollapseContext);
	const ownRef = useRef<View | null>(null);
	const controlled = controlledExpanded !== undefined && onToggle !== undefined;

	const onContentLayout = (event: LayoutChangeEvent) => {
		setContentHeight(event.nativeEvent.layout.height);
	};
	const setExpanded = useCallback(
		(next: boolean) => {
			if (controlled && onToggle) {
				onToggle(next);
				return;
			}
			setOwnExpanded(next);
		},
		[controlled, onToggle],
	);
	const toggle = () => {
		const next = nextUserMessageExpanded(expanded);
		setExpanded(next);
		if (!next) {
			const anchor = anchorRef?.current ?? ownRef.current;
			if (anchor && keepInView) keepInView(anchor);
		}
	};
	/* Opens the clamp if it is clamped and closed; a no-op otherwise (R1-m1).
	 *  On iOS a long-press swaps the message for a read-only text view that
	 *  selects everything, and inside a closed clamp that view was clipped at
	 *  eight lines, so its END handle sat below the clip where no finger could
	 *  reach it: the message has to open before the handles appear. A no-op
	 *  when nothing is hidden, so an unclamped message never writes an "open"
	 *  the list would then wait on as a resize that never comes
	 *  (`toggleRowOpen`'s m-r2-1). */
	const expand = useCallback(() => {
		if (clamped && !expanded) setExpanded(true);
	}, [clamped, expanded, setExpanded]);

	return (
		<>
			<View
				ref={ownRef}
				style={
					expanded ? undefined : { maxHeight: clipHeight, overflow: "hidden" }
				}
			>
				<View onLayout={onContentLayout}>
					{typeof children === "function" ? children(expand) : children}
				</View>
				{clamped && !expanded ? (
					<BubbleFade
						height={
							USER_MESSAGE_FADE_LINES * userMessageLineHeight(effectiveScale)
						}
					/>
				) : null}
			</View>
			{clamped ? (
				<Pressable
					testID={testID}
					accessibilityRole={ROLE.button}
					accessibilityLabel={t(
						expanded
							? "mobile.session.user_message.show_less"
							: "mobile.session.user_message.show_more",
					)}
					accessibilityState={{ expanded }}
					onPress={toggle}
					/* The floor is real geometry, not `hitSlop`: react-native-web
					 *  drops Pressable hitSlop (`ask-bar.tsx`). Full width inside the
					 *  bubble and centred, the desktop's idiom (D2): the clamp and its
					 *  release are one object, so no rule sits between them. */
					style={{
						minHeight: TOUCH_FLOOR,
						// Collapsed, pulled up over the fade so only 32 pt is new
						// height; the floor stays whole (D1, `USER_MESSAGE_MORE_GROWTH`).
						// Drawn after the clip, so it sits above the fade for touches.
						marginTop: userMessageControlMarginTop(expanded, TOUCH_FLOOR),
					}}
					className="w-full items-center justify-center"
				>
					<Text className="text-meta text-ink-muted">
						{t(
							expanded
								? "mobile.session.user_message.show_less"
								: "mobile.session.user_message.show_more",
						)}
					</Text>
				</Pressable>
			) : null}
		</>
	);
};

/**
 * The fade over the clipped block's last line and a half, drawn to the
 * bubble's OWN fill (`userBubbleFill`, read from the active palette as the
 * bubble itself is) so it dissolves into the bubble in every theme, light or
 * dark. An SVG gradient because `react-native-svg` is already the kit's
 * gradient (the table scroll cue in `markdown.tsx`, the sheet's edge);
 * `expo-linear-gradient` is not a dependency. Decorative: hidden from
 * assistive tech and transparent to touches, so a press on it still reaches
 * the text beneath.
 */
const BubbleFade = ({ height }: { height: number }) => {
	const { active } = useTheme();
	const colour = userBubbleFill(active).backgroundColor;
	// One id per mounted fade: SVG gradient ids are document-global on web.
	const id = `user-message-fade-${useId().replace(/:/g, "")}`;
	return (
		<View
			pointerEvents="none"
			aria-hidden
			style={{ position: "absolute", start: 0, end: 0, bottom: 0, height }}
		>
			<Svg width="100%" height="100%">
				<Defs>
					<LinearGradient id={id} x1="0%" y1="0%" x2="0%" y2="100%">
						<Stop offset="0" stopColor={colour} stopOpacity={0} />
						<Stop offset="1" stopColor={colour} stopOpacity={1} />
					</LinearGradient>
				</Defs>
				<Rect width="100%" height="100%" fill={`url(#${id})`} />
			</Svg>
		</View>
	);
};
