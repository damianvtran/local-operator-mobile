import { ChevronDown } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
	AccessibilityInfo,
	ActivityIndicator,
	findNodeHandle,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from "react-native";
import type { SessionSummary } from "@/contracts";
import { focusLatch } from "@/features/home/hero-focus";
import {
	HERO_LIST_MIN_GAP,
	HERO_MARK_BLOCK,
	HERO_MARK_SIZE,
	heroHeldInset,
	heroMeasured,
	heroTopInsetAbove,
	identityPillMarks,
	listNaturalHeight,
	WORK_LIST_GAP,
	workListYield,
} from "@/features/home/hero-layout";
import { startingLine } from "@/features/home/home-copy";
import { IdentityMark } from "@/features/home/home-pickers";
import { trimWorkList, type WorkListSlot } from "@/features/home/work-list";
import { WorkListView } from "@/features/home/work-list-view";
import type { SidebarBasis } from "@/features/sessions/sidebar-view";
import { t } from "@/i18n";
import { CONTROL, ROLE, SURFACE, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Button } from "@/ui/components/button";
import { NavigationMark } from "@/ui/components/navigation-mark";
import { TOUCH_FLOOR } from "@/ui/layout";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { TYPE_STEPS } from "@/ui/tokens.gen";
import { cx } from "@/ui/variants";

/**
 * The splash: what the home shows before there is anything to show.
 *
 * It is the answer to the one question this screen exists for — "what can this
 * do?" — under a composer that is ready for the answer. Composed from the
 * spec's anatomy: mark, greeting, the work list (or a new account's TRY rows),
 * then the composer below (the composer is NOT this component's child; the home
 * composes them, and that is what keeps the composer's foot position invariant
 * in every yield below).
 *
 * **The work list.** Above the composer the band also holds the home's work
 * list (`work-list.ts` decides whether and what; `work-list-view.tsx` draws
 * it), anchored to the band's bottom with a 12 pt gap. The hero then centres in
 * the space the list leaves (`heroTopInsetAbove`), and when even that is too
 * short the mark gives way first, then the running/recent rows beyond the first
 * (`workListYield`), then the region scrolls. While the reader types, the list
 * steps away and the hero keeps the inset it had (`heroHeldInset`) and the
 * yield level it had, so a hidden mark is not redrawn before a key is typed.
 *
 * **The yield order.** When the free area cannot hold the splash, the splash
 * gives pieces up rather than growing into the composer: the mark first, then
 * the running/recent rows beyond the first, and only then does the region
 * scroll. The rule behind the order: the greeting and the rows are the
 * screen's content; the mark is its decoration, and decoration yields first.
 *
 * The measurement is the region's box and two `onLayout`s for the content's
 * natural height (hero, list), and the levels follow the region whenever it
 * changes (rotation, a text-scale change, the keyboard opening), because a
 * yield computed for one box is wrong for the next. Both heights are NATURAL
 * (nothing yielded) so the level cannot flip on its own layout; at level 2 the
 * list's natural height is the last full-list measurement (`listNaturalHeight`).
 * Nothing here can move the composer: it is a sibling, and every yield only
 * makes this region shorter.
 */
export type HomeSplashProps = {
	draft: string;
	editing?: boolean;
	/** What fills the band's bottom, above the composer — decided by
	 *  `workListSlot` (`work-list.ts`), which owns every reason to hide it. */
	workList: WorkListSlot;
	/** A TRY row's tap stages its words in the composer. */
	onPick: (text: string) => void;
	onOpenSession: (session: SessionSummary) => void;
	homeDirectory?: string | null;
	basis?: SidebarBasis;
	/** The first send is in flight: the splash yields to one line. */
	starting: boolean;
	/** Bump to move focus to the greeting (UX U5): the home asks after a
	 *  Retry the reader pressed succeeds, because the alert that held focus
	 *  unmounts. 0 / unchanged never moves anything. */
	focusRequest?: number;
	/** The "Start this chat with" pill under the greeting (identity-picker spec
	 *  D-S1/D-S5), or `null` when the relay licenses no agent/team start —
	 *  hidden, never disabled, because a dead control on the screen's focal line
	 *  is clutter (D-S15). */
	identity?: HeroIdentity | null;
};

