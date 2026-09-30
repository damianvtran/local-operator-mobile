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
 * | Credential | our own `__Host-radient-*` `Cookie` header | the platform jar's `lop_mobile` |
 * | Jar | `credentials: 'omit'` | `credentials: 'include'` |
 * | `Set-Cookie` | persisted from every response (the edge re-sets both on a transparent refresh) | the jar's business |
 */

import {
	RelayEndpoints,
	RelayHttpClient,
	type RelayResponseFactsWithHeaders,
} from "../relay";
import {
	type CustomRoute,
	RADIENT_COOKIES,
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
	/** Called when the edge hands back refreshed `__Host-radient-*` cookies, so a
	 *  transparent refresh is not thrown away. Never logs the value. */
	onRadientCookies?: (cookies: readonly string[]) => void | Promise<void>;
}

export interface CreateRelayClientOptions extends RouteCredentials {
	route: RouteProfile;
	fetchImpl?: typeof globalThis.fetch;
	timeoutMs?: number;
	/** Called on every response, including failures: the connection state machine
	 *  uses it to see a `401`/`503` even from a request it did not originate. */
	onResponse?: (facts: RelayResponseFactsWithHeaders) => void | Promise<void>;
}

/** Extracts a cookie's value from a `Set-Cookie` pair, by exact name. Used to read
 *  back the edge's refreshed grant and refresh handle. Exported for tests. */
export function cookieValue(pair: string, name: string): string | null {
	const [head] = pair.split(";");
	if (!head) return null;
	const separator = head.indexOf("=");
	if (separator === -1) return null;
	return head.slice(0, separator).trim() === name
		? head.slice(separator + 1).trim()
		: null;
}

/**
 * Reads both of the edge's cookies out of a response's `Set-Cookie` list.
 *
 * Returns only values that were actually present, so a caller can update the
 * stored set without inventing an empty one — the edge re-sets both on a
 * transparent refresh, but a normal response sets neither.
 */
export function radientCookiesFrom(setCookies: readonly string[]): {
	grant?: string;
	refresh?: string;
} {
	const out: { grant?: string; refresh?: string } = {};
	for (const pair of setCookies) {
		const grant = cookieValue(pair, RADIENT_COOKIES.grant);
		if (grant !== null) out.grant = grant;
		const refresh = cookieValue(pair, RADIENT_COOKIES.refresh);
		if (refresh !== null) out.refresh = refresh;
	}
	return out;
}

/** Builds the relay client for a route. */
export function createRelayClient(
	options: CreateRelayClientOptions,
): RelayEndpoints {
	const { route, tunnelSession, onRadientCookies, onResponse } = options;
	const http = new RelayHttpClient({
		baseUrl: routeBaseUrl(route),
		auth: () => {
			const session = tunnelSession?.() ?? null;
			return requestAuthFor(route, {
				grant: session?.grant ?? null,
				refresh: session?.refreshHandle ?? null,
			});
		},
		fetchImpl: options.fetchImpl,
		timeoutMs: options.timeoutMs,
		diagnostic: `relay ${route.mode}`,
		onResponse: async (facts) => {
			if (route.mode === "radient" && facts.setCookies.length > 0) {
				/* Persisting these is what makes the 5-minute grant invisible: the edge
				 * performs a transparent refresh and re-sets both cookies, and a client
				 * that only read them at sign-in would hit a hard 401 five minutes later
				 * (`tunnel-edge.md` §2.1). */
				const next = radientCookiesFrom(facts.setCookies);
				if (next.grant !== undefined || next.refresh !== undefined) {
					/* Re-serialised under their real wire names: `next` keys are a local
					 * shorthand, and a header built from them would carry `grant=` instead of
					 * `__Host-radient-grant=`. */
					const cookies = [
						next.grant !== undefined
							? `${RADIENT_COOKIES.grant}=${next.grant}`
							: null,
						next.refresh !== undefined
							? `${RADIENT_COOKIES.refresh}=${next.refresh}`
							: null,
					].filter((cookie): cookie is string => cookie !== null);
					/* The callback decides what to do; this module deliberately does not
					 * write to storage itself (storage.ts is the only module that does). */
					await onRadientCookies?.(cookies);
				}
			}
			await onResponse?.(facts);
		},
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
 * `POST /login` with a form body, `redirect: 'manual'` and `credentials:
 * 'include'`: the daemon answers `303 → /` with `Set-Cookie` on success and `401`
 * with an HTML page on failure, and there is deliberately no Bearer or Basic
 * alternative — the relay's only credential is that cookie. Following the redirect
 * would be pointless (the app never renders the relay's HTML).
 *
 * The response's `Set-Cookie` is NOT read here; on iOS the platform may keep it out
 * of the visible header dictionary, and the jar is the design rather than the
 * fallback (`ADR 0002` §4, spike S2).
 */
export async function signInToCustomRoute(
	route: CustomRoute,
	password: string,
	options: { fetchImpl?: typeof globalThis.fetch } = {},
): Promise<CustomRouteSignIn> {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const response = await fetchImpl(`${route.baseUrl}/login`, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			accept: "text/html, application/json",
			origin: route.baseUrl,
		},
		body: new URLSearchParams({ password }).toString(),
		/* The jar stores `lop_mobile`; that is the point of this route. */
		credentials: "include",
		redirect: "manual",
		cache: "no-store",
	});
	if (response.status === 303) return { ok: true, signedIn: true };
	return {
		ok: true,
		signedIn: false,
		detail:
			response.status === 401
				? "That password was not accepted."
				: `The relay answered HTTP ${response.status}.`,
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
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	try {
		await fetchImpl(`${route.baseUrl}/logout`, {
			method: "GET",
			headers: { origin: route.baseUrl },
			credentials: "include",
			redirect: "manual",
			cache: "no-store",
		});
	} catch {
		/* A relay that is already gone is a sign-out that already happened. The local
		 * clearing is the caller's next step either way. */
	}
}
