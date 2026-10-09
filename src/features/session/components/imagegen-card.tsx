import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { TranscriptImage } from "@/features/session/components/transcript-image";
import type {
	ImageGenCardPhase,
	ImageGenView,
} from "@/features/session/imagegen";
import {
	IMAGEGEN_ALREADY_FINISHED_TONE,
	IMAGEGEN_TONE,
	imageGenStateLine,
} from "@/features/session/imagegen";
import { imagegenCancelId, transcriptImageId } from "@/ui/a11y";
import { Button, Shimmer, useReducedMotion } from "@/ui/components";
import { parseCubicBezier } from "@/ui/motion";
import { DURATIONS, EASINGS } from "@/ui/tokens.gen";
import { cx } from "@/ui/variants";

/**
 * The image-generation progress card: the transcript row for the generation
 * tools (`imagegen.ts` owns detection and the view-model; this file renders it).
 *
 * VISUAL FAMILY: the tool row (glyph, one line, elapsed), not the pending card's
 * accent frame. The three fills are the tool row's own, extended to the card
 * for the same reason they exist there — a long transcript is scanned for "what
 * is still moving" and "what broke", and the glyph repeats the fact so colour is
 * never the only channel (`tool-row.tsx` keeps the interim record of that
 * extension for the kit).
 *
 * The card's own states, and the two that are load-bearing:
 *
 *   - **`cancelling` is local and never optimistic.** Pressing Cancel requests
 *     the EXISTING turn interrupt (`composer.stop` — the composer's own Stop
 *     semantics, threaded in by the screen; there is no second mechanism), and
 *     the card then draws "Cancelling…" until the entry settles into its real
 *     state. A client that painted "Cancelled" on the press would be claiming a
 *     confirmation the provider has not given.
 *   - **Reduced detail renders reduced.** Every live field is optional; no
 *     fraction means the indeterminate sweep, no queue position means the plain
 *     word, no logs means no line — the card never invents a number
 *     (`imagegen.ts` validates and widens to absent).
 *
 * The restart/steer affordances are DELIBERATELY not wired: v1 is interrupt +
 * a new call, the named op does not exist yet, and the slot below is the place
 * they will mount — a comment, not a control, until the op is defined.
 */
export type ImageGenCardProps = {
	/** The entry-derived view-model. This component renders this and nothing else. */
	view: ImageGenView;
	/** The entry's id, for the artifact's URL and the cancel control's name. */
	entryId: string;
	/** Resolves the finished artifact's bytes — the existing transcript image
	 *  path, injected like every other image loader. */
	loadImage?: (entryId: string, index: number) => Promise<string | null>;
	/** The turn interrupt (the composer's Stop, threaded from the screen).
	 *  `undefined` while no turn is live — which is what hides the control. */
	onCancelTurn?: () => void;
	testID?: string;
};

/** The frame the image will occupy while it is generated. 64 pt is the kit's
 *  attachment thumbnail height (`components.md` § 12), so the card argues no
 *  new geometry into the transcript. */
const FRAME_HEIGHT_PX = 64;

/** The moving segment's width, and its sweep. One token: the app's "something
 *  is still happening" beat (the shimmer's half-period). */
const SEGMENT_PCT = 38;
const SWEEP_MS = DURATIONS.beat;

/** The log tail: how many of the provider's last lines the card shows. Two
 *  mono-sm lines are a current activity plus its predecessor; more is the
 *  expansion's job, and the card must not grow a second transcript inside a
 *  row. */
const LOG_TAIL_LINES = 2;

/**
 * The indeterminate progress: a segment sweeping the track, left to right.
 *
 * Reduced motion stops it at its RESTING frame — mid-track, where a static
 * segment still reads as a progress control — because a looping animation is
 * removed rather than slowed (`tokens.json § motion.reducedMotion`; the
 * shimmer and the skeleton do the same).
 */
