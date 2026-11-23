/**
 * When an inbound Team Bridge card reads its body AGAIN while it is on screen.
 *
 * WHY THIS EXISTS. The card read its body once per mount and treated the first
 * answer as final. The core answers `pending` from the moment the card is
 * posted until the receiving session's next turn hands the body over, so a
 * card that mounted while pending said "Waiting to be delivered" forever, even
 * long after the body was readable (local-operator, session 439818272d84: the
 * card posted 14:56:48Z, the hand-off landed 15:11:44Z, the phone never moved).
 * Measured post→hand-off delay on the operator's machine, n=4005: p50 45 s,
 * p90 21 min, p99 100 min, max 8 h. Pending is normal and can be long, so a
 * mounted card keeps re-reading until the answer is final.
 *
 * THE POLICY (identical on desktop, TUI and phone):
 *
 *   - **Final vs non-final.** Non-final: any item `pending`; any item `held`
 *     (a transient hold clears; a review hold can still be released or
 *     refused); `unavailable` with reason `offline` or `not_loaded`; and a
 *     failed or malformed read (`null`). Everything else is final, including a
 *     state or reason this build does not know — an unknown answer fails quiet
 *     rather than polling forever.
 *   - **Backoff.** 5 s, 10 s, 20 s, 30 s, then every 60 s, with NO overall
 *     give-up: the observed maximum is 8 h, and a re-read of a pending or held
 *     item is a local read in the core (the receiver store answers before any
 *     hub backfill), so a slow steady cadence costs little.
 *   - **Stops** on a final answer and on `stop()` (unmount, entry or session
 *     change). A read that settles after `stop()` is dropped.
 *   - **Regain.** `wake()` (the app returning to `active`) re-reads at once
 *     when the answer is still non-final, then carries on the backoff.
 *   - **No cache.** The answer lives only in the caller's component state, so
 *     revocation stays live: a deleted message is gone on the next mount.
 *
 * Pure TypeScript (timers are the globals, so vitest's fake timers drive it)
 * with no React or `react-native` import, so every arm is pinned in Node.
 */

import type { BridgeCardBody } from "@/contracts";

/** The first re-read delays; after the last one the cadence is
 *  `BRIDGE_BODY_REREAD_STEADY_MS`. Sized from the distribution above: the
 *  early steps catch the median (45 s) within about a minute. */
export const BRIDGE_BODY_REREAD_BACKOFF_MS: readonly number[] = [
	5_000, 10_000, 20_000, 30_000,
];

/** The steady cadence once the backoff is spent, kept forever while mounted. */
export const BRIDGE_BODY_REREAD_STEADY_MS = 60_000;

/** Delay before re-read number `attempt` (0-based). */
export const bridgeBodyRereadDelay = (attempt: number): number =>
	BRIDGE_BODY_REREAD_BACKOFF_MS[attempt] ?? BRIDGE_BODY_REREAD_STEADY_MS;

/** `unavailable` reasons that a later read can turn into a body. */
const RETRYABLE_REASONS: ReadonlySet<string> = new Set([
	"offline",
	"not_loaded",
]);

/** Whether this answer can still change on its own, so the card should read
 *  again. `null` is a failed read (dropped link, malformed payload). */
export function bridgeBodyAnswerSettled(
	answer: BridgeCardBody | null,
): boolean {
	if (answer === null) return false;
	return !answer.items.some(
		(item) =>
			item.state === "pending" ||
			item.state === "held" ||
			(item.state === "unavailable" &&
				typeof item.reason === "string" &&
				RETRYABLE_REASONS.has(item.reason)),
	);
}

export interface BridgeBodyReread {
	/** Re-read now if the answer is still non-final (app regained focus). */
	wake: () => void;
	/** Stop for good: clears the timer and drops any read still in flight. */
	stop: () => void;
}

/**
 * Reads once now, then again on the backoff while the answer is non-final.
 * `onAnswer` receives every settled read (`null` for a failed one); the caller
 * keeps the previous answer on screen until the next one lands, so a re-read
 * never flashes back to "Loading".
 */
export function startBridgeBodyReread(
	read: () => Promise<BridgeCardBody | null>,
	onAnswer: (answer: BridgeCardBody | null) => void,
): BridgeBodyReread {
	let stopped = false;
	let settled = false;
	let inFlight = false;
	let attempt = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const clear = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};

	const run = () => {
		clear();
		if (stopped || settled || inFlight) return;
		inFlight = true;
		read()
			.catch(() => null)
			.then((answer) => {
				inFlight = false;
				if (stopped) return;
				onAnswer(answer);
				settled = bridgeBodyAnswerSettled(answer);
				if (settled) return;
				timer = setTimeout(run, bridgeBodyRereadDelay(attempt));
				attempt += 1;
			});
	};

	run();
	return {
		wake: run,
		stop: () => {
			stopped = true;
			clear();
		},
	};
}
