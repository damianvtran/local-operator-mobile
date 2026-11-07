import { memo, useCallback, useEffect, useRef, useState } from "react";
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
	testID?: string;
};

/** The braille spinner the TUI uses everywhere it says "running". A text glyph,
 *  not an icon font: it survives every system font. */
const SPINNER = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];

const SPINNER_MS = 80;

const WorkingLineImpl = ({
	activity,
	startedS,
	compact = false,
	onStop,
	testID,
}: WorkingLineProps) => {
	const [frame, setFrame] = useState(0);
	const [elapsed, setElapsed] = useState(startedS ?? 0);
	// Honoured rather than ignored: the spinner is the one thing on the screen that
	// moves without the reader asking it to, and reduced motion caps motion while
	// keeping the state legible (the label and the clock carry the meaning).
	const reduceMotion = useReducedMotion();

	// Re-seed on a new phase or a fresh age from the wire; then tick locally, so the
	// clock does not need a frame per second from the relay.
	//
	// `activity` is a dependency the exhaustive-deps rule cannot justify: the body
	// reads only `startedS`. It is listed because a NEW PHASE AT THE SAME AGE must
	// re-seed the clock — "thinking for 40s" and "responding for 40s" are different
	// phases, and without it the second inherits the first's elapsed time.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see the comment above
	useEffect(() => {
		setElapsed(startedS ?? 0);
	}, [activity, startedS]);

	useEffect(() => {
		const spin = setInterval(
			() => setFrame((current) => current + 1),
			SPINNER_MS,
		);
		const tick = setInterval(
			() => setElapsed((current) => Math.round((current + 1) * 10) / 10),
			1000,
		);
		return () => {
			clearInterval(spin);
			clearInterval(tick);
		};
	}, []);

	// With a Stop the line is drawn even before a label exists: "a turn is alive"
	// is the condition that must always have its Stop in reach (relay parity).
	if (activity.length === 0 && onStop === undefined) return null;
	const hasClock = startedS !== null;

	if (onStop !== undefined) {
		return (
			<View
				className="flex-row items-center gap-2 px-2"
				style={{ minHeight: TOUCH_FLOOR }}
				testID={testID}
			>
				{/* The live region is the STATUS only; the Stop sits beside it, not
				    inside it, so assistive tech never holds back the control that
				    ends the turn while it announces the label. */}
				<View
					className="min-w-0 flex-1 flex-row items-center gap-2"
					accessibilityRole="progressbar"
					accessibilityLabel={
						hasClock ? `${activity}, ${elapsedLabel(elapsed)}` : activity
					}
					accessibilityLiveRegion="polite"
				>
					<Text
						className="shrink-0 font-mono text-mono text-accent"
						aria-hidden
					>
						{reduceMotion ? "⣿" : SPINNER[frame % SPINNER.length]}
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
						{hasClock ? elapsedLabel(elapsed) : ""}
					</Text>
				</View>
				<WorkingStop onStop={onStop} />
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
			accessibilityLabel={
				hasClock ? `${activity}, ${elapsedLabel(elapsed)}` : activity
			}
			accessibilityLiveRegion="polite"
			testID={testID}
		>
			<Text className="shrink-0 font-mono text-mono text-accent" aria-hidden>
				{reduceMotion ? "⣿" : SPINNER[frame % SPINNER.length]}
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
				{hasClock ? elapsedLabel(elapsed) : ""}
			</Text>
		</View>
	);
};

/**
 * Memoised so the screen's per-frame re-renders (the relay re-sends the whole
 * projection ~10x a second while a turn streams) reach this row only when its own
 * three inputs change. The spinner and the clock tick in this component's OWN
 * state, so neither re-renders the screen, the dock or the transcript list.
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
 * face. A repeat tap while the stop is in flight is a no-op, and a stop that never
 * reached the relay re-arms (its failure is stated on the composer's error line by
 * the shared `stop`). The latch clears when the line unmounts — the turn ended.
 */
const WorkingStop = ({ onStop }: { onStop: () => Promise<boolean> }) => {
	const [stopping, setStopping] = useState(false);
	const mounted = useRef(true);
	useEffect(
		() => () => {
			mounted.current = false;
		},
		[],
	);
	// The latch is a ref as well as state: two taps inside one frame both see the
	// pre-press render, and the state alone would let the second send a second abort.
	const latched = useRef(false);
	const press = useCallback(() => {
		if (latched.current) return;
		latched.current = true;
		setStopping(true);
		void onStop().then((reached) => {
			if (reached || !mounted.current) return;
			latched.current = false;
			setStopping(false);
		});
	}, [onStop]);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={t(
				stopping
					? "relay.composer.action.stopping"
					: "relay.composer.action.stop_agent",
			)}
			accessibilityState={{ busy: stopping, disabled: stopping }}
			onPress={press}
			hitSlop={4}
			testID={CONTROL.sessionWorkingStop}
			style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
		>
			{/* The visible word never changes: a longer "stopping" would widen the
			    control and push the clock (the relay measured 44 -> 79 px). The
			    pressed state is the accessible name, `busy` and the dimmed face. */}
			{({ pressed }) => (
				<View
					className={`flex-1 items-center justify-center rounded-sm px-2 ${pressed ? "bg-danger-wash" : ""}`}
					style={{ opacity: stopping ? 0.6 : 1 }}
				>
					<Text className="text-body-sm text-danger">
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
	gapBelow,
	testID,
}: PinnedWorkingLineProps) => {
	const reduceMotion = useReducedMotion();
	const [held, setHeld] = useState(line);
	const open = line !== null;
	const rowHeight = useSharedValue(0);
	const progress = useSharedValue(0);
	const gap = useSharedValue(gapBelow ? DOCK_GAP : 0);

	useEffect(() => {
		if (line !== null) setHeld(line);
	}, [line]);

	useEffect(() => {
		gap.value = gapBelow ? DOCK_GAP : 0;
	}, [gap, gapBelow]);

	useEffect(() => {
		if (reduceMotion) {
			progress.value = open ? 1 : 0;
			if (!open) setHeld(null);
			return;
		}
		progress.value = withTiming(open ? 1 : 0, { duration: DOCK_MS }, (done) => {
			if (done && !open) runOnJS(setHeld)(null);
		});
	}, [open, progress, reduceMotion]);

	const style = useAnimatedStyle(() => ({
		height: rowHeight.value * progress.value,
		opacity: progress.value,
		// The column's gap below this slot exists from mount to unmount; pulling it
		// in as the slot closes keeps the dock's travel one continuous curve.
		marginBottom: -gap.value * (1 - progress.value),
		overflow: "hidden",
	}));

	if (held === null) return null;
	const shown = line ?? held;
	return (
		<Animated.View style={style} testID={testID}>
			<View
				onLayout={(event) => {
					rowHeight.value = event.nativeEvent.layout.height;
				}}
			>
				<WorkingLine
					activity={shown.activity}
					startedS={shown.startedS}
					onStop={onStop}
				/>
			</View>
		</Animated.View>
	);
};

export const PinnedWorkingLine = memo(PinnedWorkingLineImpl);
