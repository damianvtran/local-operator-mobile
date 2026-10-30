/**
 * The session header's status dot, its explanation sheet, the header's overflow
 * menu, and the resume path an ended session offers from both.
 *
 * Native port of the relay web client's `components/session-health.tsx`
 * (local-operator #3008). WHY A DOT AND NOT A BANNER: the ended session used to
 * disable the composer with a permanent sentence, spending the thumb zone on a
 * fact that changes rarely and needs no action until the reader wants one. The
 * fact now lives beside the title as one quiet dot, with the detail and the one
 * action (Resume) a tap away in the shared Sheet — and a send to an ended
 * session REOPENS it rather than being refused.
 *
 * THE STATE COMES FROM RUNTIME SIGNALS THE RELAY SENDS, never from the last
 * message: see `features/session/health.ts` for the exact fields and the rule.
 */
import { MoreVertical } from "lucide-react-native";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	AccessibilityInfo,
	Platform,
	Pressable,
	Text,
	View,
} from "react-native";

import { useConnection } from "@/features/auth/connection-provider";
import {
	HEALTH_DOT_TONE,
	type HealthInput,
	healthAnnouncement,
	healthDetailKey,
	healthLabel,
	type SessionHealth,
} from "@/features/session/health";
import { healthCopy, healthResumeCopy } from "@/features/session/health-copy";
import { t } from "@/i18n";
import { isRelayMissing } from "@/relay";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Heading } from "@/ui/components/heading";
import { IconButton } from "@/ui/components/icon-button";
import { Sheet } from "@/ui/components/sheet";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";
import { TYPE_STEPS } from "@/ui/tokens.gen";

/**
 * The documented resume affordance for an ENDED session, shared by the sheet
 * and the overflow menu so there is ONE implementation. A tap calls the
 * relay's own `POST /api/sessions/resume` route (the same one Past sessions
 * uses): the daemon spawns a child that resumes the transcript in the home
 * folder, and the next live frame flips the dot green.
 *
 * Held by the SCREEN, not the sheet: the sheet unmounts when it closes, and
 * the acceptance line has to survive the reader closing it to watch the dot.
 * `ended` going false is the signal that the session came back, so it clears
 * the state.
 */
export function useResume(sessionId: string, ended: boolean) {
	const { relay } = useConnection();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	/* A relay 404 means the session is GONE, so Resume cannot work: the button is
	 * disabled from then on rather than offering an act that always fails (UX
	 * round 2, U12). Cleared when the session comes back, with the rest. */
	const [gone, setGone] = useState(false);
	useEffect(() => {
		if (ended) return;
		setBusy(false);
		setError(null);
		setNotice(null);
		setGone(false);
	}, [ended]);

	const resume = useCallback(async () => {
		if (busy) return;
		const client = relay();
		if (!client) {
			setError(healthResumeCopy().noRoute);
			return;
		}
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await client.resumeSession(sessionId);
			/* The notice lands BEFORE busy clears, in one batch, so the button
			   never reads "Resume" again while the line under it says the reopen
			   is under way (design round 1, N1). Busy still clears on success: a
			   POST that succeeded against a session slow to come back must not
			   leave Resume disabled forever — retrying is safe, `spawn_session`
			   coalesces concurrent resumes. */
			setNotice(healthResumeCopy().reopening);
			setBusy(false);
		} catch (failure) {
			/* The relay's own 404 means the session is GONE: saying "try again"
			   would invite a retry that can never work (UX round 1, U8). The
			   relay's client and this app's Past sessions screen both say so.
			   `isRelayMissing`, not `status === 404`: an edge 404 is a dead
			   tunnel, not a deleted conversation. Never the raw daemon string. */
			const missing = isRelayMissing(failure);
			if (missing) setGone(true);
			setError(
				missing ? healthResumeCopy().noLongerSaved : healthResumeCopy().refused,
			);
			setBusy(false);
		}
	}, [busy, relay, sessionId]);

	useEffect(() => {
		if (notice !== healthResumeCopy().reopening) return;
		const t = setTimeout(
			() => setNotice(healthResumeCopy().stillReopening),
			healthResumeCopy().reopenReportMs,
		);
		return () => clearTimeout(t);
	}, [notice]);

	return { busy, error, notice, resume, gone };
}

