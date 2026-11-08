/**
 * The recording level meter's arithmetic, as pure functions.
 *
 * The meter is what makes a recording legible as a recording at a glance (design
 * §2.5's "the word, dot and timer carry the state"; the bars are the fourth
 * carrier, and the one that shows the microphone is actually hearing something —
 * a silent take reads as an empty transcript, and the reader deserves to see that
 * while it is still fixable).
 *
 * The unit is dBFS, which is what `expo-audio` reports under `metering` when the
 * recorder is built with `isMeteringEnabled: true`: 0 dBFS is full scale and every
 * real signal is negative, most speech landing around -30 to -6. The mapping to
 * `[0, 1]` is a LINEAR clamp over a fixed window rather than a perceptual curve, on
 * purpose: this is a "is it picking me up" indicator, not an instrument, and a fixed
 * window is the version that is testable and that a reader can predict.
 *
 * No React, no React Native, no device.
 */

/** Below this the microphone is, for the meter's purpose, not hearing anything. */
export const METER_FLOOR_DB = -60;

/** Full scale. */
export const METER_CEIL_DB = 0;

/** The number of bars in the meter. Fixed: the bar row must not change width as
 *  the level moves, or the composer reflows while the reader is speaking. */
export const LEVEL_BARS = 16;

/** How often the recorder's level is sampled while a take is live (8 Hz): fast
 *  enough that the bars track speech, slow enough that the native status reads
 *  stay cheap. Shared by the sampler (`use-dictation.ts`) and the meter, which
 *  slides each new bar in over exactly one interval so the waveform ROLLS at the
 *  display's frame rate instead of stepping at 8 Hz. */
export const METER_SAMPLE_MS = 120;

/**
 * One metering reading as a `[0, 1]` bar height.
 *
 * Non-finite readings map to 0 rather than to a mid value: a meter that jumps to
 * half height when its instrument fails is a meter that lies about a silent take,
 * which is the one thing it exists to catch.
 */
export function meterFraction(dbfs: number | null | undefined): number {
	if (dbfs === null || dbfs === undefined || !Number.isFinite(dbfs)) return 0;
	const clamped = Math.min(METER_CEIL_DB, Math.max(METER_FLOOR_DB, dbfs));
	return (clamped - METER_FLOOR_DB) / (METER_CEIL_DB - METER_FLOOR_DB);
}

/**
 * Append one reading to a rolling history of exactly `bars` entries, oldest first.
 *
 * The window is fixed-length so the meter scrolls rather than grows: a growing row
 * would move the composer's own layout while the reader is mid-sentence.
 */
export function pushLevel(
	history: readonly number[],
	next: number,
	bars: number = LEVEL_BARS,
): number[] {
	if (bars <= 0) return [];
	return [...history, next].slice(-bars);
}

/**
 * The history as exactly `bars` bar heights, oldest first, RIGHT-anchored.
 *
 * A fresh take starts at the right edge and scrolls leftward as it fills, so a
 * history shorter than the row leaves the leading slots at 0 (the meter draws
 * its floor there) and the newest reading always sits in the last slot — the
 * slot the eye watches, and the one the rolling animation slides in. A history
 * LONGER than the row keeps only its newest `bars` readings (decimation by
 * window: older speech has already scrolled off). Pure, so the mapping the
 * meter draws is tested rather than read off a frame.
 */
export function waveformBars(
	history: readonly number[],
	bars: number = LEVEL_BARS,
): number[] {
	if (bars <= 0) return [];
	return Array.from({ length: bars }, (_, index) => {
		const offset = history.length - bars + index;
		const level = offset >= 0 ? history[offset] : 0;
		return level === undefined || !Number.isFinite(level)
			? 0
			: Math.min(1, Math.max(0, level));
	});
}

/** How many of the newest readings the reduce-motion bar holds its peak over:
 *  at the hook's 120 ms sampling, four readings is about half a second. */
export const STATIC_PEAK_WINDOW = 4;

/**
 * The single level the REDUCE-MOTION meter shows: the peak of the newest
 * `window` readings.
 *
 * Reduce Motion replaces the rolling waveform with one static level bar, and a
 * bar that tracked every 120 ms reading would still flicker — motion by another
 * name. Holding the recent peak changes it only as often as the reader's
 * loudness actually changes, which still answers "is it hearing me" (the
 * meter's one job) without animating.
 */
export function peakLevel(
	history: readonly number[],
	window: number = STATIC_PEAK_WINDOW,
): number {
	if (window <= 0) return 0;
	let peak = 0;
	for (const level of history.slice(-window)) {
		if (Number.isFinite(level) && level > peak) peak = level;
	}
	return Math.min(1, peak);
}

/**
 * The meter's live history, held outside React on purpose.
 *
 * The level is sampled several times a second while a recording is live, and the
 * meter is SIXTEEN bars in a row that changes every sample. Holding that in React
 * state would re-render the whole composer — including the controlled `Textarea` the
 * reader is looking at (defect 1: the draft must stay readable while recording) —
 * eight times a second, to update one row of decoration. So the history lives here,
 * and the one component that draws it subscribes through `useSyncExternalStore`;
 * nothing else re-renders when the level moves.
 *
 * `get()` returns the SAME array identity until `set()` is called, which
 * `useSyncExternalStore` requires (a fresh array per read is an infinite render
 * loop).
 */
export interface MeterStore {
	get(): readonly number[];
	set(levels: readonly number[]): void;
	/** Appends one reading, keeping the last `bars`. */
	push(level: number): void;
	subscribe(onChange: () => void): () => void;
}

export function createMeterStore(bars: number = LEVEL_BARS): MeterStore {
	let levels: readonly number[] = [];
	const listeners = new Set<() => void>();
	const emit = () => {
		for (const listener of listeners) listener();
	};
	return {
		get: () => levels,
		set: (next) => {
			levels = next;
			emit();
		},
		push: (level) => {
			levels = pushLevel(levels, level, bars);
			emit();
		},
		subscribe: (onChange) => {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		},
	};
}
