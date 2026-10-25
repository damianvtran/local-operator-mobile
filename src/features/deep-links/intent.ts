/**
 * The native-intent URL shapes: what an inbound link means, as a pure function.
 *
 * `redirectSystemPath` (app/+native-intent.tsx) runs OUTSIDE app context — no
 * auth, no connection, and no guarantee anything is mounted — so everything it
 * does is this: turn a link this app recognises into the route it names, and
 * hand every other string back untouched. Destination decisions (navigate,
 * wait, fail) are not made here; they live in `pending.ts` and the resolver
 * hook, which is the only place that knows whether a route is live.
 *
 * The one link that exists in v1 is a session id: `localoperator://s/<id>`,
 * which the ADR names as the inbound half of the cold-start contract (ADR 0006
 * §6.7 — "it does not exist today"). Universal links are a v1.1 item
 * (`docs/ux/flows.md` §11), so an https link is a pass-through, never a
 * rewrite: nothing claims a domain this app does not own.
 */

/** The app's scheme, declared in `app.config.ts`. Lowercase there; URLs are
 *  case-insensitive about schemes, so the match below folds case. */
export const DEEP_LINK_SCHEME = "localoperator";

/** `localoperator://s/<id>` — the session-link shape. `[^/?#\s]+` because an id
 *  is one path segment: a second segment, a query or a fragment means this is
 *  not the link the contract describes, and the honest answer to a shape the
 *  app does not recognise is to leave it alone (the router will render
 *  not-found rather than the app guessing). */
const SESSION_LINK = /^localoperator:(?:\/\/)?s\/([^/?#\s]+)$/i;

/** `localoperator://n/<id>` — the notification link (design §10). Same one-segment
 *  rule as the session link: a second segment, a query or a fragment is not the
 *  shape this app claims, and the honest answer to an unrecognised shape is to
 *  leave it alone. */
const NOTIFICATION_LINK = /^localoperator:(?:\/\/)?n\/([^/?#\s]+)$/i;

/** An id that is only dots — `.`/`..` and their `%2e` spellings, which decode
 *  into dot segments a router normalises away (see the guard below). */
const DOTS_ONLY = /^\.+$/;

export interface NativeIntent {
	/** What the router should open: the rewritten route, or the original string. */
	path: string;
	/** The session id the link names, or `null` when this was not a session link. */
	sessionId: string | null;
	/** The notification id the link names, or `null`. A notification link is NOT
	 *  recorded as a pending session destination: the inbox detail resolves it
	 *  itself, and waiting for a conversation to become reachable is a decision
	 *  about the item, not about the link. */
	notificationId: string | null;
}

/**
 * Interpret one inbound path. Never throws: a malformed link is a pass-through,
 * and a rewrite failure must not eat a launch (the caller wraps this too —
 * `redirectSystemPath` failing is a crash at cold start).
 *
 * A non-matching path is returned BY VALUE, not trimmed or normalised — the
 * router may understand shapes this module does not, and silently changing
 * them would be this file deciding destinations it just said it does not.
 */
export function nativeIntentFor(path: string): NativeIntent {
	const trimmed = path.trim();
	const notification = NOTIFICATION_LINK.exec(trimmed);
	const notificationId = segmentOf(notification?.[1]);
	if (notificationId !== null) {
		return {
			path: `/notifications/${encodeURIComponent(notificationId)}`,
			sessionId: null,
			notificationId,
		};
	}
	const match = SESSION_LINK.exec(trimmed);
	const raw = match?.[1];
	if (raw === undefined) {
		return { path, sessionId: null, notificationId: null };
	}
	let id: string;
	let escaped: string;
	try {
		id = decodeURIComponent(raw);
		/* Re-encoded so the id cannot smuggle a path separator into the route it
		 * is interpolated into — the rewrite writes a route, and route building
		 * is string building unless it is escaped. The encode is the second half
		 * of the same operation, so it lives inside the same guard: an unpaired
		 * surrogate decodes cleanly and has no escape, and "never throws" only
		 * holds if both halves are caught. */
		escaped = encodeURIComponent(id);
	} catch {
		/* A lone `%` is not a decodable id, and a string that cannot be
		 * re-encoded is not an id either; hand the link back whole. */
		return { path, sessionId: null, notificationId: null };
	}
	/* `/` cannot survive into the route, and neither can a dots-only id: `.` and
	 * `..` are the dot segments a router normalises away (`%2e` spellings decode
	 * into them), and a normalised `/session/..` climbs out of the segment this
	 * rewrite claims. An id that is only dots is no session id — it passes
	 * through like every other shape this module does not recognise. */
	if (id.length === 0 || id.includes("/") || DOTS_ONLY.test(id)) {
		return { path, sessionId: null, notificationId: null };
	}
	return { path: `/session/${escaped}`, sessionId: id, notificationId: null };
}

/** The decoded, re-encodable form of one path segment, or `null` when it is not
 *  one. Shared by both link shapes so the two cannot drift on the guard that
 *  stops a route-building string from smuggling a separator (or a dot segment a
 *  router normalises away) into a destination. */
function segmentOf(raw: string | undefined): string | null {
	if (raw === undefined) return null;
	let id: string;
	try {
		id = decodeURIComponent(raw);
		/* The encode is the second half of the same operation: an unpaired
		 * surrogate decodes cleanly and has no escape, and "never throws" only
		 * holds if both halves are caught. */
		encodeURIComponent(id);
	} catch {
		return null;
	}
	if (id.length === 0 || id.includes("/") || DOTS_ONLY.test(id)) return null;
	return id;
}
