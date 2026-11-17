/**
 * React to a REAL push-token change, not to every token read.
 *
 * WHY THIS EXISTS (the 2026-11-17 push-registration loop). expo-notifications'
 * `getDevicePushTokenAsync()` asks the OS for the token again on every call
 * (iOS: `registerForRemoteNotifications()`), and the native module answers
 * BOTH ways at once: it resolves the pending promise AND emits
 * `onDevicePushToken` to every `addPushTokenListener` subscriber, even when the
 * token is the one it already handed out (`PushTokenModule.swift`
 * `didRegister`; expo-notifications 57.0.21, read 2026-11-17). So a token
 * listener that re-registers, where registration itself reads the token, is a
 * feedback loop:
 *
 *   session push register → token read → event → session listener queues a
 *   re-run → token read → event → … (forever, at APNs round-trip speed)
 *
 * and every one of those events also woke the Team Bridge listener, which
 * PUT `/v1/messaging/push/devices` each time — ~20 a second from one phone,
 * enough for the edge WAF to block the owner's whole network address.
 *
 * A token listener therefore goes through `addPushTokenChangeListener`, which
 * calls back only when the token differs from the last one THAT LISTENER saw.
 * A real APNs/FCM rotation still re-registers; an echo of a read never does.
 *
 * WHY THE MEMORY IS PER LISTENER (QA round 1, Q1). Two paths subscribe — session
 * pushes and Team Bridge — and each must hear a rotation once. A single shared
 * "last seen" let the first listener to receive a rotation event record it, so
 * the second listener saw the new token as already seen and never
 * re-registered: one server kept the dead token until the next foreground. So
 * each subscription keeps its own copy, and a read (`notePushToken`) updates
 * every copy at once, because one path's read is the same device token for both.
 *
 * WHY A READ CAN NOTIFY (reviewer round 1, m2). On iOS a rotation is often
 * discovered by a read (`registerForRemoteNotifications`), not by an event the
 * app was waiting for. If session pushes did that read, recording the new token
 * silently would filter the echo for Team Bridge too and leave the hub on the
 * old token. So when a read reports a token that differs from what a listener
 * already held (not the first token of the process — that is a launch, which
 * both paths register on their own), that listener is called back. This cannot
 * loop: every copy holds the new token before any callback runs, so the
 * callbacks' own reads and echoes compare equal.
 *
 * Ordering is not guaranteed between the promise resolving and the event
 * arriving in JS, so a listener records an event's token itself too: whichever
 * comes first, at most one echo per listener can slip through before its copy
 * holds the token, and that echo's own read is then filtered.
 */

type Subscriber = { lastSeen: string | null; onChange: () => void };

/** The last APNs/FCM token this process saw; seeds a new subscriber's copy. */
let lastSeen: string | null = null;
const subscribers = new Set<Subscriber>();

/**
 * Record a token a read just returned, so its echo event is not a "change" for
 * any listener — and call back each listener that held a DIFFERENT token
 * (a rotation the read discovered; see "WHY A READ CAN NOTIFY").
 */
export function notePushToken(token: unknown): void {
	if (typeof token !== "string" || token.length === 0) return;
	lastSeen = token;
	const stale: Subscriber[] = [];
	for (const subscriber of subscribers) {
		if (subscriber.lastSeen !== null && subscriber.lastSeen !== token)
			stale.push(subscriber);
		subscriber.lastSeen = token;
	}
	// Only after every copy holds the token, so a callback's own read is quiet.
	for (const subscriber of stale) subscriber.onChange();
}

type TokenEvent = { data?: unknown } | null | undefined;

/** The slice of the expo-notifications module this needs (a test seam). */
export interface PushTokenEmitter {
	addPushTokenListener(listener: (token: TokenEvent & object) => void): {
		remove: () => void;
	};
}

/**
 * `module.addPushTokenListener`, but `onChange` runs only for a token that
 * differs from the last one this listener saw. An event without a readable
 * token is ignored: there is nothing to compare, and re-registering on noise is
 * the defect this guards against.
 */
export function addPushTokenChangeListener(
	module: PushTokenEmitter,
	onChange: () => void,
): { remove: () => void } {
	const subscriber: Subscriber = { lastSeen, onChange };
	subscribers.add(subscriber);
	const subscription = module.addPushTokenListener((event) => {
		const token = (event as TokenEvent)?.data;
		if (typeof token !== "string" || token.length === 0) return;
		// Process-wide too, so a listener added later starts from this token.
		lastSeen = token;
		if (token === subscriber.lastSeen) return;
		subscriber.lastSeen = token;
		onChange();
	});
	return {
		remove: () => {
			subscribers.delete(subscriber);
			subscription.remove();
		},
	};
}

/**
 * Tests only: a fresh process. Forgets the token AND drops every subscriber, so
 * a listener a previous test never removed cannot be called back by this
 * test's reads.
 */
export function resetPushTokenMemory(): void {
	lastSeen = null;
	subscribers.clear();
}
