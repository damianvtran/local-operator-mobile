/**
 * The relay's wire semantics: cookies, auth gates, error bodies, SSE framing,
 * and the tunnel gateway's own refusals.
 *
 * Why this is a module and not a few lines inside the server: the point of the
 * mock relay is that the *client's* header, cookie and error logic is exercised
 * rather than bypassed (ADR 0003, "The mock speaks the real wire format"). If
 * the gate, the cookie format or the SSE framing were approximate, a client bug
 * in those paths would pass the harness and fail on a real phone.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { IncomingMessage } from "node:http";

import type { Json } from "../lib/json.ts";

/** A body-carrying refusal a route can send as-is. */
export type Refusal = {
	status: number;
	headers?: Record<string, string>;
	json?: Json;
	body?: string;
	setCookie?: string;
};

/**
 * What the auth gate decides (contract §2): let the request through, or answer
 * it — and the *shape* of the refusal is part of the contract, not a detail. An
 * `/api/` path gets 401 JSON while every other path gets a 303 to the login
 * form, because that is how the app and the portal are told apart.
 */
export type AuthVerdict = { kind: "allow" } | ({ kind: "respond" } & Refusal);

/** What the mutation's origin gate decides (`contract.md` §4). */
export type OriginVerdict = { kind: "allow" } | ({ kind: "respond" } & Refusal);

/** A gateway 503, with the `Retry-After` seconds the contract pins per reason. */
export interface GatewayRefusal extends Refusal {
	retryAfterS: string | undefined;
}

/* ---------------------------------------------------------------- cookies -- */

export const COOKIE_NAME = "lop_mobile";
export const COOKIE_TTL_S = 30 * 24 * 3600;
/** The relay tolerates this much clock skew when reading an expiry. */
const SKEW_S = 60;

/**
 * The relay's cookie key: `sha256("lop-mobile-cookie\0" + password)`.
 * Mirrors `local_operator/mobile/auth.py:459-462`, and deriving it from the
 * password is exactly why rotating the password invalidates every session.
 */
const cookieKey = (password: string): Buffer =>
	createHash("sha256")
		.update(Buffer.from("lop-mobile-cookie\0", "utf8"))
		.update(Buffer.from(password, "utf8"))
		.digest();

/**
 * `<expiry>.<hmac-sha256-hex>` where expiry is when the cookie dies — the
 * integer seconds, signed as its decimal text. `auth.py:466-468`.
 */
export function issueCookie(
	password: string,
	{
		now = Date.now() / 1000,
		ttlS = COOKIE_TTL_S,
	}: { now?: number; ttlS?: number } = {},
): { value: string; expiry: number } {
	const expiry = Math.floor(now + ttlS);
	const sig = createHmac("sha256", cookieKey(password))
		.update(String(expiry))
		.digest("hex");
	return { value: `${expiry}.${sig}`, expiry };
}

/** Constant-time check of a presented cookie, mirroring `verify_cookie`. */
export function verifyCookie(
	value: unknown,
	password: string,
	{ now = Date.now() / 1000 }: { now?: number } = {},
): boolean {
	if (typeof value !== "string") return false;
	const dot = value.lastIndexOf(".");
	if (dot <= 0) return false;
	const expiryText = value.slice(0, dot);
	const sig = value.slice(dot + 1);
	if (!/^\d+$/.test(expiryText) || !/^[0-9a-f]{64}$/.test(sig)) return false;
	const expected = createHmac("sha256", cookieKey(password))
		.update(expiryText)
		.digest("hex");
	const a = Buffer.from(sig, "utf8");
	const b = Buffer.from(expected, "utf8");
	if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
	return Number(expiryText) > now - SKEW_S;
}

/** Read one named cookie from the request cookie header, or undefined. */
export function readCookie(
	header: string | undefined,
	name: string,
): string | undefined {
	if (!header) return undefined;
	let found: string | undefined;
	for (const part of String(header).split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() === name) found = part.slice(eq + 1).trim();
	}
	return found;
}

