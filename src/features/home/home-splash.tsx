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
	draftExistsFor,
	GREETING,
	HOME_TIP_ROTATE_MS,
	STARTING,
	suggestionSlotFor,
	tipAt,
} from "@/features/home/home-copy";
import { CONTROL, ROLE, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { BrandMark } from "@/ui/components/brand-mark";
import { TOUCH_FLOOR } from "@/ui/layout";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { TYPE_STEPS } from "@/ui/tokens.gen";
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
 * height and the pool at large — never of the current entry's length — and its
 * reserve is fixed for the scale (one `meta` line, two at large text, where the
 * line would otherwise paint wider than the phone and be cut at both ends —
 * review round 3, D2), so a rotation never moves anything below it.
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
 * variant's own classes so the press feedback is the kit's, not a new one.
 *
 * **The rest boundary is a rule under the row** (design D5): without one the
 * rows read as static centred copy rather than as a control, and the kit already
 * has this grammar for a full-width row — the panel's own New chat row rules
 * itself the same way. It is painted INLINE from the `hairline` token rather
 * than with `border-hairline`: the row borrows the `quiet` variant's classes,
 * and that variant paints `border-transparent` — both are border-colour
 * utilities, the compiler orders them, and the measured result was
 * `border-hairline` LOSING and the rule not painting at all. Inline wins
 * deterministically and reads the same token. The rule is decorative (the row
 * is full-bleed and every pixel of its width is the target), which is exactly
 * the hairline's role; it is never a control's sole boundary. */
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
}) => {
	const rowEdge = useTokenColor("hairline");
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			onPress={onPress}
			testID={testID}
			style={{ minHeight: TOUCH_FLOOR }}
		>
			{({ pressed }) => (
				<View
					className={cx(buttonClasses("quiet", "md", { pressed }), "w-full")}
					style={{ borderBottomColor: rowEdge, borderBottomWidth: 1 }}
				>
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
};

/** The tip's own line height at 100 %: the spec's 20 pt. A tick that changed the
 *  line's height would move everything under it (the desktop's rule) — the
 *  height is therefore fixed PER SCALE, and the two numbers that fix it are
 *  this one and the reserve below. */
const TIP_LINE_PX = 20;

/** The reserve the tip rotates inside at a text scale: one `meta` line at
 *  normal text, two above `LARGE_TEXT_SCALE` — computed from the ONE type
 *  table (`tokens.gen`), not hand-copied, so it moves with the tokens.
 *
 *  Why two lines are the large-text shape: at 200 % the pool's own budget
 *  paints ~444-497 dp against a 358 dp content column on a 390 pt phone, and
 *  the longest entry still wraps to two lines on a 320 pt phone (each line
 *  holds roughly half its 45 glyphs), so two lines is what the copy needs and
 *  the clamp below is its mop-up exactly as `numberOfLines={1}` was at 100 %.
 *  FIXED for the scale — never for the current entry's length — so a rotation
 *  moves nothing below it; a scale change re-measures the whole splash anyway
 *  (the two `onLayout`s), which is the one case this number is allowed to
 *  change in. */
const tipReserveDp = (scale: number, largeText: boolean): number =>
	largeText
		? 2 * TYPE_STEPS.meta.size * scale * TYPE_STEPS.meta.lineHeight
		: TIP_LINE_PX;

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
	const { effectiveScale } = useTextScale();
	const largeText = effectiveScale > LARGE_TEXT_SCALE;

	/* The tip's clock: suspended while the composer holds a draft — a line that
	 * changed under a half-written sentence would pull at the exact field the
	 * reader is typing into. The index is kept across the suspension (suspended,
	 * not restarted). The held-draft predicate is `draftExistsFor`, shared with
	 * the suggestions' slot below and the state marker, so a whitespace-only
	 * draft cannot freeze the tip while the frame declares `idle` (review n2). */
	const [tipIndex, setTipIndex] = useState(0);
	useEffect(() => {
		if (starting || draftExistsFor(draft)) return;
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
	/* The slot's contents are decided in ONE place (`suggestionSlotFor`), which
	 *  is also where review B1's fix lives: while a draft is held the slot is
	 *  empty — a suggestion's tap REPLACES the field's text, so a live row beside
	 *  a held draft is a silent overwrite (spec decision 6, §3.5). */
	const slot = suggestionSlotFor({ connected, draft, width });
	const rows = slot.kind === "suggestions" ? slot.rows : [];
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
					{slot.kind === "suggestions" ? (
						<View className="w-full gap-3" testID={SURFACE.homeSuggestions}>
							{visibleRows.map((label) => (
								<SuggestionRow
									key={label}
									label={label}
									onPress={() => onPick(label)}
								/>
							))}
						</View>
					) : slot.kind === "connect" ? (
						/* The connect card takes the chips' slot: with nothing connected
						 *  there is nothing to ask yet, so the one move that changes the
						 *  state is the only control. It survives a held draft (it replaces
						 *  nothing); only the suggestions hide — see `suggestionSlotFor`. */
						<SuggestionRow
							label="Connect a computer"
							onPress={onConnect}
							testID={CONTROL.homeConnect}
						/>
					) : null}
					{level < 1 ? (
						/* At large text the row takes the content width and the line WRAPS
						 *  inside the reserve — the fix for the 200 % cut: a centred
						 *  content-sized row painted ~462 dp against a 390 dp viewport and
						 *  lost BOTH ends (measured: right edge 426 vs 390). The width is the
						 *  wrap's constraint, `justify-center` keeps the icon-and-line group
						 *  centred, and `text-center` centres the wrapped lines. At 100 %
						 *  nothing moves: same content-sized row, same 20 pt reserve, same
						 *  one clamped line. No font shrink and no hidden overflow: the
						 *  reserve is sized from the type table, and the clamp is the mop-up
						 *  the line always had. */
						<View
							className={cx(
								"flex-row items-center gap-1.5",
								largeText && "w-full justify-center",
							)}
							style={{ minHeight: tipReserveDp(effectiveScale, largeText) }}
							testID={SURFACE.homeTip}
							/* Ambient: no affordance, no announcement, no live region. Asking
							 *  assistive technology to read it would spam a sentence every
							 *  rotation. */
							aria-hidden
							importantForAccessibility="no"
						>
							<Info color={tipColor} size={12} />
							<Text
								className={cx(
									"text-meta text-ink-dim",
									largeText && "text-center",
								)}
								numberOfLines={largeText ? 2 : 1}
							>
								{tipAt(tipIndex)}
							</Text>
						</View>
					) : null}
				</View>
			</ScrollView>
		</View>
	);
};