/** The dot: a small filled circle in the state's tone, decorative only — the
    state WORD beside it (or, while live, the screen-reader word in the
    control's name) carries the state, so colour is never the only signal. */
function HealthDot({ health }: { health: SessionHealth }) {
	const color = useTokenColor(HEALTH_DOT_TONE[health]);
	return (
		<View
			aria-hidden
			style={{ backgroundColor: color }}
			className="size-2 shrink-0 rounded-full"
		/>
	);
}

/**
 * Return focus to the control that opened a sheet once it closes (UX round 1,
 * U10): `Sheet` documents that returning focus is the caller's job, and the
 * relay passes `returnFocusRef` for the same reason — a keyboard or switch
 * user who closes the sheet with Escape otherwise lands on `<body>`, at the
 * top of the document. Web only: on iOS/Android the platform restores
 * accessibility focus to the presenter when a modal dismisses.
 */
function useReturnFocus(open: boolean, target: RefObject<View | null>) {
	const wasOpen = useRef(open);
	useEffect(() => {
		if (wasOpen.current && !open && Platform.OS === "web") {
			const node = target.current as unknown as { focus?: () => void } | null;
			/* After the sheet's own unmount, which may still hold focus this tick. */
			const timer = setTimeout(() => node?.focus?.(), 0);
			wasOpen.current = open;
			return () => clearTimeout(timer);
		}
		wasOpen.current = open;
		return undefined;
	}, [open, target]);
}

/** The state line's reserved height, derived from the `meta` TYPE STEP it draws
 *  (`tokens.gen`: 12 px at 1.4 line height) times the reader's text scale.
 *  Reserved in EVERY state, live included, so the header's height does not change
 *  when a word appears (D11). A fixed 20 pt here was the D8 residual: at 200 % the
 *  real line box is 33.6 pt and the header grew to fit it anyway. */
const stateLinePt = (effectiveScale: number): number =>
	TYPE_STEPS.meta.size * TYPE_STEPS.meta.lineHeight * effectiveScale;

export type SessionHealthControlProps = {
	/** The header's reading. `null` (no frame yet, or the client stopped
	 *  retrying) draws the plain title heading with no dot and no control. */
	health: SessionHealth | null;
	/** The projection, so the sheet can tell the two yellow causes apart
	    (`degraded` reads "dropped", a stale heartbeat reads "quiet"). */
	projection: HealthInput | null;
	/** The conversation name, already truncated to the header's budget. */
	title: string;
	/** The short-landscape header's title role. */
	compact: boolean;
	/** The stacked header (large text / narrow phone): the name may use two
	 *  lines there, which `headerTitleChars`' stacked budget assumes. */
	stacked: boolean;
	sheetOpen: boolean;
	onSheetOpenChange: (open: boolean) => void;
};

