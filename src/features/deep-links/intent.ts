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

export interface NativeIntent {
	/** What the router should open: the rewritten route, or the original string. */
	path: string;
	/** The session id the link names, or `null` when this was not a session link. */
	sessionId: string | null;
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
	const match = SESSION_LINK.exec(trimmed);
	const raw = match?.[1];
	if (raw === undefined) return { path, sessionId: null };
	let id: string;
	try {
		id = decodeURIComponent(raw);
	} catch {
		/* A lone `%` is not an id; hand the link back whole. */
		return { path, sessionId: null };
	}
	if (id.length === 0 || id.includes("/")) return { path, sessionId: null };
	/* Re-encoded so the id cannot smuggle a path separator into the route it is
	 * interpolated into — the rewrite writes a route, and route building is
	 * string building unless it is escaped. */
	return { path: `/session/${encodeURIComponent(id)}`, sessionId: id };
}
