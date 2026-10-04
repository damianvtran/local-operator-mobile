import type { ReactNode } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { maxColumnWidth } from "@/ui/column";
import { Heading } from "@/ui/components/heading";
import { headerStacks } from "@/ui/size-class";
import { useTextScale } from "@/ui/text-scale-provider";

/**
 * A screen: the canvas ground, the safe-area insets, and an opaque header
 * (docs/design/components.md § 22).
 *
 * It exists so that safe-area handling is decided ONCE. The kit's rules —
 * `top` on the header, `left`/`right` in landscape, `bottom` on the composer —
 * are easy to apply per screen and impossible to apply consistently per screen,
 * and the failure mode is content under a notch on one device only.
 *
 * The header is opaque on purpose: a translucent header over a scrolling
 * transcript is unreadable at 14pt, and this app's transcript is the whole point.
 * The `canvas` fill behind it is the same ground the content scrolls on.
 */
export type ScreenProps = {
	/** The screen title, in the `display` step. OPTIONAL since the composer home:
	 *  the home's header is its own row (sidebar · computer · avatar) and a 28 pt
	 *  `display` title above a screen with no subject would be the app's third
	 *  largest thing — the spec's decision, and it also keeps the header one 56 pt
	 *  row at every text scale (a titleless header has nothing to stack). */
	title?: string;
	children: ReactNode;
	/** Right-aligned header control (a settings affordance, a new-session button). */
	headerAction?: ReactNode;
	/** Left-aligned header control (a back affordance). */
	headerLeading?: ReactNode;
	/** Screens that own their own scrolling (the transcript) pass false. */
	scroll?: boolean;
	/** `false` leaves the readable-measure cap OFF, for a screen that owns a
	 *  multi-pane layout: a split screen puts a list and a detail side by side, and
	 *  a cap on the WHOLE screen squeezes both (measured: a 560 pt column centred in
	 *  a 1366 pt tablet is a phone layout stretched, which is the gap the design
	 *  round flagged). The screen then applies the readable measure to its own
	 *  content column — `maxColumnWidth` stays the one source of the numbers, so
	 *  this is an opt-out of the cap, never a second measure. Defaults `true`:
	 *  every other screen is byte-for-byte unchanged. */
	capColumn?: boolean;
	/** The width below which THIS screen's header stacks its title. Omitted, the
	 *  kit's floor (`HEADER_STACK_WIDTH`) applies; a heavier action cluster —
	 *  the sessions list's, which can carry two count badges — passes its own
	 *  measured fit instead (`headerStackWidth`). */
	stackBelowWidth?: number;
	testID?: string;
};

/**
 * The readable measure for the current viewport, or `null` on a phone where the
 * column IS the screen.
 *
 * `docs/design/components.md` § 22 fixes all three numbers, and each exists for a
 * different reason: a tablet column caps at 560 so a line of prose does not run
 * 1,200 px wide, a landscape phone caps at 620 for the same reason with less
 * room, and below the tablet breakpoint nothing is constrained at all. The value
 * is a MEASURE, not a fraction of the screen: a percentage would let the column
 * grow with the device, which is the problem the cap exists to solve.
 */