/** The attributes the relay sets (`daemon.py:3362-3371`); `Secure` only over TLS. */
export function setCookieHeader(
	value: string,
	{
		maxAge = COOKIE_TTL_S,
		secure = false,
	}: { maxAge?: number; secure?: boolean } = {},
): string {
	const parts = [
		`${COOKIE_NAME}=${value}`,
		"HttpOnly",
		`Max-Age=${maxAge}`,
		"Path=/",
		"SameSite=lax",
	];
	if (secure) parts.push("Secure");
	return parts.join("; ");
}

/* ------------------------------------------------------------ auth gates -- */

/**
 * The relay's two-gate split (`daemon.py:3307-3322`): an unauthenticated
 * `/api/*` request is `401` JSON; **any other path** is a `303` to `/login`.
 * A client that has not encoded this treats the HTML login page as a transport
 * bug, which is the single most expensive misreading of this contract.
 */
export function authVerdict(
	pathname: string,
	{ authenticated }: { authenticated: boolean },
): AuthVerdict {
	if (authenticated) return { kind: "allow" };
	if (pathname.startsWith("/api/")) {
		return {
			kind: "respond",
			status: 401,
			json: { error: "authentication required" },
		};
	}
	return {
		kind: "respond",
		status: 303,
		headers: { location: "/login" },
		body: "",
	};
}

/* --------------------------------------------------------- error bodies -- */

/**
 * Errors are `{"error": "<human sentence>"}` — the sentence is the copy a
 * surface shows, and the machine-readable part is the status plus an optional
 * `code` (`contract.md` §2.1). Never parse the sentence to decide.
 */
export const errorBody = (
	sentence: string,
	code?: string,
): { error: string; code?: string } =>
	code === undefined ? { error: sentence } : { error: sentence, code };

/* ---------------------------------------------------------- same origin -- */

/**
 * The relay's CSRF rule on mutations (`contract.md` §1.2): a *foreign* `Origin`
 * is refused; a same-origin `Origin`, or none at all, is allowed — which is
 * what lets a native client and `curl` mutate without inventing one.
 * `allowedOrigins` is empty for a loopback-only mock, so any `Origin` we did
 * not mint is foreign.
 */
export function originVerdict(
	req: IncomingMessage,
	allowedOrigins: string[],
): OriginVerdict {
	const origin = req.headers.origin;
	if (!origin) return { kind: "allow" };
	if (allowedOrigins.some((a) => origin === a)) return { kind: "allow" };
	return {
		kind: "respond",
		status: 403,
		// Served verbatim from `fixtures/relay/http/mutation-cross-origin.json`,
		// whose sentence the contract redacted. Keeping the fixture's own bytes is
		// the only non-invented choice; see docs/e2e/README.md.
		json: { error: "[redacted] request required" },
	};
}

/* ------------------------------------------------------------ SSE frames -- */

/** Relay constant: a `: keepalive` comment after 25 s of quiet (`daemon.py:105`). */
export const SSE_KEEPALIVE_S = 25;
/** The tunnel gateway's stream cap (`gateway.py:34`); the client must treat it as normal. */
export const MAX_STREAM_SECONDS = 60;

/**
 * One SSE frame. The pair is `event:` + `data:` with a blank-line terminator
 * and a single space after each colon — both are real bytes a framer must
 * tolerate (`contract.md` §6.3), and the keep-alive is a bare comment carrying
 * no `event:` name.
 */
