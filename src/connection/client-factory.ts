/**
 * Route → configured relay client.
 *
 * The factory is where a `RouteProfile` becomes the two things the protocol layer
 * needs: a base URL and a credential policy. Nothing above this file knows which
 * route is active, and nothing below it knows a route exists — which is what
 * makes the relay client testable in Node and the route switchable without
 * touching a screen.
 *
 * The differences between the routes are exactly three, and each is decided here
 * rather than at a call site:
 *
 * | | Radient tunnel | Custom URL |
 * | --- | --- | --- |
 * | Credential | our own `Cookie` header carrying the grant alone | the platform jar's `lop_mobile` |
 * | Jar | `credentials: 'omit'` | `credentials: 'include'` |
 * | `Set-Cookie` | ignored: the app refreshes through the control plane on its own schedule | the jar's business |
 *
 * **The Radient route is native-only, and that is a property of the browser, not a
 * gap here.** `Cookie` and `Origin` are forbidden header names in `fetch`, so a
 * browser drops both silently: the edge receives no grant and no origin and answers
 * a `401` that reads to the user as "the tunnel session expired". No client-side
 * change can fix that — there is no way to set a forbidden header from a page — so
 * the web target is a design/audit surface over the CUSTOM route, and a route
 * picker must not offer Radient there. See `docs/relay-client.md`.
 */

import {
	RelayEndpoints,
	RelayHttpClient,
	type RelayResponseFactsWithHeaders,
} from "../relay";
import {
	type CustomRoute,
	type RouteProfile,
	requestAuthFor,
	routeBaseUrl,
} from "./profile";
import type { TunnelSession } from "./tunnel-session";

/** The credentials a route's requests are built from, resolved per request so a
 *  grant refreshed a moment ago is the one that is used. */
export interface RouteCredentials {
	/** The current tunnel session, or `null` when there is none yet. Read on every
	 *  request, never captured. */
	tunnelSession?: () => TunnelSession | null;
}

export interface CreateRelayClientOptions extends RouteCredentials {
	route: RouteProfile;
	fetchImpl?: typeof globalThis.fetch;
	timeoutMs?: number;
	/** Called on every response, including failures: the connection state machine
	 *  uses it to see a `401`/`503` even from a request it did not originate. */
	onResponse?: (facts: RelayResponseFactsWithHeaders) => void | Promise<void>;
}

/** Builds the relay client for a route. */
export function createRelayClient(
	options: CreateRelayClientOptions,
): RelayEndpoints {
	const { route, tunnelSession, onResponse } = options;
	const http = new RelayHttpClient({
		baseUrl: routeBaseUrl(route),
		/* The grant, and nothing else. The refresh handle is not passed at all: a
		 * client that cannot see it here cannot send it, and the edge's transparent
		 * refresh (which needs it) never switches on. */
		auth: () => requestAuthFor(route, { grant: tunnelSession?.()?.grant }),
		fetchImpl: options.fetchImpl,
		timeoutMs: options.timeoutMs,
		diagnostic: `relay ${route.mode}`,
		/* No `Set-Cookie` handling on either route. On the tunnel route the app owns
		 * its session and ignores whatever the edge tries to set; on the custom route
		 * the platform jar keeps `lop_mobile` and the app never reads it. */
		onResponse,
	});
	return new RelayEndpoints(http);
}

export interface CustomRouteSignIn {
	ok: true;
	/** True when the relay answered 303, which is the only success shape. */
	signedIn: boolean;
	/** The relay's own sentence for a failure, when it gave one. */
	detail?: string;
}

/**
 * Signs in to a custom route.
 *
 * The request is the relay client's (`RelayEndpoints.login`), not a second copy of
 * it: the status a browser hides, the taxonomy's refusal copy and the admission
 * verification are one implementation, in `src/relay/`. A parallel raw-fetch
 * version here would have to re-derive exactly that, and would silently diverge on
 * the web target — which is what this replaced.
 *
 * `CustomRouteSignIn.detail` prefers the taxonomy's sentence (the web path, where
 * the transport shows no status) and falls back to the route's own words for the
 * refusal a caller can see.
 */
export async function signInToCustomRoute(
	route: CustomRoute,
	password: string,
	options: { fetchImpl?: typeof globalThis.fetch } = {},
): Promise<CustomRouteSignIn> {
	const client = createRelayClient({
		route,
		...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
	});
	const outcome = await client.login(password);
	if (outcome.signedIn) return { ok: true, signedIn: true };
	return {
		ok: true,
		signedIn: false,
		detail: outcome.detail ?? "That password was not accepted.",
	};
}

/** Signs out of a custom route, which is the relay's own `/logout`: it is not
 *  auth-gated and does not check CSRF, so a client calling it must expect to be
 *  signed out regardless of the cookie it presented. The app's own private state
 *  (envelopes, projections, credentials) is cleared by its callers, because native
 *  has no `Clear-Site-Data`. */
export async function signOutOfCustomRoute(
	route: CustomRoute,
	options: { fetchImpl?: typeof globalThis.fetch } = {},
): Promise<void> {
	const client = createRelayClient({
		route,
		...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
	});
	try {
		await client.logout();
	} catch {
		/* A relay that is already gone is a sign-out that already happened. The local
		 * clearing is the caller's next step either way. */
	}
}
