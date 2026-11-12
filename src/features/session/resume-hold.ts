/**
 * The resume hold: why a drop seen around a return from the background is not
 * reported as an outage, and for how long.
 *
 * WHY (TestFlight build 836: "when I close my phone and put it down and then open
 * up again to the app I see the connection lost banner"). iOS suspends the app's
 * JavaScript a few seconds after the screen locks, and the session stream's
 * socket dies with it. Two things then painted `C2` ("The connection dropped.
 * Reconnecting…") and the yellow "Reconnecting" dot on the first frame back:
 *
 * 1. **Timers that slept through the suspension fire at once.** The drop grace
 *    (`OUTAGE_GRACE_MS`, 2.5 s) and the reconnect deadline
 *    (`RECONNECT_DEADLINE_MS`, 5 s) were armed by the drop seen as the phone
 *    went to sleep; a frozen process does not run them, and on resume their
 *    wall-clock deadlines have long passed, so they fire on the first tick —
 *    before the reconnect that the `AppState` "active" handler starts has had a
 *    chance to land a frame. The handler reset only the age, never the drop.
 * 2. **The first reconnect after an unlock often fails.** The radio and the
 *    route are still waking, so attempt one errors, the backoff waits 1 s, then
 *    2 s — and the 2.5 s grace expires before attempt three. A reader saw a
 *    warning for a reconnect that succeeded a second later.
 *
 * THE POLICY. A drop while backgrounded is expected and never reported. A return
 * (an `AppState` "active", or a timer that fired late enough to prove the
 * process was suspended) opens a {@link RESUME_GRACE_MS} window in which a drop
 * or an overdue reopen is held silent while the stream retries; only one still
 * standing when the window closes is reported. A frame clears everything at
 * once. Typed refusals (a 401, a revoked device, a gateway refusal) never pass
 * through here: `use-session.ts` routes them straight to `setError`, so they
 * surface as promptly as before.
 *
 * WHY 8 s. It is the existing backoff's own schedule (`reconnectDelay`: 1 s,
 * 2 s, 4 s, …), not a new guess: the resume reconnect fires at once (t≈0), then
 * after failures at t≈1 s, t≈3 s and t≈7 s. 8 s therefore covers the immediate
 * attempt plus THREE retries, with 1 s for the last one's round trip — the
 * "about 3 attempts / about 8 s" the report asks for, and the same answer both
 * ways. It is also longer than `RECONNECT_DEADLINE_MS` (5 s), so a reopen that
 * connects but stays silent still becomes `C2` the moment the window closes.
 * The relay web app has the same shape with a shorter grace (`store.ts` `wake`:
 * reconnect immediately, report only after `OUTAGE_GRACE_MS`); the phone's
 * longer window is the radio-wake cost a browser tab does not pay.
 *
 * No React, no React Native: the hook owns `AppState`, this owns the arithmetic,
 * so it is testable with fake timers alone.
 */

/** The silent window after a return from the background. See the module note. */
export const RESUME_GRACE_MS = 8_000;

/** The relay's own outage grace, `OUTAGE_GRACE_MS` in `store.ts` at 24d328a1:
 *  an outage is REPORTED only once it has stood this long, so a blip never
 *  paints (or speaks) a state the reader would have to un-read. Shared by the
 *  conversation stream (`use-session.ts`) and the list stream
 *  (`connection-provider.tsx`) so the two hold a drop alike. */
export const OUTAGE_GRACE_MS = 2500;

/**
 * How late a timer may fire before it counts as having slept through a
 * suspension. A JS thread busy with a long render or a GC pause runs timers late
 * by tens to a few hundred milliseconds; a suspended app runs them late by the
 * whole time the screen was off (≥ seconds). 1 s sits well between the two, so a
 * busy foreground never fakes a resume and a real suspension is never missed.
 */
export const SUSPEND_SLACK_MS = 1_000;

export interface ResumeClock {
	/** The app went to the background: drops seen from now on are expected. */
	background: () => void;
	/** The app is back: open the silent window from now. */
	resume: () => void;
	/** Whether the app is backgrounded (by the last `AppState` signal). */
	backgrounded: () => boolean;
	/**
	 * How long a report that would normally wait `minMs` must wait from now:
	 * `minMs`, or the rest of the resume window when that is longer.
	 */
	holdMs: (minMs: number) => number;
	readonly now: () => number;
}

export const createResumeClock = (
	now: () => number = Date.now,
): ResumeClock => {
	let resumedAt: number | null = null;
	let inBackground = false;
	return {
		now,
		background: () => {
			inBackground = true;
		},
		resume: () => {
			inBackground = false;
			resumedAt = now();
		},
		backgrounded: () => inBackground,
		holdMs: (minMs) =>
			resumedAt === null
				? minMs
				: Math.max(minMs, resumedAt + RESUME_GRACE_MS - now()),
	};
};

/**
 * A `setTimeout` for a failure REPORT that does not count background time.
 *
 * Fires `fire` after `clock.holdMs(minMs)` — unless, when it comes due:
 * - the app is backgrounded: nothing is reported and the timer re-arms, so the
 *   decision waits for the return (which clears the drop and reconnects) rather
 *   than being dropped — a dropped one would leave its owner believing a report
 *   is still pending and never report a real outage after the return;
 * - it fired more than {@link SUSPEND_SLACK_MS} late: the process was suspended,
 *   which is a return whose `AppState` event may not have been delivered yet
 *   (iOS gives no ordering between the two). The window opens from now and the
 *   timer re-arms for it, so the report is decided by the reconnect's outcome,
 *   not by how long the phone was in a pocket.
 *
 * Returns the cancel function.
 */
export const heldTimer = (
	clock: ResumeClock,
	minMs: number,
	fire: () => void,
): (() => void) => {
	let handle: ReturnType<typeof setTimeout> | null = null;
	const arm = () => {
		const delay = clock.holdMs(minMs);
		const due = clock.now() + delay;
		handle = setTimeout(() => {
			handle = null;
			if (clock.backgrounded()) {
				arm();
				return;
			}
			if (clock.now() - due > SUSPEND_SLACK_MS) {
				clock.resume();
				arm();
				return;
			}
			fire();
		}, delay);
	};
	arm();
	return () => {
		if (handle !== null) clearTimeout(handle);
		handle = null;
	};
};
