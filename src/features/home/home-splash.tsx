import { Info } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
	Pressable,
	ScrollView,
	Text,
	useWindowDimensions,
	View,
} from "react-native";

import {
	GREETING,
	HOME_SUGGESTIONS,
	HOME_TIP_ROTATE_MS,
	STARTING,
	suggestionCountFor,
	tipAt,
} from "@/features/home/home-copy";
import { CONTROL, ROLE, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { BrandMark } from "@/ui/components/brand-mark";
import { TOUCH_FLOOR } from "@/ui/layout";
import { buttonClasses, cx } from "@/ui/variants";

/**
 * The splash: what the home shows before there is anything to show.
 *
 * It is the answer to the one question this screen exists for — "what can this
 * do?" — under a composer that is ready for the answer. Composed from the
 * spec's anatomy: mark, greeting, suggestions, tip, then the composer below (the
 * composer is NOT this component's child; the home composes them, and that is
 * what keeps the composer's foot position invariant in every yield below).
 *
 * **The yield order.** When the free area cannot hold the splash, the splash
 * gives pieces up rather than growing into the composer: the tip goes first, then
 * the mark, then the third suggestion row, and only then does the region scroll
 * (the spec's order, at the sizes it names: the tip is −34 pt at 200 % and the
 * difference between fitting at 348 of 352 and not). The rule behind the order:
 * the greeting and the suggestions are the screen's content; the mark and the tip
 * are its decoration, and decoration yields first.
 *
 * The measurement is two `onLayout`s — the region's box and the content's
 * natural height — and the levels re-run from zero whenever the region changes
 * (rotation, a text-scale change, the keyboard opening), because a yield
 * computed for one box is wrong for the next. Nothing here can move the
 * composer: it is a sibling, and every yield only makes this region shorter.
 *
 * **The tip rotates on twelve seconds and is not announced** (`home-copy.ts`
 * has the pool and the reasons). Its presence is a function of the region's
 * height and the pool at large — never of the current entry's length — and the
 * line is a fixed 20 pt, so a rotation never moves anything below it.
 */
export type HomeSplashProps = {
	draft: string;
	/** The suggestions' slot is the connect action when nothing is connected. */
	connected: boolean;
	onPick: (text: string) => void;
	onConnect: () => void;
	/** The first send is in flight: the splash yields to one line. */
	starting: boolean;
};

/** One suggestion row: the `quiet` variant's language at full width.
 *
 * The rows are not `Button`s because a Button sizes to its label and these are
 * full-width targets (the spec's "full-width ghost rows"); they borrow the
 * variant's own classes so the press feedback is the kit's, not a new one. */
const SuggestionRow = ({
	label,
	onPress,
	testID,
}: {
	label: string;
	onPress: () => void;
	/** Set on the offline state's Connect row (`homeConnect`); the suggestion
	 *  rows themselves carry no ids — they are content, and a flow presses them
	 *  by their label. */
	testID?: string;
}) => (
	<Pressable
		accessibilityRole={ROLE.button}
		onPress={onPress}
		testID={testID}
		style={{ minHeight: TOUCH_FLOOR }}
	>
		{({ pressed }) => (
			<View className={cx(buttonClasses("quiet", "md", { pressed }), "w-full")}>
				<Text
					className={pressed ? "text-ink" : "text-ink-muted"}
					numberOfLines={1}
				>
					{label}
				</Text>
			</View>
		)}
	</Pressable>
);

/** The tip's own line height, fixed: the spec's 20 pt. A tick that changed the
 *  line's height would move everything under it (the desktop's rule). */
const TIP_LINE_PX = 20;

export const HomeSplash = ({
	draft,
	connected,
	onPick,
	onConnect,
	starting,
}: HomeSplashProps) => {
	const markColor = useTokenColor("ink-muted");
	const tipColor = useTokenColor("ink-dim");
	const { width } = useWindowDimensions();

	/* The tip's clock: suspended while the composer holds a draft — a line that
	 * changed under a half-written sentence would pull at the exact field the
	 * reader is typing into. The index is kept across the suspension (suspended,
	 * not restarted). */
	const [tipIndex, setTipIndex] = useState(0);
	useEffect(() => {
		if (starting || draft !== "") return;
		const timer = setInterval(
			() => setTipIndex((index) => index + 1),
			HOME_TIP_ROTATE_MS,
		);
		return () => clearInterval(timer);
	}, [draft, starting]);

	/* The yield's two measurements and its level (0: everything, 1: no tip,
	 * 2: no mark, 3: one fewer suggestion row). The level is DERIVED against the
	 * region it was answered for, so a new box invalidates the old answer in the
	 * same render — the earlier shape reset it from an effect, which ran one
	 * render late and flashed the un-yielded frame on every resize. */
	const [regionHeight, setRegionHeight] = useState(0);
	const [contentHeight, setContentHeight] = useState(0);
	const [yielded, setYielded] = useState({ region: 0, level: 0 });

	useEffect(() => {
		if (regionHeight <= 0 || contentHeight <= 0) return;
		const level = yielded.region === regionHeight ? yielded.level : 0;
		if (contentHeight > regionHeight && level < 3) {
			setYielded({ region: regionHeight, level: level + 1 });
		}
	}, [contentHeight, regionHeight, yielded]);

	const level = yielded.region === regionHeight ? yielded.level : 0;
	const fits = contentHeight === 0 || contentHeight <= regionHeight;
	const rows = HOME_SUGGESTIONS.slice(
		0,
		connected ? suggestionCountFor(width) : 0,
	);
	const visibleRows =
		level >= 3 && rows.length > 2 ? rows.slice(0, rows.length - 1) : rows;

	if (starting) {
		return (
			<View className="flex-1 items-center justify-center px-4">
				{/* The state marker IS this line's id (`STATE_MARKER.home.sending`
				 *  aliases `SURFACE.homeStarting`): the line exists exactly while the
				 *  state does, so a second carrier would be a second thing to drift. */}
				<Text
					className="text-body text-ink-muted"
					testID={SURFACE.homeStarting}
				>
					{STARTING}
				</Text>
			</View>
		);
	}

	return (
		<View
			className="flex-1"
			onLayout={(event) => setRegionHeight(event.nativeEvent.layout.height)}
			testID={SURFACE.homeSplash}
		>
			<ScrollView
				className="flex-1"
				contentContainerClassName={cx(
					"items-center gap-6 px-4 py-3",
					fits ? "flex-grow justify-center" : "",
				)}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={false}
			>
				<View
					className="w-full items-center gap-6"
					onLayout={(event) =>
						setContentHeight(event.nativeEvent.layout.height)
					}
				>
					{level < 2 ? <BrandMark size={32} color={markColor} /> : null}
					<Text
						className="text-center text-title text-ink"
						testID={SURFACE.homeGreeting}
					>
						{GREETING}
					</Text>
					{connected ? (
						<View className="w-full gap-3" testID={SURFACE.homeSuggestions}>
							{visibleRows.map((label) => (
								<SuggestionRow
									key={label}
									label={label}
									onPress={() => onPick(label)}
								/>
							))}
						</View>
					) : (
						/* The connect card takes the chips' slot: with nothing connected
						 *  there is nothing to ask yet, so the one move that changes the
						 *  state is the only control. */
						<SuggestionRow
							label="Connect a computer"
							onPress={onConnect}
							testID={CONTROL.homeConnect}
						/>
					)}
					{level < 1 ? (
						<View
							className="flex-row items-center gap-1.5"
							style={{ height: TIP_LINE_PX }}
							testID={SURFACE.homeTip}
							/* Ambient: no affordance, no announcement, no live region. Asking
							 *  assistive technology to read it would spam a sentence every
							 *  rotation. */
							aria-hidden
							importantForAccessibility="no"
						>
							<Info color={tipColor} size={12} />
							<Text className="text-meta text-ink-dim" numberOfLines={1}>
								{tipAt(tipIndex)}
							</Text>
						</View>
					) : null}
				</View>
			</ScrollView>
		</View>
	);
};