export function sseFrame(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The literal keep-alive bytes, byte-identical to `fixtures/relay/sse/sse-keepalive.txt`. */
export const SSE_KEEPALIVE = ": keepalive\n\n";

/** The headers both streams carry (`daemon.py:3503-3512,3534-3538`). */
export const SSE_HEADERS = {
	"content-type": "text/event-stream; charset=utf-8",
	// `no-transform` is what stops an intermediary from recompressing and
	// buffering the stream; `x-accel-buffering: no` is what turns buffering off
	// at nginx-family proxies. Both are required, neither is decorative.
	"cache-control": "no-cache, no-transform",
	"x-accel-buffering": "no",
	connection: "keep-alive",
};

/* ------------------------------------------------------ gateway refusals -- */

/**
 * The tunnel gateway's 503 body (`gateway.py:491-502`):
 * `{"detail": <sentence for a phone>, "reason": <code>, "error": "tunnel authorization unavailable"}`.
 * Only `authorization_deferred` carries `Retry-After: 120` (`gateway.py:504-518`).
 * The `detail` sentences are read from
 * `fixtures/relay/gateway/gateway-refusal-constants.json` at load, never
 * transcribed, so the mock and the gateway cannot drift silently.
 */
export function gatewayUnavailable(
	detail: string,
	reason: string | undefined = undefined,
): GatewayRefusal {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (reason === "authorization_deferred") headers["retry-after"] = "120";
	return {
		status: 503,
		headers,
		json: { detail, reason, error: "tunnel authorization unavailable" },
	};
}

/**
 * The edge worker's own refusals (`tunnel-edge.md` §5.2). Bodies there are
 * `text/plain`, which is the whole reason a client cannot parse an edge failure
 * as JSON — and the 401 is the one that carries the re-auth hint header.
 */
export const EDGE_REFUSALS: Record<
	string,
	{ status: number; text: string; headers?: Record<string, string> }
> = {
	"401-invalid-session": { status: 401, text: "Invalid tunnel session" },
	"401-login-required": {
		status: 401,
		text: "Sign in with Radient to access this tunnel",
		headers: { "x-radient-login": "/_radient/login" },
	},
	"403-same-origin": { status: 403, text: "Same-origin request required" },
	"403-cross-origin": { status: 403, text: "Cross-origin subrequest denied" },
	"404-unknown-tunnel": { status: 404, text: "Unknown tunnel" },
	"413-too-large": { status: 413, text: "Request is too large" },
	"503-auth-unavailable": { status: 503, text: "Authentication unavailable" },
	"503-radient-unavailable": {
		status: 503,
		text: "Radient session unavailable",
	},
	"503-tunnel-unavailable": {
		status: 503,
		text: "Tunnel temporarily unavailable",
	},
	"530-cloudflare-1033": {
		status: 530,
		text: "Error 1033: Argo Tunnel error — no healthy cloudflared instance",
		// Cloudflare's error page is HTML in reality; the status is the signal the
		// app switches on, and the body is deliberately not JSON for the same reason.
		headers: { "content-type": "text/html; charset=utf-8" },
	},
	"502-cloudflare-origin": {
		status: 502,
		text: "Error 502: Unable to reach the origin service",
	},
};

/** Gateway `502`/`404`/`413` shapes that are not the 503 refusal (`tunnel-edge.md` §5.3). */
export const GATEWAY_FAILURES: Record<string, { status: number; json: Json }> =
	{
		"502-relay-down": {
			status: 502,
			json: { error: "local harness unavailable" },
		},
		"502-unsafe-redirect": {
			status: 502,
			json: { error: "unsafe harness redirect" },
		},
		"503-relay-not-installed": {
			status: 503,
			json: { error: "mobile relay is not installed" },
		},
		"404-unknown-host": { status: 404, json: { error: "unknown tunnel host" } },
		"413-too-large": { status: 413, json: { error: "request exceeds 10 MiB" } },
		"400-get-body": {
			status: 400,
			json: { error: "GET/HEAD bodies are not supported" },
		},
	};

/** Gateway constant: bodies above this are refused with a 413 before routing. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** A stable, deterministic id for a synthetic session started by a scenario. */
export const syntheticSessionId = (seed: string): string =>
	createHash("sha256").update(String(seed)).digest("hex").slice(0, 12);