const IndeterminateTrack = () => {
	const reduceMotion = useReducedMotion();
	const value = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		if (reduceMotion) {
			value.setValue(0.5);
			return;
		}
		value.setValue(0);
		const loop = Animated.loop(
			Animated.timing(value, {
				toValue: 1,
				duration: SWEEP_MS,
				// The token's own linear curve, through the one adapter — a sweep
				// is a position change, and the system's easings are the only
				// allowed timings (`motion.ts`).
				easing: Easing.bezier(...parseCubicBezier(EASINGS.linear)),
				// `left` is a layout property: it cannot run on the native driver.
				useNativeDriver: false,
			}),
		);
		loop.start();
		return () => loop.stop();
	}, [reduceMotion, value]);

	return (
		<Animated.View
			className="absolute bottom-0 top-0 rounded-full bg-accent"
			style={{
				width: `${SEGMENT_PCT}%`,
				left: value.interpolate({
					inputRange: [0, 1],
					outputRange: [`-${SEGMENT_PCT}%`, "100%"],
				}),
			}}
		/>
	);
};

/** The determinate branch: the feed stated a fraction, so the bar draws it —
 *  width only; a percentage numeral would be a second, redundant measurement. */
const DeterminateTrack = ({ fraction }: { fraction: number }) => (
	<View
		className="absolute bottom-0 left-0 top-0 rounded-full bg-accent"
		style={{ width: `${Math.round(fraction * 100)}%` }}
	/>
);

/** The image's slot while it is generated: a sunken frame whose bottom edge is
 *  the progress track. */
const GeneratingFrame = ({
	fraction,
	label,
}: {
	fraction: number | null;
	label: string;
}) => (
	<View
		className="overflow-hidden rounded-sm border border-hairline bg-sunken"
		style={{ height: FRAME_HEIGHT_PX }}
		// The region a screen reader hears as the live part of the card; the
		// visible word beside it is the same sentence, so nothing is announce-only.
		accessibilityRole="progressbar"
		accessibilityLabel={label}
	>
		<View className="absolute bottom-0 left-0 right-0 h-1 bg-elevated">
			{fraction === null ? (
				<IndeterminateTrack />
			) : (
				<DeterminateTrack fraction={fraction} />
			)}
		</View>
	</View>
);

/** The tail of the provider's own log, last lines first in reading order. */
const LogTail = ({ lines }: { lines: string[] }) => (
	<Text
		className="font-mono text-mono-sm text-ink-dim"
		numberOfLines={LOG_TAIL_LINES}
	>
		{lines.slice(-LOG_TAIL_LINES).join("\n")}
	</Text>
);