export const Screen = ({
	title,
	children,
	headerAction,
	headerLeading,
	scroll = true,
	capColumn = true,
	stackBelowWidth,
	testID,
}: ScreenProps) => {
	const insets = useSafeAreaInsets();
	/* The column cap comes from `column.ts` (`maxColumnWidth`), which is the ONE
	 * place that reads the token set's device shapes — this file previously carried
	 * its own `useLayout().measure` reading the same numbers, which is two
	 * implementations of one rule. `width: "100%"` is load-bearing: with
	 * `alignSelf: center` alone the container shrink-wraps its children. */
	const viewport = useWindowDimensions();
	/* With the cap opted out the screen is full-bleed — header included, which is
	 *  what a two-pane screen wants: the panes start at the screen edge and the
	 *  readable measure lives INSIDE the pane that holds prose. */
	const columnWidth = capColumn ? maxColumnWidth(viewport) : null;
	const column = columnWidth
		? {
				width: "100%" as const,
				maxWidth: columnWidth,
				alignSelf: "center" as const,
			}
		: undefined;
	/* Two ways the title and the header's controls stop fitting one line, and
	 * the title is the element that gets clipped in both — measured: at 200 %
	 * "Sessions" rendered as "S." with the controls intact, and at 320 pt /
	 * 100 % it rendered "Ses…" (clientW 72 against 106 of text) once the header
	 * carried a count badge and three controls. So the header STACKS instead:
	 * the title keeps a full line, the controls move under it, and no text is
	 * truncated by chrome that cannot shrink. The triggers (large text, or a
	 * viewport below the screen's own bound — the kit floor by default, or the
	 * measured fit a heavier cluster passes as `stackBelowWidth`) live in
	 * `headerStacks` (`size-class.ts`), asserted in a unit test rather than
	 * argued from this comment.
	 *
	 * A TITLELESS header never stacks (the composer home, spec decision 4):
	 * there is no title row to protect, and the width trigger would otherwise
	 * fire on the home's own narrow phone. Titleless is the home today — every
	 * other screen passes a title — so the carve-out moves no other screen. */
	const { effectiveScale } = useTextScale();
	const stackHeader =
		title !== undefined &&
		headerStacks(effectiveScale, viewport.width, stackBelowWidth);
	return (
		<View
			className="flex-1 bg-canvas"
			style={{
				// A hardcoded inset is a defect: the same rules are `env(safe-area-inset-*)`
				// on the web build and `useSafeAreaInsets()` natively, and both must be
				// applied (tokens.json § safeArea).
				paddingTop: insets.top,
				paddingLeft: insets.left,
				paddingRight: insets.right,
				paddingBottom: scroll ? insets.bottom : 0,
			}}
			testID={testID}
		>
			<View
				/* `min-h-14`, not `h-14`: the header's height is a MINIMUM. At 200 %
				 *  text a 56 px display title in a fixed 56 px box is clipped text — the
				 *  audit's U-04 case — so the box grows with its content instead. */
				className={
					stackHeader
						? "min-h-14 justify-center gap-2 px-4 py-2"
						: "min-h-14 flex-row items-center gap-2 px-4 py-2"
				}
				style={column}
			>
				{stackHeader ? (
					<>
						{/* Stacked, the leading control and the title do not share a line: at
						 *  200 % a single-line title beside a control truncates ("Your o…",
						 *  measured at 320 pt), and a title a reader cannot read is the same
						 *  defect as text that does not scale. The title therefore gets its
						 *  own row and may use TWO lines — a cap, not a truncation point, for
						 *  the longest title in the app ("Your own tunnel" fits in one at 2×
						 *  on 390 pt and two at 320). */}
						<View className="flex-row items-center gap-2">{headerLeading}</View>
						{title !== undefined ? (
							<Heading
								level={1}
								className="text-display text-ink"
								numberOfLines={2}
							>
								{title}
							</Heading>
						) : null}
						{/* `flex-wrap` and not a squeeze: the action cluster can hold a count
						 *  badge, an icon button and an avatar, and at 200 % on a 320 pt phone
						 *  the three do not fit on one line — with the default shrink they
						 *  OVERLAP each other rather than wrapping (`U-08`, measured: the
						 *  badge landed 8 pt into the search control). */}
						<View className="flex-row flex-wrap items-center gap-2">
							{headerAction}
						</View>
					</>
				) : (
					<>
						{headerLeading}
						{title !== undefined ? (
							<Heading
								level={1}
								className="flex-1 text-display text-ink"
								numberOfLines={1}
							>
								{title}
							</Heading>
						) : null}
						{headerAction}
					</>
				)}
			</View>
			{scroll ? (
				<ScrollView
					className="flex-1"
					// `grow` on the CONTENT container, not the ScrollView: without it a screen
					// whose only content is an empty state renders it pinned under the header
					// with the rest of the phone blank, and the empty state's own
					// `justify-center` has nothing to centre within. A list that is taller
					// than the viewport is unaffected.
					contentContainerClassName="grow px-4 pt-2 pb-6"
					contentContainerStyle={column}
					keyboardShouldPersistTaps="handled"
				>
					{children}
				</ScrollView>
			) : (
				<View className="flex-1" style={column}>
					{children}
				</View>
			)}
		</View>
	);
};
