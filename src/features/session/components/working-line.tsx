import {
	memo,
	useCallback,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";

import { t } from "@/i18n";
import { elapsedLabel } from "@/lib/format";
import { CONTROL } from "@/ui/a11y";
import { useReducedMotion } from "@/ui/components";
import { TEXT_END_CLASS } from "@/ui/direction";
import { TOUCH_FLOOR } from "@/ui/layout";

/**
 * The working line: the ONE in-progress indicator on the screen
 * (`docs/design/components.md` § 14).
 *
 * It carries exactly three things and no more — a spinner glyph, the activity
 * label the runtime folded server-side, and a clock — because a second
 * in-progress animation anywhere else on the screen is a defect: the reader cannot
 * tell which of two spinners is the real one. The transcript's assistant row
 * simply grows while a turn streams; this line is where "alive, what it is doing,
 * and for how long" lives.
 *
 * **`startedS === null` renders no digits, and `0` renders `0s`.** The wire says
 * whether an instant EXISTS: `null` is a phase the server has no honest instant
 * for, while `0.0` is the phase edge the server watched begin. Gating on
 * `startedS > 0` instead conflated the two and blanked the clock for the whole
 * life of any phase the app watched start — including a single running tool call,
 * which is the "is this stuck?" reading the clock exists for. The clock's slot
 * stays reserved either way, so withholding cannot reflow the label.
 */
export type WorkingLineProps = {
	/** The verb the runtime supplied. An empty label means no line at all. */
	activity: string;
	/** Seconds the current phase has been running, or `null` when the server said
	 *  it has no instant for it. */
	startedS: number | null;
	/** Short landscape: the same three parts on a tighter vertical pad, so the line
	 *  stays whole (it is the one in-progress indicator) while giving a line of the
	 *  screen back to the transcript. */
	compact?: boolean;
	/** The turn's Stop — ONLY the pinned dock instance passes it (the relay's
	 *  `stopPid`). It must be the composer's own `stop` (`use-composer.ts`), never
	 *  a second abort path: one turn-interrupt, one error line. Resolves `false`
	 *  when the request never reached the relay. */
	onStop?: () => Promise<boolean>;
	/** A stop is pending for this session's turn — the SHARED latch
	 *  (`turn-stop.ts`, via the composer's `stopping`), never a per-control one:
	 *  the composer's ■ dims on the same flag. */
	stopping?: boolean;
	/** The turn has ended and the line is only being held for its close tween:
	 *  Stop stays drawn (no reflow mid-fade) but answers nothing, so a late tap
	 *  cannot send an abort to an idle session (review R1-4). */
	stopInert?: boolean;
	testID?: string;
};

/** The braille spinner the TUI uses everywhere it says "running". A text glyph,
 *  not an icon font: it survives every system font. */
const SPINNER = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];

const SPINNER_MS = 80;

/** The reduced-motion rest frame. NOT a full braille cell: in a still, `⣿` at
 *  13 px in the gutter reads as a drag grip (design D5); an ellipsis reads as
 *  "in progress" with nothing moving. */
const SPINNER_REST = "…";

/* ------------------------------------------------------------ the phase clock */

/**
 * ONE clock for every place on the screen that says how long the current phase
 * has run: the header's "Working · 12s" and this line's `12s` (design D2, UX U1).
 * They used to disagree because the header re-rendered only when a projection
 * frame arrived while the line ticked on its own interval; a long silent tool
 * call left the header at its last value while the line counted on.
 *
 * Each `(activity, startedS)` seed gets ONE anchor instant, shared by every
 * reader of that seed, and every reader re-renders off ONE ticker, so two
 * readers of the same phase compute the same number from the same two inputs.
 * The anchor is reference-counted by mounted readers and dropped with the last
 * one: a later turn that happens to carry the same seed (`thinking`, `0`) must
 * start from its own instant, not inherit a stale one. The ticker runs only
 * while someone reads it, and its tick re-renders only the readers — never the
 * screen around them.
 */
type Anchor = { at: number; readers: number };
const anchors = new Map<string, Anchor>();
const clockListeners = new Set<() => void>();
let clockNow = Date.now();
let ticker: ReturnType<typeof setInterval> | null = null;

