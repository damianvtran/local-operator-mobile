/** How close together two resume signals may land and still count as one.
 *
 * WHY. A return to the app is reported by several signals that arrive in a
 * burst: `AppState` "active" (twice on a quick flick out and back, or when a
 * system sheet such as Face ID or the notification shade comes and goes), and
 * the first frame of the stream that the same return re-opened. Each one asks
 * for the newest history page; without a gate a single return paid for two or
 * three identical reads, and the second one raced the gap fill the first one
 * started. The relay web app has the same shape (`store.ts` `wake`, which only
 * reconnects a stream that is backing off or silent for 20 s).
 *
 * 1.5 s is longer than the active→inactive→active bounce of a system sheet
 * and the stream's reconnect-and-first-frame on a healthy link, and short
 * enough that a reader who really leaves and comes back is always served. */
export const RESUME_DEBOUNCE_MS = 1500;

/** A resume gate: `true` when this signal should re-read, `false` when one
 * did within the debounce interval. One gate per screen-owned reader. */
export const createResumeGate = (
	intervalMs: number = RESUME_DEBOUNCE_MS,
	now: () => number = Date.now,
): (() => boolean) => {
	let last = Number.NEGATIVE_INFINITY;
	return () => {
		const at = now();
		if (at - last < intervalMs) return false;
		last = at;
		return true;
	};
};
