/**
 * The two routes, as data.
 *
 * A *route* is a connection profile, and per `docs/architecture.md` principle 6
 * the rest of the app does not know which one is active beyond a header policy.
 * Everything route-specific lives here: the shape of the base URL, whether the
 * relay password is involved, how a request authenticates, and how a failure is
 * described to a user.
 *
 * The validations are strict because the two gates in front of the relay are:
 *
 * - **A tunnel hostname is not normalised.** The edge accepts only
 *   `^([a-f0-9]{32})-(lop|oc)$` over https with no port on `.radienthq.com`
 *   (`edge/index.ts:30-37`), so "helpfully" adding `:443` or lower-casing a label
 *   turns a working tunnel into `404 Unknown tunnel`. This module rejects what it
 *   cannot accept verbatim instead of rewriting it.
 * - **Plain http is a deliberate, per-connection decision.** The relay's own docs
 *   assume an identity boundary in front of it, and the relay password rides
 *   this connection, so `http://` is accepted only for a private-network host and
 *   only with the warning acknowledged. The caller renders the warning; this
 *   module is where the rule lives so no screen can quietly skip it.
 */

import type { RequestAuth } from "../relay";

/* Hoisted: a route label is computed for every settings row and every diagnostic. */
const RADIENT_HOST_SUFFIX = /\.radienthq\.com$/;
const SCHEME_PREFIX = /^https?:\/\//;

export const RADIENT_HOST_PATTERN = /^[a-f0-9]{32}-(lop|oc)\.radienthq\.com$/;

/** The edge's cookie names. Both are `__Host-` prefixed, so a re-serialising
 *  client must not add a `Domain` attribute (`tunnel-edge.md` §2.1). */
export const RADIENT_COOKIES = {
	grant: "__Host-radient-grant",
	refresh: "__Host-radient-refresh",
} as const;

/** The Radient personal tunnel route. No relay password exists on this path: the
 *  local gateway injects the relay's own cookie itself. */
export interface RadientRoute {
	mode: "radient";
	/** The tunnel hostname, exactly as Radient issued it. */
	hostname: string;
	/** The control-plane id, needed to re-mint a session and to show a console
	 *  link. */
	tunnelId: string;
}

/** Any URL in front of a relay, with the relay's own password auth. */
export interface CustomRoute {
	mode: "custom";
	/** Origin with no trailing slash, e.g. `https://relay.example.com`. */
	baseUrl: string;
	/** The user has accepted the cleartext warning for a private-network host. */
	allowInsecure: boolean;
}

export type RouteProfile = RadientRoute | CustomRoute;

export interface InvalidRoute {
	ok: false;
	/** A user-facing sentence. Never includes the whole input: it can carry a
	 *  credential in a copy-paste accident. */
	reason: string;
}

export type RouteValidation = { ok: true; route: CustomRoute } | InvalidRoute;

/** Hosts that are private by address or name, where plain http can be a
 *  deliberate choice rather than an exposure. */
const PRIVATE_HOST_PATTERNS = [
	/^localhost$/,
	/^127\./,
	/^10\./,
	/^192\.168\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^169\.254\./,
	/^\[::1\]$/,
	/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT, which Tailscale uses
	/^.+\.local$/,
	/^.+\.ts\.net$/, // Tailscale MagicDNS
];

export function isPrivateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

/**
 * Validates and normalises a custom base URL.
 *
 * Accepts `https://…` always; accepts `http://…` only for a private-network host
 * AND only when `allowInsecure` was passed, which the UI must obtain by showing
 * the warning first. A path is stripped (the relay's routes are absolute), but a
 * scheme, host or port is never rewritten — a proxy that rewrites `Host` already
 * breaks the relay's exact-origin mutation check, and a client that rewrites it
 * would only make that harder to diagnose.
 */
export function validateCustomBaseUrl(
	input: string,
	options: { allowInsecure?: boolean } = {},
): RouteValidation {
	const trimmed = input.trim();
	if (trimmed.length === 0)
		return { ok: false, reason: "Enter the address of your relay." };

	let url: URL;
	try {
		url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
	} catch {
		return {
			ok: false,
			reason:
				"That does not look like an address. It should start with https://.",
		};
	}

	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return { ok: false, reason: "Only https:// addresses are supported." };
	}
	if (url.username || url.password) {
		/* Credentials in a URL end up in a log, a screenshot and a crash report. */
		return {
			ok: false,
			reason: "Remove the username and password from the address.",
		};
	}
	if (url.search || url.hash) {
		return {
			ok: false,
			reason: "Remove the query string and fragment from the address.",
		};
	}

	if (url.protocol === "http:") {
		if (!isPrivateHost(url.hostname)) {
			return {
				ok: false,
				reason:
					"http:// is only allowed for a private address. Use https://, or a private host such as 192.168.x.x.",
			};
		}
		if (options.allowInsecure !== true) {
			return {
				ok: false,
				reason:
					"This address is unencrypted, so the relay password crosses the network in the clear. Turn on the insecure-connection switch to continue.",
			};
		}
	}

	/* The path is dropped: every relay route is absolute, and a user pasting a
	 * deep link to `/login` would otherwise see every call 404. */
	return {
		ok: true,
		route: {
			mode: "custom",
			baseUrl: `${url.origin}`,
			allowInsecure: url.protocol === "http:",
		},
	};
}