export const ImageGenCard = ({
	view,
	entryId,
	loadImage,
	onCancelTurn,
	testID,
}: ImageGenCardProps) => {
	/**
	 * Whether a cancel has been requested and its confirmation has not landed.
	 * `null` would be wrong: the press is the reader's act and it survives
	 * re-renders until the ENTRY settles (the effect below), which is the
	 * confirmation the card waits for.
	 */
	const [cancelRequested, setCancelRequested] = useState(false);

	// The overlay clears when the entry leaves its live phases: the state the
	// card then draws is the wire's own, whatever it is. This is the ONLY path
	// that clears it — a cancel whose command failed leaves the entry running,
	// and the card keeps saying "Cancelling…" rather than snap back to
	// "Generating image" as if the request had never been made (the composer,
	// whose error surface is where the failure is stated, is beside it).
	useEffect(() => {
		if (view.phase !== "queued" && view.phase !== "running") {
			setCancelRequested(false);
		}
	}, [view.phase]);

	const phase: ImageGenCardPhase =
		cancelRequested && (view.phase === "queued" || view.phase === "running")
			? "cancelling"
			: view.phase;
	/* The already-finished reading (a failed row that is really the
	 *  cancel-vs-finished conflict) takes the quiet tone: the frozen rule is
	 *  that the conflict is never painted as an error. */
	const tone = view.alreadyFinished
		? IMAGEGEN_ALREADY_FINISHED_TONE
		: IMAGEGEN_TONE[phase];
	const line = imageGenStateLine(phase, {
		queuePosition: view.live.queuePosition,
		hasArtifact: view.artifact !== null,
		alreadyFinished: view.alreadyFinished,
	});
	/* The control is shown only where it applies: a live phase, no request in
	 * flight, and a live turn to interrupt (the screen withholds `onCancelTurn`
	 * while the composer's own Stop is not visible, so the two controls share
	 * one gate). */
	const showCancel =
		view.cancelable && !cancelRequested && onCancelTurn !== undefined;
	const liveTone = phase === "running" || phase === "cancelling";

	return (
		<View
			className={cx(
				"rounded-sm px-2",
				(phase === "queued" || liveTone) && "bg-elevated",
				phase === "failed" && !view.alreadyFinished && "bg-danger-wash",
			)}
			testID={testID}
		>
			<View className="min-h-11 flex-row items-center gap-1.5">
				<Text
					className={cx(
						"w-4 shrink-0 text-center font-mono text-mono-sm",
						tone.inkClass,
					)}
					aria-hidden
				>
					{tone.glyph}
				</Text>
				<Text
					className="min-w-0 shrink truncate font-mono text-mono-sm text-ink-muted"
					numberOfLines={1}
				>
					{view.tool}
				</Text>
				<Text
					className="min-w-0 flex-1 text-body-sm text-ink-dim"
					numberOfLines={1}
				>
					{view.summary}
				</Text>
				{view.elapsed !== null ? (
					<Text className="shrink-0 font-mono text-mono-sm text-ink-dim tabular-nums">
						{view.elapsed}
					</Text>
				) : null}
				{showCancel ? (
					<Button
						label="Cancel"
						variant="outline"
						size="sm"
						accessibilityHint="Stops the running turn, which cancels this generation."
						onPress={() => {
							setCancelRequested(true);
							onCancelTurn();
						}}
						testID={imagegenCancelId(entryId)}
					/>
				) : null}
			</View>
			{phase === "queued" ? (
				<View className="pb-1.5 pl-6">
					<Text className="text-body-sm text-ink-muted">{line}</Text>
				</View>
			) : null}
			{liveTone ? (
				<View className="gap-1.5 pb-1.5 pl-6">
					{/* The word shimmers while the call is still moving — the kit's
					 *  own "still arriving" signal, shared with the streaming row —
					 *  and stops at its resting frame under reduced motion like
					 *  every other loop. */}
					<Shimmer active>
						<Text className="text-body-sm text-ink-muted">{line}</Text>
					</Shimmer>
					<GeneratingFrame
						fraction={view.live.progress}
						label={view.elapsed === null ? line : `${line}, ${view.elapsed}`}
					/>
					{view.live.logs.length > 0 ? (
						<LogTail lines={view.live.logs} />
					) : null}
				</View>
			) : null}
			{phase === "done" ? (
				<View className="flex-row items-center gap-2 pb-1.5 pl-6">
					{/* The finished image through the EXISTING transcript image path:
					 *  artifact blocks are indexed like images and served by the same
					 *  route, so the card hands `TranscriptImage` the same two facts
					 *  the assistant rows do. */}
					{view.artifact !== null && loadImage !== undefined ? (
						<TranscriptImage
							entryId={entryId}
							index={view.artifact.index}
							mimeType={view.artifact.mimeType}
							load={loadImage}
							testID={transcriptImageId(entryId, view.artifact.index)}
						/>
					) : null}
					<Text className="min-w-0 flex-1 text-body-sm text-ink-muted">
						{line}
					</Text>
				</View>
			) : null}
			{phase === "failed" ? (
				<View className="gap-1 pb-1.5 pl-6">
					<Text className="text-body-sm text-ink-muted">{line}</Text>
					{/* The platform's own sentence, verbatim — the one place on this
					 *  card where the machine speaks. WITHHELD for the
					 *  cancel-vs-finished conflict: that reading is "Already
					 *  finished", and a conflict must never be dressed as an error
					 *  (the frozen rule); the sentence is the conflict's own, so it
					 *  has no quieter register to take here. */}
					{view.live.error !== null && !view.alreadyFinished ? (
						<Text className="text-body-sm text-danger">{view.live.error}</Text>
					) : null}
				</View>
			) : null}
			{phase === "cancelled" ? (
				<View className="gap-1 pb-1.5 pl-6">
					<Text className="text-body-sm text-ink-muted">{line}</Text>
					{/* Affordance slot: restart / steer (v1 = interrupt + a NEW
					 *  generate call) mounts HERE once its op is defined. NOT wired:
					 *  the frozen facts reserve it, and a control that cannot work is
					 *  worse than its absence. */}
				</View>
			) : null}
		</View>
	);
};
