import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { elapsedLabel } from "@/lib/format";
import { useReducedMotion } from "@/ui/components";

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
	testID?: string;
};

/** The braille spinner the TUI uses everywhere it says "running". A text glyph,
 *  not an icon font: it survives every system font. */
const SPINNER = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];

const SPINNER_MS = 80;

export const WorkingLine = ({
	activity,
	startedS,
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

	if (activity.length === 0) return null;
	const hasClock = startedS !== null;

	return (
		<View
			className="flex-row items-center gap-2 px-4 py-2"
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
			<Text className="w-[6ch] shrink-0 text-right font-mono text-mono-sm text-ink-dim tabular-nums">
				{hasClock ? elapsedLabel(elapsed) : ""}
			</Text>
		</View>
	);
};