const subscribeClock = (listener: () => void): (() => void) => {
	clockListeners.add(listener);
	if (ticker === null) {
		clockNow = Date.now();
		ticker = setInterval(() => {
			clockNow = Date.now();
			for (const each of clockListeners) each();
		}, 1000);
	}
	return () => {
		clockListeners.delete(listener);
		if (clockListeners.size === 0 && ticker !== null) {
			clearInterval(ticker);
			ticker = null;
		}
	};
};
const subscribeNothing = () => () => {};
const readClock = () => clockNow;

const anchorFor = (key: string): Anchor => {
	let anchor = anchors.get(key);
	if (anchor === undefined) {
		anchor = { at: Date.now(), readers: 0 };
		anchors.set(key, anchor);
	}
	return anchor;
};

/**
 * Seconds the current phase has run: the wire's age at the seed plus whole
 * seconds since this client first saw that seed. `null` in, `null` out — the
 * server said it has no instant, and the reader must not invent one.
 *
 * `activity` is part of the seed because a NEW PHASE AT THE SAME AGE must
 * re-anchor: "thinking for 40s" and "responding for 40s" are different phases.
 */
export const usePhaseElapsed = (
	activity: string,
	startedS: number | null,
): number | null => {
	const key = startedS === null ? null : `${activity}\u0000${startedS}`;
	const now = useSyncExternalStore(
		key === null ? subscribeNothing : subscribeClock,
		readClock,
		readClock,
	);
	useEffect(() => {
		if (key === null) return;
		const anchor = anchorFor(key);
		anchor.readers += 1;
		return () => {
			anchor.readers -= 1;
			if (anchor.readers === 0 && anchors.get(key) === anchor)
				anchors.delete(key);
		};
	}, [key]);
	if (key === null || startedS === null) return null;
	const anchor = anchorFor(key);
	return startedS + Math.max(0, Math.floor((now - anchor.at) / 1000));
};

const WorkingLineImpl = ({
	activity,
	startedS,
	compact = false,
	onStop,
	stopping = false,
	stopInert = false,
	testID,
}: WorkingLineProps) => {
	const [frame, setFrame] = useState(0);
	const elapsed = usePhaseElapsed(activity, startedS);
	// Honoured rather than ignored: the spinner is the one thing on the screen that
	// moves without the reader asking it to, and reduced motion caps motion while
	// keeping the state legible (the label and the clock carry the meaning).
	const reduceMotion = useReducedMotion();

	useEffect(() => {
		const spin = setInterval(
			() => setFrame((current) => current + 1),
			SPINNER_MS,
		);
		return () => clearInterval(spin);
	}, []);

	// With a Stop the line is drawn even before a label exists: "a turn is alive"
	// is the condition that must always have its Stop in reach (relay parity).
	if (activity.length === 0 && onStop === undefined) return null;
	const clock = elapsed === null ? "" : elapsedLabel(elapsed);
	// Before the daemon names an activity the line still says SOMETHING to a
	// screen reader (review R1-5): an unnamed progressbar announces nothing.
	const name =
		activity.length > 0
			? activity
			: t("relay.chrome.session.subtitle.working_plain");
	const glyph = reduceMotion ? SPINNER_REST : SPINNER[frame % SPINNER.length];

	if (onStop !== undefined) {
		return (
			<View
				// No row minimum of its own (design D1): the row is as tall as its
				// tallest child, and that is the Stop's touch-floor box below. The
				// box cannot be traded for `hitSlop` (see `WorkingStop`), so D1's
				// saving is the row's padding and minimum, not the Stop's target.
				className="flex-row items-center gap-2 px-2"
				testID={testID}
			>
				{/* The live region is the STATUS only; the Stop sits beside it, not
				    inside it, so assistive tech never holds back the control that
				    ends the turn while it announces the label. */}
				<View
					className="min-w-0 flex-1 flex-row items-center gap-2"
					accessibilityRole="progressbar"
					accessibilityLabel={clock === "" ? name : `${name}, ${clock}`}
					accessibilityLiveRegion="polite"
				>
					<Text
						className="shrink-0 font-mono text-mono text-accent"
						aria-hidden
					>
						{glyph}
					</Text>
					{/* Monospace and muted: the relay paints the activity as the
					    terminal's working line does, and a tool intent reads as a
					    machine status, not prose. */}
					<Text
						className="min-w-0 flex-1 font-mono text-mono-sm text-ink-muted"
						numberOfLines={1}
					>
						{activity}
					</Text>
					<Text
						className={`w-[6ch] shrink-0 ${TEXT_END_CLASS} font-mono text-mono-sm text-ink-dim tabular-nums`}
					>
						{clock}
					</Text>
				</View>
				<WorkingStop onStop={onStop} stopping={stopping} inert={stopInert} />
			</View>
		);
	}

	return (
		<View
			className={
				compact
					? "flex-row items-center gap-2 px-4 py-1"
					: "flex-row items-center gap-2 px-4 py-2"
			}
			accessibilityRole="progressbar"
			accessibilityLabel={clock === "" ? name : `${name}, ${clock}`}
			accessibilityLiveRegion="polite"
			testID={testID}
		>
			<Text className="shrink-0 font-mono text-mono text-accent" aria-hidden>
				{glyph}
			</Text>
			<Text
				className="min-w-0 flex-1 text-body-sm text-ink-muted"
				numberOfLines={1}
			>
				{activity}
			</Text>
			{/* The slot is RESERVED at the widest form the formatter can produce, so a
			    changing number cannot re-clip the label beside it — an unreserved clock
			    makes the label jump a few characters at each form change (`59m 59s` →
			    `1h`), which reads as the screen twitching. */}
			<Text
				className={`w-[6ch] shrink-0 ${TEXT_END_CLASS} font-mono text-mono-sm text-ink-dim tabular-nums`}
			>
				{clock}
			</Text>
		</View>
	);
};

