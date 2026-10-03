/**
 * The pending destination: where an inbound link or a push tap is taking the
 * app, held until the connection can actually take it there.
 *
 * A cold-start link usually arrives before any session exists (a tunnel
 * session may need minting, ADR 0002 §3), so the destination is held in
 * connection-adjacent state and consumed when the route reaches `live` — the
 * resolver hook is the consumer (ADR 0006 §6.4-6.5). Three properties are the
 * contract, and they are properties of THIS module because a screen cannot
 * always be mounted when the destination arrives:
 *
 * - **Precedence.** A push tap at launch outranks an inbound `s/<id>` link
 *   (ADR §6.2: notification response > link > default), so the two note
 *   functions carry ranks and the lower rank cannot displace a held higher
 *   one. Equal ranks replace: the latest intent about the same rank wins.
 * - **Consumed exactly once.** `take` clears before it returns, so a re-render,
 *   a theme change, a StrictMode double-effect or a re-auth cannot resolve the
 *   same destination twice (ADR §6.3). A second `take` is `null`.
 * - **Not a router.** Nothing here navigates or validates against a route: a
 *   destination recorded while the app is on computer A is resolved only after
 *   a live connection exists, so it can never be resolved against A's cache
 *   after the user switches to B (ADR §6.5). The resolver owns that judgement.
 *
 * Module-level, like the session route slot (`runtime.ts`), and for the same
 * reason: `+native-intent` runs outside app context and can only reach module
 * state, not React state.
 */

/** A push tap's parsed payload half: the opaque conversation handle, and the
 *  opaque per-account computer handle when the machine sent one. */
export interface ConversationPush {
	/** `data.conversation` — an opaque handle, never a raw session id. */
	conversation: string;
	/** `data.computer` — opaque per-account handle; the app cannot map it to a
	 *  route today (the register response carries no computer handle, ADR
	 *  :753-760), so it is carried for the resolver's future decision and
	 *  otherwise unread. */
	computer: string | null;
}

export type PendingDestination =
	| {
			/** Monotonic per recording; the resolver's single-flight key. */
			id: number;
			/** Epoch ms the destination was recorded — the bounded wait is
			 *  measured from here, not from a later re-render. */
			at: number;
			kind: "session";
			sessionId: string;
			rank: 1;
	  }
	| {
			id: number;
			at: number;
			kind: "conversation";
			handle: string;
			computer: string | null;
			rank: 2;
	  };

/** Notification response (2) outranks an inbound link (1) — ADR §6.2. */
const RANK = { link: 1, push: 2 } as const;

let pending: PendingDestination | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

const emit = (): void => {
	for (const listener of listeners) listener();
};

const place = (next: PendingDestination): void => {
	/* The rank rule, and its whole reason: both halves of a cold start arrive
	 * before anything is consumed, and the notification response must win even
	 * when the link was recorded last (ADR §6.2's order is about precedence,
	 * not about race arrival). */
	const current = pending;
	if (current !== null && next.rank < current.rank) return;
	pending = next;
	emit();
};

/** A `localoperator://s/<id>` link arrived. */
export const noteSessionLink = (sessionId: string): void => {
	place({
		id: nextId++,
		at: Date.now(),
		kind: "session",
		sessionId,
		rank: RANK.link,
	});
};

/** A notification response arrived (the push-tap half; the real trigger waits
 *  on S7, the code path does not). */
export const noteConversationPush = (push: ConversationPush): void => {
	place({
		id: nextId++,
		at: Date.now(),
		kind: "conversation",
		handle: push.conversation,
		computer: push.computer,
		rank: RANK.push,
	});
};

/** The held destination, without consuming it — for the resolver's effects to
 *  key on. */
export const peekPendingDestination = (): PendingDestination | null => pending;

/**
 * Consume the destination: returns it once, then it is gone. The clear happens
 * BEFORE the caller acts, which is the once-only guarantee — an effect that ran
 * twice resolves nothing the second time.
 */
export const takePendingDestination = (): PendingDestination | null => {
	const current = pending;
	if (current !== null) {
		pending = null;
		emit();
	}
	return current;
};

/** Drop the destination without acting (the failure path clears through
 *  `take`; this exists for callers that must abandon one explicitly). */
export const clearPendingDestination = (): void => {
	if (pending !== null) {
		pending = null;
		emit();
	}
};

export const subscribePendingDestination = (
	listener: () => void,
): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
