/**
 * The web-target harness hook for the DICTATION STATES — the `lo-dictation` query
 * value a capture cell may set.
 *
 * Same convention as `lo-recorder`/`lo-relay`/`lo-notifications`
 * (`stt/recorder.ts`, `features/auth/connection-provider.tsx`,
 * `notifications/permission.ts`): a URL can steer the harness's PAGE and never the
 * installed app, and it says nothing the app can act on beyond what it draws.
 *
 * WHY IT EXISTS. `lo-recorder=supported` makes the mic APPEAR on a harness page,
 * but the web target cannot record (there is no native recorder, by design), so
 * every dictation state past `idle` — `starting`, `recording`, `transcribing` and
 * the three outcome lines — has no rendering a reviewer can look at. The design
 * round reviews web frames; a state that cannot be captured is a state that ships
 * unreviewed. So the page may FORCE one, and nothing else: the phase, its outcome
 * line, and a deterministic level history for the meter.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never touches the real state machine, the
 * microphone or the wire. A forced snapshot is what the composer RENDERS; the
 * machine underneath stays `idle`, so a capture cannot leave a recorder open, and
 * an installed app — where `location` is not a web page — reads `null`.
 *
 * No React, no React Native. The synthetic level history is deterministic (no
 * randomness, no clock), so the same cell renders the same bytes twice.
 */

import type {
	DictationOutcome,
	DictationPhase,
	DictationSnapshot,
} from "@/stt/dictation-machine";
import { LEVEL_BARS } from "@/stt/levels";

/** The values the hook accepts, and the state each one forces. */
const FORCED: Record<string, DictationSnapshot> = {
	starting: { phase: "starting", outcome: null },
	recording: { phase: "recording", outcome: null },
	transcribing: { phase: "transcribing", outcome: null },
	added: { phase: "idle", outcome: "added" },
	empty: { phase: "idle", outcome: "empty" },
	discarded: { phase: "idle", outcome: "discarded" },
};

/**
 * The state a `lo-dictation` value names, or `null` for an absent/unknown value.
 *
 * An unknown value is `null` rather than an error: this is a viewer, and a page
 * asking to see a state that does not exist should render the ordinary composer
 * rather than crash the capture.
 */
export function dictationFromHook(
	value: string | null | undefined,
): DictationSnapshot | null {
	if (value === null || value === undefined) return null;
	return FORCED[value] ?? null;
}

/** The `lo-dictation` value this page carries, or `null` when it is not a web page. */
const hookValue = (): string | null => {
	if (typeof location === "undefined") return null;
	return new URLSearchParams(location.search).get("lo-dictation");
};

/** The state this page forces, or `null` when it forces none. */
export const forcedDictation = (): DictationSnapshot | null =>
	dictationFromHook(hookValue());

/**
 * A deterministic level history for the meter, so a `recording` frame shows PEAKS
 * rather than a flat row.
 *
 * Deliberately synthetic and shaped like speech (a swell and a decay rather than a
 * sawtooth) so the frame reads as a meter at work; it is a viewer, and the real
 * levels come from the recorder's own metering on a device.
 */
export function forcedLevels(bars: number = LEVEL_BARS): number[] {
	return Array.from({ length: bars }, (_, index) => {
		const phase = (index / bars) * Math.PI * 2;
		return Math.max(0.08, 0.55 + 0.42 * Math.sin(phase * 1.5));
	});
}

export type { DictationOutcome, DictationPhase };