/**
 * Memoised so the screen's per-frame re-renders (the relay re-sends the whole
 * projection ~10x a second while a turn streams) reach this row only when its own
 * inputs change. The spinner ticks in this component's OWN state and the clock
 * re-renders only its readers (`usePhaseElapsed`), so neither re-renders the
 * screen, the dock or the transcript list.
 */
export const WorkingLine = memo(WorkingLineImpl);

/**
 * The turn's Stop on the line that says the turn is running — the relay's
 * `WorkingStop`. The composer's primary disc is Stop only while the field is
 * EMPTY (typing turns it into Steer), and a phone has no Escape, so without this a
 * user who has typed could not stop the turn at all.
 *
 * The visible word never changes ("stopping" would widen the control and shove
 * the clock); the pressed state is the accessible name, `busy` and the dimmed
 * face. The latch is NOT this control's: it is the session's (`turn-stop.ts`),
 * shared with the composer's ■, released when the turn ends and after a 15 s
 * bound — a per-control latch that cleared only on unmount left Stop dead for a
 * live turn (review R1-1). Two taps inside one frame both pass the `stopping`
 * check here; the shared `stopTurn` is what keeps them to one abort.
 */
const WorkingStop = ({
	onStop,
	stopping,
	inert,
}: {
	onStop: () => Promise<boolean>;
	stopping: boolean;
	inert: boolean;
}) => {
	// The target is the touch floor as REAL box geometry, not `hitSlop`.
	// react-native-web implements no `hitSlop` on `Pressable`, so the measured
	// slop this replaced (#189 round-1 D1) left a 17 pt target on the web build
	// at 100 % text — 96 U-01 FAILs on the iphone-se audit (#193). Slop on
	// native would also have reached into the find bar's close button above it,
	// and hit areas must not overlap (`docs/design/components.md` § 0.1). The
	// face stays text-sized and is centred inside the box.
	const press = useCallback(() => {
		if (stopping || inert) return;
		void onStop();
	}, [onStop, stopping, inert]);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={t(
				stopping
					? "relay.composer.action.stopping"
					: "relay.composer.action.stop_agent",
			)}
			accessibilityState={{ busy: stopping, disabled: stopping || inert }}
			disabled={inert}
			onPress={press}
			testID={CONTROL.sessionWorkingStop}
			style={{
				minHeight: TOUCH_FLOOR,
				minWidth: TOUCH_FLOOR,
				justifyContent: "center",
			}}
		>
			{/* The visible word never changes: a longer "stopping" would widen the
			    control and push the clock (the relay measured 44 -> 79 px). The
			    pressed state is the accessible name, `busy` and the dimmed face. */}
			{({ pressed }) => (
				<View
					className={`items-center justify-center rounded-sm px-2 ${pressed ? "bg-danger-wash" : ""}`}
					style={{ opacity: stopping ? 0.6 : 1 }}
				>
					{/* The line's own face: the rest of the row is mono (design D5). */}
					<Text className="font-mono text-mono-sm text-danger">
						{t("relay.composer.action.stop")}
					</Text>
				</View>
			)}
		</Pressable>
	);
};

