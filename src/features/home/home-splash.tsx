import { ChevronRight } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
	AccessibilityInfo,
	ActivityIndicator,
	findNodeHandle,
	Platform,
	Pressable,
	ScrollView,
	Text,
	useWindowDimensions,
	View,
} from "react-native";
import {
	heroHeldInset,
	heroMeasured,
	heroTopInset,
} from "@/features/home/hero-layout";
import { startingLine, suggestionSlotFor } from "@/features/home/home-copy";
import { t } from "@/i18n";
import { ROLE, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Button } from "@/ui/components/button";
import { TOUCH_FLOOR } from "@/ui/layout";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { CONTROL_HEIGHTS, TYPE_STEPS } from "@/ui/tokens.gen";
import { cx } from "@/ui/variants";

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
	editing?: boolean;
	/** The suggestions' slot is the connect action when nothing is connected. */
	connected: boolean;
	onPick: (text: string) => void;
	onConnect: () => void;
	/** The first send is in flight: the splash yields to one line. */
	starting: boolean;
	/** Bump to move focus to the greeting (UX U5): the home asks after a
	 *  Retry the reader pressed succeeds, because the alert that held focus
	 *  unmounts. 0 / unchanged never moves anything. */
	focusRequest?: number;
};

/** One suggestion row: the `quiet` variant's language at full width.
 *
 * The rows are not `Button`s because a Button sizes to its label and these are
 * full-width targets (the spec's "full-width ghost rows"): a 44 pt row, the
 * label at the greeting's edge and a trailing chevron that says "this goes
 * somewhere" (design spec §2).
 *
 * **No rule between rows** (user feedback, this batch). A hairline under each row
 * turned a stack of controls into a table: the divider is the desktop's list
 * grammar, not its suggestion grammar. The desktop's measured stack does exactly
 * what these rows do now — text at rest, a `bg-elevated` surface on the row under
 * the pointer. The row stays full-bleed with its 44 pt floor, so the whole
 * width is still the target and no boundary is needed to find it.
 *
 * The one-line cap was calibrated at 100 % text scale. Large text instead gets
 * two left-aligned lines, so longer localized labels remain
 * readable rather than ending in an ellipsis. The minimum touch height stays a
 * floor: the row and its pressed surface grow with the wrapped label. */