/**
 * The header's title block as ONE control: the conversation name as the level-1
 * heading, then (when not live) the dot and the state's own word on a meta line
 * under it; a tap opens the explanation sheet.
 *
 * WHY THE NAME IS PART OF THE CONTROL'S NAME (review M4, design D2, QA Q4).
 * An `accessibilityLabel` of just the state word REPLACED the visible text,
 * so VoiceOver said "Live, button", the conversation name was never spoken,
 * and a Voice Control user who said the visible title could not hit it (WCAG
 * 2.5.3, label in name). The label is therefore the visible words in reading
 * order — the name, then the state — and the name stays a `heading` level 1,
 * nested inside, so the screen keeps its heading. The relay does the same
 * with no `aria-label` at all; native needs an explicit label because a
 * Pressable's children are not otherwise read as one name on iOS.
 *
 * WHY THE WORD IS VISIBLE (UX U1, design D3). An 8 pt dot alone is a
 * colour-only signal — green and grey collapse to ΔE ~8 under deuteranopia —
 * and the ended failure sentence ("tap “Ended” at the top") must point at
 * something that exists. The relay's subtitle line carries the word in every
 * state; native has no subtitle, so the word renders whenever the state is NOT
 * live (live is the default and costs no line; its word rides the control's
 * name for screen readers, as the relay's sr-only `live` word does). The live
 * dot sits inline before the name, the others on the state line — so the
 * width budget counts only the live dot (`header.ts`, `HeaderExtras`).
 */
export function SessionHealthControl({
	health,
	projection,
	title,
	compact,
	stacked,
	sheetOpen,
	onSheetOpenChange,
	children,
	controlRef,
}: SessionHealthControlProps & {
	/** The sheet body's extra content (Resume and its lines while ended). */
	children?: ReactNode;
	/** The control, so the screen can return focus to it after a sheet. */
	controlRef: RefObject<View | null>;
}) {
	useReturnFocus(sheetOpen, controlRef);
	const titleClass = compact ? "text-title text-ink" : "text-display text-ink";
	const titleLines = stacked ? 2 : 1;
	const { effectiveScale } = useTextScale();
	/* No reading: the plain heading the screen had before the dot, nothing to tap,
	   nothing announced (review M3 / QA Q3 / UX U5 — the reference renders no
	   health control while `!projection`). */
	if (health === null)
		return (
			/* The fallback takes the SAME slot the control will (`min-w-0 flex-1`,
			 * `Screen`'s own heading classes): without it find packed right after the
			 * word "session" and then jumped ~124 pt right when the first frame
			 * landed (design round 2, D10). First paint changes the title TEXT and
			 * nothing else. */
			<View className="min-w-0 flex-1">
				<Heading level={1} className={titleClass} numberOfLines={titleLines}>
					{title}
				</Heading>
			</View>
		);
	const label = healthLabel(health);
	const live = health === "live";
	return (
		<>
			{/* THE HEADING WRAPS THE BUTTON, not the other way round: a button's
			    children are presentational in the accessibility tree, so a heading
			    nested INSIDE the control is flattened away and the screen has no
			    heading at all (QA round 1 Q4 measured 0). `<h1><button>` is the
			    shape that keeps both: the heading's name is the button's. On iOS a
			    single element carries one role, so the button wins there and the
			    name still leads with the title. */}
			{/* `role` is the web channel and `accessibilityRole` the native one, and
			    they are NOT additive on web (react-native-web prefers the ARIA prop
			    over `role`), so each platform gets its own: the h1 survives on web,
			    and iOS keeps the heading trait for rotor navigation (review round 2,
			    m-c). The heading's LEVEL has no native channel (`Heading`). */}
			<View
				{...Platform.select({
					web: { role: "heading", "aria-level": 1 },
					default: { accessibilityRole: "header" },
				})}
				className="min-w-0 flex-1"
			>
				<Pressable
					ref={controlRef}
					accessibilityRole={ROLE.button}
					accessibilityLabel={`${title}, ${label}`}
					accessibilityHint={t("mobile.session_health.control_hint")}
					accessibilityState={{ expanded: sheetOpen }}
					testID={CONTROL.sessionHealth}
					onPress={() => onSheetOpenChange(true)}
					className="min-w-0 justify-center"
					style={{ minHeight: TOUCH_FLOOR }}
				>
					{/* ONE LAYOUT FOR EVERY STATE (design round 2, D11). The dot holds ONE
					 *  slot before the name in every state, so a transition never moves
					 *  the title; the state line is a RESERVED meta-height row that is
					 *  always present and only its WORD appears. The old swap — dot
					 *  inline while live, dot-plus-word on a new line otherwise — moved
					 *  the title 16 pt and changed the header height on every flip,
					 *  which the `health-drop` world then did dozens of times a minute. */}
					<View className="min-w-0 flex-row items-center gap-2">
						<HealthDot health={health} />
						<Text
							className={`min-w-0 flex-1 ${titleClass}`}
							numberOfLines={titleLines}
						>
							{title}
						</Text>
						{/* SHORT LANDSCAPE KEEPS THE HEADER ONE ROW (QA round 3, Q9). The
						 *  reserved state line below costs 33.6 pt at 200 % text, and in
						 *  `compact` that came out of the one row this form exists to be:
						 *  the header control measured 86 pt tall, the approval card's
						 *  Approve/Deny moved to y 232 while the composer starts at y 260,
						 *  and a centre tap on Approve reached `session-column` instead of
						 *  the button — a pending decision could not be answered (#123
						 *  fixed the same class by hiding the status tray here). The word
						 *  rides the row instead, after the title, so the row's HEIGHT is
						 *  the same in every state and only the flex-1 title yields width
						 *  — the title's own left edge still never moves (D11). */}
						{compact && !live ? (
							<Text
								className="text-meta text-ink-dim"
								numberOfLines={1}
								testID={CONTROL.sessionHealthWord}
							>
								{label}
							</Text>
						) : null}
					</View>
					{compact ? null : (
						<View
							className="min-w-0 flex-row items-center"
							style={{ minHeight: stateLinePt(effectiveScale) }}
							testID={CONTROL.sessionHealthWord}
						>
							{live ? null : (
								<Text className="text-meta text-ink-dim" numberOfLines={1}>
									{label}
								</Text>
							)}
						</View>
					)}
				</Pressable>
			</View>

			<Sheet
				visible={sheetOpen}
				onClose={() => onSheetOpenChange(false)}
				title={label}
				titleLines={2}
				testID={CONTROL.sessionHealthSheet}
			>
				<View className="gap-3 px-4 pb-4">
					<Text className="text-body-sm text-ink-muted">
						{healthCopy()[healthDetailKey(health, projection)]}
					</Text>
					{children}
				</View>
			</Sheet>
		</>
	);
}

