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
 * remembers the last token this PROCESS saw (from any listener event and from
 * every read that reports it through `notePushToken`) and calls back only when
 * the token differs. A real APNs/FCM rotation still re-registers; an echo of a
 * read never does. The memory is process-wide on purpose: the two registration
 * paths (session pushes and Team Bridge) read the same device token, so one
 * path's read must not look like a rotation to the other.
 *
 * Ordering is not guaranteed between the promise resolving and the event
 * arriving in JS, so the listener records the token itself too: whichever
 * comes first, at most one echo per process can slip through before the
 * memory holds the token, and that echo's own read is then filtered.
 */

/** The last APNs/FCM token this process saw. `null` until the first one. */
let lastSeen: string | null = null;

/** Record a token a read just returned, so its echo event is not a "change". */
export function notePushToken(token: unknown): void {
	if (typeof token === "string" && token.length > 0) lastSeen = token;
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
 * differs from the last one seen. An event without a readable token is
 * ignored: there is nothing to compare, and re-registering on noise is the
 * defect this guards against.
 */
export function addPushTokenChangeListener(
	module: PushTokenEmitter,
	onChange: () => void,
): { remove: () => void } {
	return module.addPushTokenListener((event) => {
		const token = (event as TokenEvent)?.data;
		if (typeof token !== "string" || token.length === 0) return;
		if (token === lastSeen) return;
		lastSeen = token;
		onChange();
	});
}

/** Tests only: forget the remembered token (a fresh process). */
export function resetPushTokenMemory(): void {
	lastSeen = null;
}