const SuggestionRow = ({
	label,
	largeText,
	onPress,
	testID,
}: {
	label: string;
	largeText: boolean;
	onPress: () => void;
	/** Set on the offline state's Connect row (`homeConnect`); the suggestion
	 *  rows themselves carry no ids — they are content, and a flow presses them
	 *  by their label. */
	testID?: string;
}) => {
	const chevronInk = useTokenColor("ink-dim");
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			onPress={onPress}
			testID={testID}
			style={{ minHeight: TOUCH_FLOOR }}
		>
			{({ pressed }) => (
				<View
					/* LEFT-ALIGNED ROWS under a left-aligned greeting (design spec §2):
					 *  two centred items under a left heading were the mixed rail the
					 *  operator read as unfinished. The row's own 12 pt inset is pulled
					 *  back by an equal negative margin (`-mx-3 px-3`), so the LABEL
					 *  shares the greeting's 16 pt edge to +0 pt while the pressed
					 *  surface still has room around it. `elevated` is the token the
					 *  desktop's `hover:bg-elevated` uses, so one gesture means one
					 *  thing on both clients; no rule between rows (a divider turned
					 *  the stack into a table). */
					className={cx(
						"-mx-3 min-h-11 flex-row items-center justify-between gap-2 rounded-sm px-3",
						pressed && "bg-elevated",
					)}
				>
					{/* A NAMED TYPE ROLE, never a bare colour class (a bare class held
					 *  14 px at 200 % and failed the capture's text-scale check). `body`
					 *  (16, `ink-muted`, 8.60:1) is the spec's step for these rows: they
					 *  are the hero's actions, and `body-sm` under a `display` greeting
					 *  read as a caption. At large text a label may wrap to two lines,
					 *  still left-aligned, so a long localization is read whole. */}
					<Text
						className={cx(
							"min-w-0 flex-1 text-body",
							pressed ? "text-ink" : "text-ink-muted",
						)}
						numberOfLines={largeText ? 2 : 1}
					>
						{label}
					</Text>
					<ChevronRight
						size={CONTROL_HEIGHTS.md.icon}
						color={chevronInk}
						aria-hidden
					/>
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
const _tipReserveDp = (scale: number, largeText: boolean): number =>
	largeText
		? 2 * TYPE_STEPS.meta.size * scale * TYPE_STEPS.meta.lineHeight
		: TIP_LINE_PX;

/** Connected empty state only. Recovery lives at the home composition boundary:
 * never paint a welcome/connect hero behind an expired or restoring session. */
export const HomeSplash = ({
	draft,
	editing,
	connected,
	onPick,
	starting,
	focusRequest = 0,
}: HomeSplashProps) => {
	const { width } = useWindowDimensions();
	const { effectiveScale } = useTextScale();
	const slot = suggestionSlotFor({ connected, draft, width });
	const rows =
		slot.kind === "suggestions" && !draft.length && !editing
			? slot.rows.slice(0, 2)
			: [];
	/* The two measurements the centring needs: the band (this region, which ends
	 *  at the composer STACK's top — see `hero-layout.ts`) and the hero block's
	 *  own height. Both re-measure on rotation, text scale, keyboard and notice. */
	const [band, setBand] = useState(0);
	const [block, setBlock] = useState(0);
	/* `display` while the home IS the page: its one sentence is the page's
	 *  headline and 20 pt under-set it (spec §2). Once there is a draft or a send
	 *  in flight, it is a heading over other content: `title`. NOT on focus alone
	 *  (UX U1): tapping into an empty field snapped the greeting 28 → 20 px and
	 *  52 pt down before a key was typed. */
	const headline = !draft.length && !starting;
	/* Focus on an empty field still drops the rows, so the inset is HELD at its
	 *  resting value (`heroHeldInset`) rather than re-centring the shorter
	 *  block. `restInset` is the last inset painted outside that state. */
	const live = heroTopInset(band, block);
	const holding = Boolean(editing) && !draft.length && !starting;
	const restInset = useRef(live);
	if (!holding) restInset.current = live;
	const greetingRef = useRef<Text | null>(null);
	useEffect(() => {
		if (focusRequest === 0) return;
		const greeting = greetingRef.current;
		if (!greeting) return;
		/* The web moves keyboard focus (`tabIndex={-1}` makes the line
		 *  addressable, never a Tab stop); a phone moves the screen reader's —
		 *  the settings screen's rule after its own retry. */
		if (Platform.OS === "web") {
			/* Only when focus was really LOST (the Retry unmounted, so it fell to
			 *  the body): a reader who moved on to the composer during a slow
			 *  retry keeps their place. */
			const held = document.activeElement;
			if (held && held !== document.body) return;
			(greeting as unknown as HTMLElement).focus({ preventScroll: true });
		} else {
			const handle = findNodeHandle(greeting);
			if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
		}
	}, [focusRequest]);
	return (
		<View
			className="flex-1"
			testID={SURFACE.homeSplash}
			onLayout={(event) => setBand(Math.round(event.nativeEvent.layout.height))}
		>
			<ScrollView
				contentContainerStyle={{
					paddingHorizontal: 16,
					paddingTop: holding ? heroHeldInset(live, restInset.current) : live,
					paddingBottom: 24,
				}}
				keyboardShouldPersistTaps="handled"
			>
				<View
					onLayout={(event) =>
						setBlock(Math.ceil(event.nativeEvent.layout.height))
					}
					/* Laid out (so it is measured) but unpainted until its centred
					 *  place is known: no top-anchored first frame (R4/D4). */
					style={{ opacity: heroMeasured(band, block) ? 1 : 0 }}
				>
					<Text
						ref={greetingRef}
						/* RN's Text types omit `tabIndex`; RN-web honours it. Spread, the
						 *  `Heading` component's idiom, so web focus can be PLACED here. */
						{...{ tabIndex: -1 }}
						className={cx(headline ? "text-display" : "text-title", "text-ink")}
						testID={starting ? SURFACE.homeStarting : SURFACE.homeGreeting}
					>
						{starting ? startingLine() : t("mobile.chrome.home.greeting")}
					</Text>
					{rows.length ? (
						/* `space.6` under the greeting, `space.2` between the rows. */
						<View className="mt-6 gap-2" testID={SURFACE.homeSuggestions}>
							{rows.map((label) => (
								<SuggestionRow
									key={label}
									label={label}
									largeText={effectiveScale > LARGE_TEXT_SCALE}
									onPress={() => onPick(label)}
								/>
							))}
						</View>
					) : null}
				</View>
			</ScrollView>
		</View>
	);
};

export type HomeRecoveryKind =
	| "restoring"
	| "no-host"
	| "auth"
	| "offline"
	| "error";
/** Presentation of already-decided connection facts only; never retries on mount,
 * changes authorization, or replays a quarantined draft. Details are opt-in. */
export const HomeRecovery = ({
	kind,
	host,
	detail,
	onRetry,
	onSignIn,
	onConnect,
}: {
	kind: HomeRecoveryKind;
	host: string;
	detail?: string;
	onRetry: () => void;
	onSignIn: () => void;
	onConnect: () => void;
}) => {
	const [details, setDetails] = useState(false);
	const title =
		kind === "restoring"
			? t("mobile.chrome.home.connecting", { host })
			: kind === "no-host"
				? t("mobile.chrome.home.connect")
				: kind === "auth"
					? t("mobile.chrome.home.sign_in")
					: kind === "offline"
						? t("mobile.chrome.home.reconnecting", { host })
						: t("mobile.computers.session_error");
	return (
		<View className="px-4 pt-6 pb-3 gap-2" testID={SURFACE.homeRecovery}>
			<View className="flex-row items-center gap-2">
				{kind === "restoring" ? <ActivityIndicator /> : null}
				{/* The title SHRINKS and WRAPS beside the spinner (`min-w-0 flex-1`).
				 *  Without it "Connecting to {host}…" took its one-line width and a long
				 *  host ran the document to 353 px in a 320 px viewport at 200 % text
				 *  (audit U-06, S15/loading, "…847" cut at the edge). Wrapping, not an
				 *  ellipsis: the host name is the fact the line exists to state, and
				 *  its tail is often the identifying part (a port). */}
				<Text
					className="min-w-0 flex-1 text-title text-ink"
					accessibilityRole="header"
				>
					{title}
				</Text>
			</View>
			{kind !== "restoring" && kind !== "no-host" ? (
				<Text className="text-body-sm text-ink-muted">
					{t("mobile.chrome.home.saved_draft")}
				</Text>
			) : null}
			{kind !== "restoring" ? (
				<Button
					label={
						kind === "auth"
							? t("mobile.chrome.home.sign_in")
							: kind === "no-host"
								? t("mobile.chrome.home.connect")
								: t("mobile.computers.retry")
					}
					onPress={
						kind === "auth"
							? onSignIn
							: kind === "no-host"
								? onConnect
								: onRetry
					}
					testID={SURFACE.homeRecoveryAction}
				/>
			) : null}
			{detail ? (
				<>
					<Button
						variant="quiet"
						label={t(
							details
								? "mobile.computers.hide_details"
								: "mobile.computers.show_details",
						)}
						onPress={() => setDetails((v) => !v)}
						testID={SURFACE.homeRecoveryDetails}
					/>
					{details ? (
						<Text className="text-body-sm text-ink-dim">{detail}</Text>
					) : null}
				</>
			) : null}
		</View>
	);
};