/** What the hero pill shows and does. */
export type HeroIdentity = Readonly<{
	/** The chosen name (painted label), or "Default agent". */
	label: string;
	kind: "agent" | "team" | "default";
	agentId?: string | null;
	avatarSha256?: string | null;
	/** Something other than the default is chosen: the pill gains its border. */
	chosen: boolean;
	/** Not connected, or a start in flight (D-S10): the pill does not open. */
	disabled: boolean;
	onPress: () => void;
}>;

/**
 * The identity pill (D-S5..D-S10): mark → label → chevron in one 44 pt
 * capsule, hugging its content and centred under the greeting.
 *
 * QUIET AT DEFAULT, PRESENT WHEN CHOSEN (D-S7). At default it is muted text
 * with no fill or border — it reads as the second half of the greeting, not as
 * a button competing with the suggestions. Chosen, the label steps to `ink`
 * and the capsule gains the 1 pt `border-control` ring the hero mark already
 * uses (the 3:1 non-text token). No Liquid Glass: glass on this screen is the
 * composer's chrome, and the hero is content. Disabled steps the COLOUR to
 * `ink-disabled` (never opacity, desktop design D-1).
 */
const IdentityPill = ({
	identity,
	largeText,
	scale,
}: {
	identity: HeroIdentity;
	largeText: boolean;
	/** The effective text scale: the mark and chevron grow with the label (D5). */
	scale: number;
}) => {
	const marks = identityPillMarks(scale);
	const muted = useTokenColor("ink-muted");
	const disabledInk = useTokenColor("ink-disabled");
	const ink = useTokenColor("ink");
	const tone = identity.disabled ? disabledInk : identity.chosen ? ink : muted;
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={t("mobile.home.identity.pill_label", {
				target: identity.label,
			})}
			accessibilityState={state({ disabled: identity.disabled })}
			disabled={identity.disabled}
			onPress={identity.onPress}
			testID={CONTROL.homeIdentityPill}
			style={{ minHeight: TOUCH_FLOOR, maxWidth: "100%" }}
			className={cx(
				"mt-2 flex-row items-center gap-1.5 rounded-full px-3",
				identity.chosen ? "border border-border-control" : null,
			)}
		>
			<IdentityMark
				kind={identity.kind}
				agentId={identity.agentId}
				avatarSha256={identity.avatarSha256}
				size={marks.mark}
			/>
			<Text
				className="min-w-0 shrink text-body-sm"
				style={{ color: tone }}
				/* One line with an end ellipsis; two at large text, where one line
				 *  would cut most names (D-S9/D-S26). */
				numberOfLines={largeText ? 2 : 1}
			>
				{identity.label}
			</Text>
			{/* `flexShrink: 0`: an ellipsised name squeezed the chevron to 9.9 pt
			 *  at 320 pt (D8). */}
			<ChevronDown
				size={marks.chevron}
				color={tone}
				style={{ flexShrink: 0 }}
				aria-hidden
			/>
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
	workList,
	onPick,
	onOpenSession,
	homeDirectory,
	basis,
	starting,
	focusRequest = 0,
	identity = null,
}: HomeSplashProps) => {
	const { effectiveScale } = useTextScale();
	/* The measurements the centring needs: the band (this region, which ends at
	 *  the composer STACK's top — see `hero-layout.ts`), the hero block's own
	 *  height, and the work list's. All re-measure on rotation, text scale,
	 *  keyboard and notice. */
	const [band, setBand] = useState(0);
	const [block, setBlock] = useState(0);
	const [listMeasured, setListMeasured] = useState(0);
	/* NATURAL heights — hero with its mark, list with every row — so the yield
	 *  below is a function of numbers that do not change when it fires (see
	 *  `workListYield`). Each is the measured height plus what the level in force
	 *  when it was measured had taken away; `levelRef` is that level. */
	const [heroNatural, setHeroNatural] = useState(0);
	const [listNatural, setListNatural] = useState(0);
	const [rowHeight, setRowHeight] = useState(0);
	const levelRef = useRef<0 | 1 | 2>(0);
	/* The last FULL-list height (measured below level 2) and the list it was
	 *  measured for. Level 2 trims the list, so its own measurement is short by
	 *  the dropped rows AND their section header; this is what it reuses
	 *  (`listNaturalHeight`). Keyed by the row counts and the scale so a changed
	 *  list never reuses a stale height. */
	const fullList = useRef({ height: 0, key: "" });
	const listKey =
		workList.kind === "list"
			? [
					workList.list.needsYou.length,
					workList.list.running.length,
					workList.list.recent.length,
					effectiveScale,
				].join("/")
			: workList.kind;
	const hasList = workList.kind !== "none";
	/* The level in force when the list last drew, kept while the list is away
	 *  because the reader is typing in an empty composer (see `holding`). */
	const lastLevel = useRef<0 | 1 | 2>(0);
	const listLevel = hasList
		? workListYield({
				band,
				hero: heroNatural,
				mark: HERO_MARK_BLOCK,
				list: listNatural,
			})
		: 0;
	const holding = Boolean(editing) && !draft.length && !starting;
	/* Focusing an empty composer removes the list, and with it the reason the
	 *  mark was hidden; redrawing it would grow the hero ~50 pt while the held
	 *  inset stays, dropping the greeting before a key is typed. */
	const level = hasList ? listLevel : holding ? lastLevel.current : 0;
	lastLevel.current = level;
	levelRef.current = level;
	/* Rows the second yield takes: running/recent beyond one. Needs-you rows are
	 *  never given up. */
	const trimmable =
		workList.kind === "list"
			? Math.max(
					0,
					workList.list.running.length + workList.list.recent.length - 1,
				)
			: 0;
	const shown: Exclude<WorkListSlot, { kind: "none" }> | null =
		workList.kind === "none"
			? null
			: workList.kind === "list" && level === 2
				? { kind: "list", list: trimWorkList(workList.list, 1) }
				: workList;
	const listHeight = hasList ? listMeasured : 0;
	/* `title` while the home IS the page, `heading` once there is a draft or a
	 *  send in flight and it is a heading over other content. ONE STEP DOWN the
	 *  type scale from the old `display`/`title` pair (operator, TestFlight 578:
	 *  "maybe all that text could be just a bit smaller too"): with the brand
	 *  mark now above it, the 28 pt display line made the centred stack shout.
	 *  Named steps only, so it moves with the tokens. NOT on focus alone (UX U1):
	 *  tapping into an empty field must not snap the greeting's size before a
	 *  key is typed. */
	const headline = !draft.length && !starting;
	/* Focus on an empty field drops the list, so the inset is HELD at its
	 *  resting value (`heroHeldInset`) rather than re-centring the hero in the
	 *  space the list gave back. `restInset` is the last inset painted outside
	 *  that state. */
	const live = heroTopInsetAbove(band, block, listHeight);
	const restInset = useRef(live);
	if (!holding) restInset.current = live;
	const painted = heroMeasured(band, block) && (!hasList || listMeasured > 0);
	const greetingRef = useRef<Text | null>(null);
	/* Seeded with the value this splash MOUNTED with (review M1): Home's counter
	 *  never resets and the splash remounts on New chat and on a cleared
	 *  recovery state, so the mount-time value is an old request, not a new one. */
	const latch = useRef(focusLatch(focusRequest));
	useEffect(() => {
		if (!latch.current.take(focusRequest)) return;
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
			/* The native form of the same "moved on" rule (review m1): a reader
			 *  typing or dictating in the composer during a slow retry keeps the
			 *  screen reader's place. */
			if (TextInput.State.currentlyFocusedInput() != null) return;
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
				/* `flexGrow`: the content is at least the band, so the flexible
				 *  spacer under the hero can push the work list to the band's bottom.
				 *  The list's gap to the composer stack is `WORK_LIST_GAP`; without
				 *  one the hero keeps its 24 pt foot. */
				contentContainerStyle={{
					paddingHorizontal: 16,
					paddingBottom: hasList ? WORK_LIST_GAP : 24,
					flexGrow: 1,
				}}
				keyboardShouldPersistTaps="handled"
			>
				{/* The centring offset is a SPACER'S HEIGHT, not a padding (QA
				 *  Q-R2-3). It is computed from two measurements, so it lands on
				 *  216/208/156 pt, which are not `space.scale` steps. U-42 judges
				 *  padding, margin and gap as spacing tokens, and this value is not
				 *  a token. Bending it to a scale step would move the hero off
				 *  centre. As a height it is laid out the same way and is not
				 *  measured as spacing. */}
				<View
					style={{
						height: holding ? heroHeldInset(live, restInset.current) : live,
					}}
				/>
				<View
					onLayout={(event) => {
						const height = Math.ceil(event.nativeEvent.layout.height);
						setBlock(height);
						setHeroNatural(
							height + (levelRef.current >= 1 ? HERO_MARK_BLOCK : 0),
						);
					}}
					/* Laid out (so it is measured) but unpainted until its centred
					 *  place is known: no top-anchored first frame (R4/D4). With a
					 *  list the place also depends on the list's height, so both
					 *  appear together. */
					style={{ opacity: painted ? 1 : 0 }}
					/* THE CENTRED STACK (operator, TestFlight 578): mark, greeting,
					 *  rows on one centre line. The mark is INSIDE this measured view,
					 *  so the centring maths (`heroTopInset`) treats the stack as one
					 *  block and the composer below never moves. */
					className="items-center"
				>
					{/* The existing asset, never a redraw; decorative, so it hides
					 *  itself from assistive tech and the greeting stays the first
					 *  thing read. `space.4` to the greeting. The 1 pt
					 *  `border-control` ring (design D3): the asset's white disc is
					 *  1.15:1 on the light canvas and read as a bare glyph; the ring
					 *  is the 3:1 non-text token (3.42:1 light / 3.93:1 dark on
					 *  canvas), so the disc's edge reads in both themes. It hugs the
					 *  disc because the asset's disc fills its square edge to edge. */}
					{/* The first thing to give way when the band is short (`level` 0
					 *  keeps it): decoration yields before content. */}
					{level === 0 ? (
						<View
							className="mb-4 rounded-full border border-border-control"
							testID={SURFACE.homeHeroMark}
						>
							<NavigationMark size={HERO_MARK_SIZE} />
						</View>
					) : null}
					<Text
						ref={greetingRef}
						/* RN's Text types omit `tabIndex`; RN-web honours it. Spread, the
						 *  `Heading` component's idiom, so web focus can be PLACED here. */
						{...{ tabIndex: -1 }}
						className={cx(
							headline ? "text-title" : "text-heading",
							"text-center text-ink",
						)}
						testID={starting ? SURFACE.homeStarting : SURFACE.homeGreeting}
					>
						{starting
							? identity?.chosen
								? t("mobile.home.identity.starting_with", {
										name: identity.label,
									})
								: startingLine()
							: t("mobile.chrome.home.greeting")}
					</Text>
					{/* Directly under the greeting, inside the measured hero block, so
					 *  the centring maths counts it and the composer below never moves
					 *  (D-S6/D-S8). It never yields: it is content, and it scrolls
					 *  with the greeting. */}
					{identity !== null ? (
						<IdentityPill
							identity={identity}
							largeText={effectiveScale > LARGE_TEXT_SCALE}
							scale={effectiveScale}
						/>
					) : null}
				</View>
				{shown !== null ? (
					<>
						{/* Grows to push the list to the band's foot; never below
						 *  `HERO_LIST_MIN_GAP`, so a band too short for both (large
						 *  text, scrolling) still keeps the greeting off the first
						 *  header (design D4). */}
						<View style={{ flexGrow: 1, minHeight: HERO_LIST_MIN_GAP }} />
						<View
							onLayout={(event) => {
								const height = Math.ceil(event.nativeEvent.layout.height);
								const at = levelRef.current;
								if (at < 2) fullList.current = { height, key: listKey };
								setListMeasured(height);
								setListNatural(
									listNaturalHeight({
										measured: height,
										level: at,
										full:
											fullList.current.key === listKey
												? fullList.current.height
												: 0,
										trimmable,
										rowHeight,
									}),
								);
							}}
							style={{ opacity: painted ? 1 : 0 }}
						>
							<WorkListView
								slot={shown}
								onPick={onPick}
								onOpenSession={onOpenSession}
								homeDirectory={homeDirectory}
								basis={basis}
								onRowHeight={setRowHeight}
							/>
						</View>
					</>
				) : null}
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
