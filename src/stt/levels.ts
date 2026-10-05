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
