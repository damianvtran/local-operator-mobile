/**
 * When the empty-account set-up screen lists the account again.
 *
 * Why it exists (PR #261): the screen tells a reader with no computer to finish
 * on the desktop and promises "this list updates by itself". Two things went
 * wrong with the first version, which re-listed from a `useFocusEffect` whose
 * callback depended on "is the set-up path showing":
 *
 *  - Q1 (BLOCKER): that flag is false while a list request is in flight, so
 *    every refresh flipped it false → true, handed `useFocusEffect` a new
 *    callback, re-ran it on the focused screen and refreshed again. QA measured
 *    200 `GET /v1/tunnels` in 2.5 s for as long as the screen was in front.
 *  - U2: a reader who leaves the phone on the desk while setting up the Mac
 *    never focuses the screen again, so nothing re-listed at all.
 *
 * So the triggers are EVENTS (focus, return to the foreground, a slow tick
 * while in front, the "Check again" button), never a render, and one small
 * state machine owns them so its invariant can be tested over a fake clock:
 *
 *  1. At most ONE list request is in flight. A trigger while one runs is
 *     dropped, not queued — the running one answers the same question.
 *  2. Automatic starts (focus, foreground, tick) are at least `intervalMs`
 *     apart. Focus inside the window schedules the next tick instead of
 *     starting now, so a tab flick cannot become a burst.
 *  3. "Check again" is the reader's own tap: it starts at once unless a request
 *     is in flight (invariant 1 still holds), and it restarts the window.
 *  4. Nothing runs while the screen is blurred or the app is backgrounded, or
 *     while `isEnabled()` is false (the populated list, a sign-in refusal, the
 *     connector wait's own 4 s poll). `isEnabled` is READ at trigger time, so a
 *     flag that flips on every render cannot start anything by itself.
 */

/**
 * The automatic cadence. MEASURED before choosing (2026-11-14, from the PR's
 * build node, `curl` × 20 to `https://api.radienthq.com/v1/tunnels`): median
 * 20 ms, max 38 ms, 34-byte body for an unauthenticated 401 — the network and
 * edge floor of one discovery call; an authenticated list adds the row read and
 * returns a few hundred bytes per computer. The cost is not the request, it is
 * the multiplier: one phone left on this screen. 15 s gives 4 requests a
 * minute, and matches the list stream's own reconnect ceiling
 * (`reconnectDelay`, 15 s), so the slowest the app re-asks Radient anywhere is
 * the same number. The connector wait's 4 s poll (`CONNECTOR_WAIT.pollMs`) is
 * for the minutes after the reader says "I've run it"; this one may sit for an
 * hour.
 */
export const SETUP_POLL_MS = 15_000;

export type SetupPollTimers = {
	now: () => number;
	setTimeout: (run: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
};

export type SetupPoller = {
	/** The screen came into focus. */
	focus: () => void;
	/** The screen lost focus. */
	blur: () => void;
	/** The app came to (`true`) or left (`false`) the foreground. */
	foreground: (active: boolean) => void;
	/** The reader's "Check again". */
	checkNow: () => void;
	/** Stop every timer; later triggers do nothing. */
	dispose: () => void;
};

const defaultTimers: SetupPollTimers = {
	now: () => Date.now(),
	setTimeout: (run, ms) => setTimeout(run, ms),
	clearTimeout: (handle) =>
		clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createSetupPoller(deps: {
	refresh: () => Promise<void>;
	isEnabled: () => boolean;
	/** When the account was last listed by ANYONE (epoch ms, from `now()`'s
	 *  clock): sign-in's own discovery, the Refresh button. An automatic start
	 *  counts from the later of this and its own last start, so landing on the
	 *  set-up screen straight from sign-in does not list the account a second
	 *  time 0.2 s later (PR #261 Q9: sign-in's GET, then the poll's start on
	 *  the foreground event the sign-in popup's return raises). */
	listedAt?: () => number;
	/** Told when a request starts (`true`) and settles (`false`). */
	onChecking?: (checking: boolean) => void;
	intervalMs?: number;
	timers?: SetupPollTimers;
}): SetupPoller {
	const interval = deps.intervalMs ?? SETUP_POLL_MS;
	const timers = deps.timers ?? defaultTimers;
	let focused = false;
	let active = true;
	let disposed = false;
	let inFlight = false;
	/* `-Infinity` so the very first focus starts at once. */
	let lastStart = Number.NEGATIVE_INFINITY;
	let timer: unknown = null;

	const clear = () => {
		if (timer !== null) timers.clearTimeout(timer);
		timer = null;
	};
	const running = () => focused && active && !disposed;

	const start = () => {
		inFlight = true;
		lastStart = timers.now();
		deps.onChecking?.(true);
		void deps
			.refresh()
			.catch(() => {
				/* The provider records a discovery failure on its own state; the
				 *  poll's job is only not to start the next one early. */
			})
			.finally(() => {
				inFlight = false;
				if (!disposed) deps.onChecking?.(false);
			});
	};

	/** Arm the next automatic tick `wait` ms from now. */
	const schedule = (wait: number) => {
		clear();
		if (!running()) return;
		timer = timers.setTimeout(() => {
			timer = null;
			automatic();
		}, wait);
	};

	/* Every path arms a POSITIVE delay (PR #261 R2-1). The first version armed
	 *  `max(0, lastStart + interval - now)` on every tick, and a tick that was due
	 *  but could not start (`isEnabled()` false — the populated list, waiting,
	 *  signed out, a discovery failure — or a request still in flight past the
	 *  interval) left `lastStart` where it was, so the next wait was 0 again: QA
	 *  measured ~242 zero-delay arms a second on the real path, for as long as the
	 *  Computers screen was in front. A blocked tick now looks again a full
	 *  interval later.
	 *  Cost of the trade: a screen that BECOMES eligible waits up to one interval
	 *  for its first automatic list — "Check again" still starts at once. */
	const automatic = () => {
		if (!running()) return;
		const listed = Math.max(
			lastStart,
			deps.listedAt?.() ?? Number.NEGATIVE_INFINITY,
		);
		const remaining = listed + interval - timers.now();
		if (remaining > 0) {
			schedule(remaining);
			return;
		}
		if (!inFlight && deps.isEnabled()) start();
		schedule(interval);
	};

	return {
		focus: () => {
			focused = true;
			automatic();
		},
		blur: () => {
			focused = false;
			clear();
		},
		foreground: (next) => {
			active = next;
			if (next) automatic();
			else clear();
		},
		checkNow: () => {
			if (!running() || inFlight || !deps.isEnabled()) return;
			start();
			schedule(interval);
		},
		dispose: () => {
			disposed = true;
			clear();
		},
	};
}
