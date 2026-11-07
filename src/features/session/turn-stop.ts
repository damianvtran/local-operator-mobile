import { useEffect, useSyncExternalStore } from "react";

/**
 * "A stop was requested for this session and its turn has not ended yet",
 * shared by every Stop control on the session screen — the native port of the
 * relay's `lib/turn-stop.ts`.
 *
 * WHY A MODULE-LEVEL STORE. The composer's ■ and the pinned working line's
 * `stop` mount in different subtrees but answer the same question. With a latch
 * per control, a tap on each sent two `{op:"abort"}` and only the tapped one
 * dimmed (review R1-2); with a latch that only cleared on unmount, an abort that
 * reached the relay but did not end the turn left Stop dead for the rest of it,
 * and a turn that ended and restarted inside the line's 180 ms close tween
 * inherited the old turn's "stopping" (review R1-1, cases A and B). One flag per
 * session fixes all three: both controls read it, a second tap is a no-op, and
 * it is released when the turn ends (`alive` false) OR after a hard bound,
 * because a flag that outlives a lost event would leave Stop dead for good.
 */

/** The longest a stop stays "pending" without the turn ending — the relay's
 *  `STOPPING_BOUND_MS`, itself the desktop's bound for the same state. */
export const STOPPING_BOUND_MS = 15_000;

type Pending = {
	timer: ReturnType<typeof setTimeout>;
	/** The abort in flight (or settled): a repeat call joins it rather than
	 *  sending another, and still learns whether it reached the relay. */
	flight: Promise<boolean>;
};

const pending = new Map<string, Pending>();
const listeners = new Set<() => void>();

const emit = (): void => {
	for (const listener of listeners) listener();
};

const release = (sessionId: string): void => {
	const entry = pending.get(sessionId);
	if (entry === undefined) return;
	clearTimeout(entry.timer);
	pending.delete(sessionId);
	emit();
};

/**
 * Sends the session's abort through `send` (the composer's one abort path) at
 * most once per pending stop. Resolves whether the request reached the relay; a
 * request that did not is released at once so the reader can try again.
 */
export const stopTurn = (
	sessionId: string,
	send: () => Promise<boolean>,
): Promise<boolean> => {
	const existing = pending.get(sessionId);
	if (existing !== undefined) return existing.flight;
	const flight = send().then((reached) => {
		// Only release OUR entry: the bound or a turn end may already have
		// released it, and a newer stop may own the slot by now.
		if (!reached && pending.get(sessionId)?.flight === flight)
			release(sessionId);
		return reached;
	});
	pending.set(sessionId, {
		timer: setTimeout(() => release(sessionId), STOPPING_BOUND_MS),
		flight,
	});
	emit();
	return flight;
};

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** Whether a stop is pending for `sessionId`; releases it once the turn is no
 *  longer `alive`, so the next turn always starts with a working Stop. */
export const useTurnStopping = (sessionId: string, alive: boolean): boolean => {
	const stopping = useSyncExternalStore(
		subscribe,
		() => pending.has(sessionId),
		() => false,
	);
	useEffect(() => {
		if (!alive) release(sessionId);
	}, [alive, sessionId]);
	return stopping;
};

/** Test seam: forget every pending stop. */
export const resetTurnStopForTests = (): void => {
	for (const sessionId of [...pending.keys()]) release(sessionId);
};