/** How long the dock takes to open or close around the pinned line. Short: it is
 *  a status arriving, not a navigation. */
const DOCK_MS = 180;

export type PinnedWorkingLineProps = {
	/** `pinnedWorkingLine(projection)`: `null` while no turn is alive. */
	line: { activity: string; startedS: number | null } | null;
	onStop: () => Promise<boolean>;
	/** The session's shared stop latch (`composer.stopping`). */
	stopping: boolean;
	/** Whether a sibling follows in the dock's `gap-2` column (the chips or the
	 *  ask bar). The gap below this slot is folded into its animated height, so
	 *  the dock grows and shrinks by ONE continuous amount instead of a smooth
	 *  height plus an 8 pt jump when the slot mounts or unmounts. */
	gapBelow: boolean;
	testID?: string;
};

/** The dock column's gap (`gap-2`). */
const DOCK_GAP = 8;

/**
 * The working line PINNED above the dock (chips, ask bar, composer), outside the
 * transcript list — the relay mounts it as a fixed sibling between the scroller
 * and the above-composer stack for the reason this mirrors: it carries the Stop,
 * and a control inside the scroller is out of reach whenever the reader has
 * scrolled up or the keyboard has shrunk the column.
 *
 * WHY THE HEIGHT IS ANIMATED HERE. The dock grows by this row only while a turn
 * runs. A row that appeared at full height would shove the transcript up a line
 * in one frame on every turn; instead the slot's height (and opacity) runs on the
 * UI thread from 0 to the row's measured height, and back on close — the last
 * line is HELD for the closing tween, then unmounted. Composer geometry is never
 * touched: the slot sits above it and only the transcript yields. Reduced motion
 * snaps both ways with the same end states.
 */
const PinnedWorkingLineImpl = ({
	line,
	onStop,
	stopping,
	gapBelow,
	testID,
}: PinnedWorkingLineProps) => {
	const reduceMotion = useReducedMotion();
	const [held, setHeld] = useState(line);
	const open = line !== null;
	const rowHeight = useSharedValue(0);
	const progress = useSharedValue(0);
	const gap = useSharedValue(gapBelow ? DOCK_GAP : 0);
	// Whether the slot rests fully open. The slot clips its row only while it
	// tweens, so nothing the row draws at rest (the Stop's pressed wash, a
	// focus ring) is cut by a clip that exists only for the open/close travel.
	const [settled, setSettled] = useState(false);

	useEffect(() => {
		if (line !== null) setHeld(line);
	}, [line]);

	useEffect(() => {
		gap.value = gapBelow ? DOCK_GAP : 0;
	}, [gap, gapBelow]);

	useEffect(() => {
		setSettled(false);
		if (reduceMotion) {
			progress.value = open ? 1 : 0;
			if (open) setSettled(true);
			else setHeld(null);
			return;
		}
		progress.value = withTiming(open ? 1 : 0, { duration: DOCK_MS }, (done) => {
			if (!done) return;
			if (open) runOnJS(setSettled)(true);
			else runOnJS(setHeld)(null);
		});
	}, [open, progress, reduceMotion]);

	const style = useAnimatedStyle(() => ({
		height: rowHeight.value * progress.value,
		opacity: progress.value,
		// The column's gap below this slot exists from mount to unmount; pulling it
		// in as the slot closes keeps the dock's travel one continuous curve.
		marginBottom: -gap.value * (1 - progress.value),
	}));

	if (held === null) return null;
	const shown = line ?? held;
	return (
		<Animated.View
			style={[{ overflow: settled ? "visible" : "hidden" }, style]}
			testID={testID}
		>
			<View
				onLayout={(event) => {
					rowHeight.value = event.nativeEvent.layout.height;
				}}
			>
				<WorkingLine
					activity={shown.activity}
					startedS={shown.startedS}
					onStop={onStop}
					stopping={stopping}
					stopInert={line === null}
				/>
			</View>
		</Animated.View>
	);
};

export const PinnedWorkingLine = memo(PinnedWorkingLineImpl);