/**
 * THE TRANSITION ANNOUNCEMENT. The retired ended sentence was a live region
 * inserted on the change, so a screen-reader user heard it happen; the dot
 * alone would say it to sighted readers only. Outside the control (inside, its
 * words would be read twice as part of the control's name) and outside the
 * title column (review M2: absolutely positioned inside that column it rode
 * along with the title, under a tag line). Speaks the state's word on a CHANGE
 * into a non-live state, never on mount and never for `null` (no reading).
 *
 * Two mechanisms because the platforms differ: `accessibilityLiveRegion` is
 * Android/web only, so on iOS the change is posted with
 * `announceForAccessibility` (review round 1, m1).
 */
export function HealthAnnouncer({ health }: { health: SessionHealth | null }) {
	/* ONE RULE ON EVERY PLATFORM: announce a CHANGE, never a first reading.
	 *
	 * WHY THE REGION'S TEXT IS STATE AND NOT DERIVED IN RENDER (review round 4,
	 * N2 / UX U11). The previous version computed `firstReading` during render
	 * from a ref the effect wrote, so the first SAME-VALUE re-render — the age
	 * ticker supplies one within half a second — read as a change and filled the
	 * polite region with the first state word. Seeding the ref with `null` only
	 * delayed that by one render (measured: `""` at +250 ms, `"Ended"` at +500 ms
	 * on a cold open of an ended session).
	 *
	 * Now the ref only records what was last SEEN, the effect decides, and the
	 * region renders what the effect decided. A mount therefore leaves it empty;
	 * a same-value re-render leaves it empty; only a real change fills it, on
	 * every platform, and iOS speaks it from the same decision.
	 */
	const previous = useRef<SessionHealth | null>(null);
	const [said, setSaid] = useState("");
	useEffect(() => {
		const before = previous.current;
		previous.current = health;
		/* The decision is `healthAnnouncement`'s (pure, table-tested); this effect
		 *  only supplies the order of readings. The region's text is STATE, not a
		 *  value derived in render, so a same-value re-render cannot fill it. */
		const word = healthAnnouncement(before, health);
		if (word === said) return;
		setSaid(word);
		if (word !== "" && Platform.OS === "ios") {
			AccessibilityInfo.announceForAccessibility(word);
		}
	}, [health, said]);
	return (
		<Text
			accessibilityLiveRegion="polite"
			style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
			pointerEvents="none"
		>
			{said}
		</Text>
	);
}
/**
 * The header's action cluster: the find lever and, ONLY while it has an item,
 * the overflow menu (UX U3 / design D9 / QA Q6: on a live or yellow session
 * the menu was an empty sheet — a permanent control that led nowhere). Its one
 * item is Resume, which native has; nothing is invented to fill it.
 */