/** Validates a Radient tunnel hostname. Accepts only the exact form the edge
 *  serves, because anything else is a `404 Unknown tunnel` the user cannot
 *  diagnose. */
export function validateRadientHostname(
	hostname: string,
	tunnelId: string,
): { ok: true; route: RadientRoute } | InvalidRoute {
	const host = hostname.trim().toLowerCase();
	if (!RADIENT_HOST_PATTERN.test(host)) {
		return {
			ok: false,
			reason:
				"That is not a Radient tunnel address. Use the address the Radient console shows for this computer.",
		};
	}
	if (tunnelId.trim().length === 0) {
		return {
			ok: false,
			reason:
				"This tunnel has no id, so its session cannot be re-minted. Re-run discovery.",
		};
	}
	return {
		ok: true,
		route: { mode: "radient", hostname: host, tunnelId: tunnelId.trim() },
	};
}

/** The relay base URL for a route. */
export function routeBaseUrl(route: RouteProfile): string {
	return route.mode === "radient" ? `https://${route.hostname}` : route.baseUrl;
}

/** The exact `Origin` both gates compare. Sent on every request, not only
 *  mutations: it costs nothing and removes a class of 403s (`ADR 0002` §4). */
export function routeOrigin(route: RouteProfile): string {
	return routeBaseUrl(route);
}

/** The relay password only exists on the custom route. On the Radient route the
 *  gateway injects the relay's cookie itself, so the app must never ask for the
 *  password there — and must never silently fall back to it, which would make the
 *  auth state unverifiable. */
export function requiresRelayPassword(route: RouteProfile): boolean {
	return route.mode === "custom";
}

/** A stable key for "the route I used last", and for per-route caches. It
 *  contains no credential. */
export function routeKey(route: RouteProfile): string {
	return route.mode === "radient"
		? `radient:${route.hostname}`
		: `custom:${route.baseUrl}`;
}

/** A short label for a settings row or a diagnostic line. */
export function routeLabel(route: RouteProfile): string {
	if (route.mode === "radient")
		return route.hostname.replace(RADIENT_HOST_SUFFIX, "");
	return route.baseUrl.replace(SCHEME_PREFIX, "");
}

/**
 * The credential policy a request is built with.
 *
 * Tunnel route: we own the `Cookie` header and the platform jar is off
 * (`credentials: 'omit'`), because the edge strips `lop_mobile` and re-sets only
 * its own `__Host-radient-*` pair — which is why the grant value is read straight
 * out of the secure store instead of a jar.
 *
 * Custom route: the jar owns `lop_mobile` (`credentials: 'include'`), because
 * reading `Set-Cookie` back is the uncertain part on iOS and the jar is the
 * design rather than the fallback.
 */
export function requestAuthFor(
	route: RouteProfile,
	credentials: { grant?: string | null; refresh?: string | null } = {},
): RequestAuth {
	if (route.mode === "custom") {
		/* No cookie header at all: setting one would defeat the jar's bookkeeping,
		 * and a duplicated `lop_mobile` reads as a wrong password. */
		return { cookie: null, origin: routeOrigin(route), credentials: "include" };
	}
	return {
		cookie: radientCookieHeader(credentials.grant, credentials.refresh),
		origin: routeOrigin(route),
		credentials: "omit",
	};
}

/** Builds the `Cookie` header value for the tunnel route. Exported for the smoke
 *  script and for tests, which need to see the exact bytes without holding a
 *  token. */
export function radientCookieHeader(
	grant: string | null | undefined,
	refresh?: string | null,
): string | null {
	const parts: string[] = [];
	if (grant) parts.push(`${RADIENT_COOKIES.grant}=${grant}`);
	if (refresh) parts.push(`${RADIENT_COOKIES.refresh}=${refresh}`);
	return parts.length > 0 ? parts.join("; ") : null;
}

/** True when a route can carry the relay password at all. Named for the check a
 *  screen makes so the reason is written once. */
export function canSendRelayPassword(route: RouteProfile): boolean {
	return route.mode === "custom";
}