export function SessionHeaderActions({
	findAction,
	ended,
	menuOpen,
	onMenuOpenChange,
	onResume,
	resumeBusy,
	resumeGone,
}: {
	findAction: ReactNode;
	ended: boolean;
	menuOpen: boolean;
	onMenuOpenChange: (open: boolean) => void;
	onResume: () => void;
	/** The resume POST is in flight. */
	resumeBusy: boolean;
	/** The relay said the session is no longer saved, so Resume cannot work. */
	resumeGone: boolean;
}) {
	const menuRef = useRef<View | null>(null);
	useReturnFocus(menuOpen, menuRef);
	return (
		<View className="flex-row items-center gap-2">
			{findAction}
			{ended ? (
				<View ref={menuRef}>
					<IconButton
						accessibilityLabel={t("mobile.session_health.menu_label")}
						accessibilityHint={t("mobile.session_health.menu_hint")}
						size={22}
						testID={CONTROL.sessionMenu}
						onPress={() => onMenuOpenChange(true)}
						icon={({ color, size }) => (
							<MoreVertical color={color} size={size} />
						)}
					/>
				</View>
			) : null}
			{/* The overflow menu. Resume sits here too because a reader looks for
			    actions in a menu. It closes first, then opens the health sheet, so
			    the outcome lands in one place — never two stacked dialogs. */}
			<Sheet
				visible={menuOpen && ended}
				onClose={() => onMenuOpenChange(false)}
				title={t("mobile.session_health.menu_title")}
				testID={CONTROL.sessionHeaderMenuSheet}
			>
				<View className="gap-2 px-4 pb-4">
					<Button
						testID={CONTROL.sessionMenuResume}
						label={
							resumeBusy
								? healthResumeCopy().resuming
								: healthResumeCopy().resume
						}
						disabled={resumeBusy || resumeGone}
						onPress={onResume}
					/>
				</View>
			</Sheet>
		</View>
	);
}

/** Resume and its two lines, for the health sheet while ended. */
export function ResumeBlock({
	resume,
}: {
	resume: ReturnType<typeof useResume>;
}) {
	return (
		<>
			<Button
				testID={CONTROL.sessionHealthResume}
				label={
					resume.busy ? healthResumeCopy().resuming : healthResumeCopy().resume
				}
				disabled={resume.busy || resume.gone}
				onPress={() => void resume.resume()}
			/>
			{resume.notice ? (
				<Text
					accessibilityLiveRegion="polite"
					className="text-meta text-ink-dim"
				>
					{resume.notice}
				</Text>
			) : null}
			{resume.error ? (
				<Alert severity="warning" title={healthResumeCopy().refusedTitle}>
					{resume.error}
				</Alert>
			) : null}
		</>
	);
}
