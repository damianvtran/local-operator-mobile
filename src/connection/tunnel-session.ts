/**
 * Tunnel sessions: mint, refresh, re-mint, revoke.
 *
 * The reason this layer exists at all is that a Radient OAuth access token (1 h,
 * refreshable) is already audienced to `lop`, and the tunnel control plane already
 * accepts a `lop` audience — so the app mints its OWN tunnel session against
 * public endpoints with **zero server changes** (`ADR 0002` §3). The desktop
 * client's browser flow is not needed, and its client id is reused as-is.
 *
 * The two-step mint, and what each step guarantees:
 *
 * 1. `POST /v1/tunnels/session/code` (Bearer OAuth token) returns a one-time code
 *    with a 2-minute TTL, bound to the hostname, the challenge and the state. It
 *    is stored hashed and consumed with `FindOneAndDelete`, so a wrong
 *    `code_verifier` BURNS the code — there is no second attempt with it.
 * 2. `POST /v1/tunnels/session/token` (public) exchanges code + verifier for
 *    `{access_token, refresh_token, expires_in: 300, refresh_expires_in}`.
 *
 * Lifecycle, all one policy and therefore all in this file:
 *
 * | Event | Action |
 * | --- | --- |
 * | Grant has < 60 s left | Refresh proactively, SINGLE-FLIGHT, before the next request |
 * | A request returns `401` + `X-Radient-Login` | Refresh once, retry once; a second failure re-mints |
 * | Refresh fails with `invalid_grant` | Re-mint from a fresh OAuth access token |
 * | The refresh handle is > 25 days old | Re-mint silently — it is ABSOLUTE and never rotates, so it cannot be extended |
 * | Any `429` | Exponential backoff with jitter: the session endpoints are per-IP limited, and a stampede takes out refresh for every device behind that address |
 */

import { z } from "zod";
import { resolveFetch } from "../relay/platform-fetch";
import { RADIENT_API_BASE } from "./discovery";
import { type CryptoDeps, createPkcePair, randomState } from "./pkce";
import { RADIENT_COOKIES } from "./profile";

/* Hoisted: a session request is built on every call to the control plane. */
const TRAILING_SLASHES = /\/+$/;
const DELTA_SECONDS = /^\d+$/;

/** The grant's life. `expires_in` from the server is the authority; this is only
 *  the fallback when a response omits it. */
export const GRANT_SECONDS = 300;
/** Refresh this long before the grant dies, so a request in flight never straddles
 *  the boundary. */
export const GRANT_REFRESH_MARGIN_MS = 60_000;
/** The refresh handle's life is ABSOLUTE and it never rotates, which is why
 *  re-minting is the only renewal and why the day-25 job exists. */
export const HANDLE_ABSOLUTE_DAYS = 30;
export const HANDLE_REMINT_AFTER_DAYS = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

const sessionCodeSchema = z.looseObject({
	code: z.string(),
	state: z.string().optional(),
	callback_uri: z.string().optional(),
});

const sessionTokenSchema = z.looseObject({
	access_token: z.string(),
	refresh_token: z.string(),
	token_type: z.string().optional(),
	expires_in: z.number().optional(),
	refresh_expires_in: z.number().optional(),
});

export type TunnelTokens = z.output<typeof sessionTokenSchema>;

/** The session as the app holds it. `mintedAt` is what makes the day-25 re-mint
 *  schedulable without trusting a countdown a device clock can move. */
export interface TunnelSession {
	grant: string;
	grantExpiresAt: number;
	refreshHandle: string;
	refreshExpiresAt: number;
	hostname: string;
	tunnelId: string;
	mintedAt: number;
}

export type TunnelSessionFailure =
	/** 402: this tunnel's billing is inactive, so no session can be minted. */
	| "billing"
	/** 401/403 from the session endpoints: the OAuth token is not accepted. */
	| "oauth"
	/** Any other refusal, carrying the server's sentence. */
	| "rejected"
	/** No answer at all. */
	| "network"
	/** 429: back off, the limiter is per-IP. */
	| "rate-limited";

export class TunnelSessionError extends Error {
	override readonly name = "TunnelSessionError";
	readonly failure: TunnelSessionFailure;
	readonly status?: number;
	/** Set from `Retry-After` when the server sent one. */
	readonly retryAfterMs?: number;
	constructor(
		failure: TunnelSessionFailure,
		message: string,
		status?: number,
		retryAfterMs?: number,
	) {
		super(message);
		this.failure = failure;
		if (status !== undefined) this.status = status;
		if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
	}
}

export interface TunnelSessionDeps {
	fetchImpl?: typeof globalThis.fetch;
	now?: () => number;
	crypto?: CryptoDeps;
	apiBase?: string;
	/** Sleeps for a backoff. Injected so a rate-limit test does not wait. */
	sleep?: (ms: number) => Promise<void>;
	/** Jitter source for the backoff. */
	random?: () => number;
}

function apiUrl(deps: TunnelSessionDeps, path: string): string {
	return `${(deps.apiBase ?? RADIENT_API_BASE).replace(TRAILING_SLASHES, "")}${path}`;
}

function retryAfterFrom(response: Response): number | undefined {
	const raw = response.headers.get("retry-after");
	if (!raw) return undefined;
	const trimmed = raw.trim();
	if (DELTA_SECONDS.test(trimmed)) return Number(trimmed) * 1000;
	const date = Date.parse(trimmed);
	if (Number.isNaN(date)) return undefined;
	return Math.max(0, date - Date.now());
}

/** One POST to the control plane, with every failure mode classified once. */
async function postSession(
	url: string,
	body: unknown,
	what: string,
	deps: TunnelSessionDeps,
	bearer?: string,
): Promise<unknown> {
	const fetchImpl = resolveFetch(deps.fetchImpl);
	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
			},
			body: JSON.stringify(body),
			credentials: "omit",
		});
	} catch {
		throw new TunnelSessionError("network", `${what} could not reach Radient`);
	}

	let parsed: unknown;
	try {
		parsed = await response.json();
	} catch {
		parsed = undefined;
	}

	if (response.status === 429) {
		throw new TunnelSessionError(
			"rate-limited",
			`${what} was rate limited`,
			429,
			retryAfterFrom(response),
		);
	}
	if (response.status === 402) {
		throw new TunnelSessionError(
			"billing",
			"Remote access is not active for this tunnel. Check its billing in the Radient console.",
			402,
		);
	}
	if (response.status === 401 || response.status === 403) {
		throw new TunnelSessionError(
			"oauth",
			`${what} was refused: sign in with Radient again`,
			response.status,
		);
	}
	if (!response.ok) {
		const detail =
			describeEnvelope(parsed) ?? `${what} failed (HTTP ${response.status})`;
		throw new TunnelSessionError("rejected", detail, response.status);
	}
	return parsed;
}

/** The control plane's envelope is `{msg, result}`; the sentence a user can read
 *  is `msg`, and it is sometimes the only explanation for a refusal. */
function describeEnvelope(value: unknown): string | null {
	if (typeof value !== "object" || value === null) return null;
	const msg = (value as { msg?: unknown }).msg;
	return typeof msg === "string" && msg.length > 0 ? msg : null;
}

/** Builds the app's session shape from a token response. `refresh_expires_in` is
 *  the remaining seconds of the 30-day window, so it can be shorter than 30 days
 *  and must be used as given. */
export function sessionFromTokens(
	tokens: TunnelTokens,
	input: { hostname: string; tunnelId: string },
	now: () => number = () => Date.now(),
): TunnelSession {
	const mintedAt = now();
	const grantSeconds = tokens.expires_in ?? GRANT_SECONDS;
	const handleSeconds =
		tokens.refresh_expires_in ?? (HANDLE_ABSOLUTE_DAYS * DAY_MS) / 1000;
	return {
		grant: tokens.access_token,
		grantExpiresAt: mintedAt + grantSeconds * 1000,
		refreshHandle: tokens.refresh_token,
		refreshExpiresAt: mintedAt + handleSeconds * 1000,
		hostname: input.hostname,
		tunnelId: input.tunnelId,
		mintedAt,
	};
}

/**
 * Mints a session: code, then token.
 *
 * The PKCE verifier never leaves this function, and the `state` is checked by the
 * SERVER (`session.go` compares it), which is why a mismatch is a refusal here
 * rather than a silent success.
 */
export async function mintTunnelSession(
	input: { tunnelId: string; hostname: string; oauthAccessToken: string },
	deps: TunnelSessionDeps = {},
): Promise<TunnelSession> {
	const cryptoDeps = deps.crypto ?? {};
	const pkce = await createPkcePair(cryptoDeps);
	const state = await randomState(cryptoDeps);

	const codeBody = await postSession(
		apiUrl(deps, "/v1/tunnels/session/code"),
		{
			tunnel_id: input.tunnelId,
			hostname: input.hostname,
			state,
			code_challenge: pkce.challenge,
			code_challenge_method: "S256",
		},
		"the tunnel session code request",
		deps,
		input.oauthAccessToken,
	);

	const code = sessionCodeSchema.safeParse(codeBody);
	if (!code.success) {
		throw new TunnelSessionError(
			"rejected",
			"Radient returned a session code this app could not read",
		);
	}

	const tokenBody = await postSession(
		apiUrl(deps, "/v1/tunnels/session/token"),
		{
			code: code.data.code,
			code_verifier: pkce.verifier,
			hostname: input.hostname,
		},
		"the tunnel session token exchange",
		deps,
	);

	const tokens = sessionTokenSchema.safeParse(tokenBody);
	if (!tokens.success) {
		throw new TunnelSessionError(
			"rejected",
			"Radient returned session tokens this app could not read",
		);
	}
	return sessionFromTokens(
		tokens.data,
		{ hostname: input.hostname, tunnelId: input.tunnelId },
		deps.now,
	);
}

/**
 * Refreshes the grant.
 *
 * The refresh token that comes back is THE SAME ONE — deliberately not rotated
 * (`session.go:159-183`) — so the handle is carried through unchanged and only the
 * grant and its expiry move.
 */
export async function refreshTunnelSession(
	session: TunnelSession,
	deps: TunnelSessionDeps = {},
): Promise<TunnelSession> {
	const body = await postSession(
		apiUrl(deps, "/v1/tunnels/session/refresh"),
		{ refresh_token: session.refreshHandle, hostname: session.hostname },
		"the tunnel session refresh",
		deps,
	);
	const tokens = sessionTokenSchema.safeParse(body);
	if (!tokens.success) {
		throw new TunnelSessionError(
			"rejected",
			"Radient returned session tokens this app could not read",
		);
	}
	const now = deps.now ?? (() => Date.now());
	const refreshedAt = now();
	return {
		...session,
		grant: tokens.data.access_token,
		grantExpiresAt:
			refreshedAt + (tokens.data.expires_in ?? GRANT_SECONDS) * 1000,
		/* The server's remaining window is authoritative when it sends one; the local
		 * `mintedAt` is never used to extend it. When it is silent, the handle is
		 * the SAME non-rotating one, so its existing absolute expiry still holds —
		 * defaulting to 0 would declare a valid 30-day handle dead and send the user
		 * to sign-in, the exact forced sign-in the day-25 re-mint prevents. */
		refreshExpiresAt:
			tokens.data.refresh_expires_in !== undefined
				? refreshedAt + tokens.data.refresh_expires_in * 1000
				: session.refreshExpiresAt,
	};
}

/**
 * Revokes the session.
 *
 * Through the tunnel first (`POST /_radient/logout`), because that is the path the
 * Worker forwards to the control plane AND the one that deletes the refresh
 * session server-side. If the hostname is gone the Worker 404s on `identity()`, so
 * the direct control-plane route is the fallback — and it is idempotent, answering
 * `200` even when the handle is unknown.
 */
export async function revokeTunnelSession(
	session: TunnelSession,
	deps: TunnelSessionDeps = {},
): Promise<{ revoked: boolean; via: "tunnel" | "control-plane" | "none" }> {
	const fetchImpl = resolveFetch(deps.fetchImpl);
	try {
		const response = await fetchImpl(
			`https://${session.hostname}/_radient/logout`,
			{
				method: "POST",
				headers: {
					accept: "application/json",
					origin: `https://${session.hostname}`,
					cookie: `${RADIENT_COOKIES.refresh}=${session.refreshHandle}`,
				},
				credentials: "omit",
				redirect: "manual",
			},
		);
		if (response.ok || response.status === 303 || response.status === 204) {
			return { revoked: true, via: "tunnel" };
		}
	} catch {
		/* Fall through: a tunnel that cannot be reached still has a server-side
		 * session, and the control-plane route is reachable from anywhere. */
	}

	try {
		await postSession(
			apiUrl(deps, "/v1/tunnels/session/logout"),
			{ refresh_token: session.refreshHandle, hostname: session.hostname },
			"the tunnel session logout",
			deps,
		);
		return { revoked: true, via: "control-plane" };
	} catch {
		/* Logout is best-effort for the LOCAL state: the caller still deletes the
		 * secure-store items, and deleting this device's tokens already ends this
		 * device's access. */
		return { revoked: false, via: "none" };
	}
}

/* ------------------------------------------------------------------ policy */

/** True when the grant should be refreshed before the next request. */
export function grantNeedsRefresh(
	session: TunnelSession,
	now: () => number = () => Date.now(),
): boolean {
	return session.grantExpiresAt - now() <= GRANT_REFRESH_MARGIN_MS;
}

/** True when the handle is old enough that a re-mint must happen in the
 *  background, which is what keeps the 30-day absolute bound invisible. */
export function needsRemint(
	session: TunnelSession,
	now: () => number = () => Date.now(),
): boolean {
	return now() - session.mintedAt >= HANDLE_REMINT_AFTER_DAYS * DAY_MS;
}

/** True when the handle is past its absolute life: only a fresh sign-in plus a
 *  re-mint can help, and the sign-in screen is the correct behaviour. */
export function handleExpired(
	session: TunnelSession,
	now: () => number = () => Date.now(),
): boolean {
	return session.refreshExpiresAt <= now();
}

/**
 * Exponential backoff with jitter for a `429`.
 *
 * The session endpoints are limited to 5/s burst 20 PER IP, so a device behind a
 * shared address must not retry in lockstep with its neighbours; the jitter is
 * what stops a herd from re-forming on every attempt.
 */
export function backoffDelayMs(
	attempt: number,
	random: () => number = Math.random,
): number {
	const base = Math.min(30_000, 500 * 2 ** Math.max(0, attempt));
	return Math.floor(base / 2 + random() * (base / 2));
}

export interface TunnelSessionManagerDeps extends TunnelSessionDeps {
	/** Read the OAuth set, refreshing it first if needed. Returns `null` when the
	 *  user must sign in, which is the one case a re-mint cannot fix. */
	oauthAccessToken: () => Promise<string | null>;
	/** Persist the session. Called after every mutation of it, so a crash mid-flow
	 *  cannot leave the store behind the manager. */
	persist?: (session: TunnelSession) => Promise<void>;
	initial?: TunnelSession | null;
}

/**
 * Owns the current session and the two flows that keep it alive.
 *
 * The single-flight refresh is the point of the class: several screens ask for the
 * grant at once on a cold start, and N concurrent refreshes against a 5/s limiter
 * is the stampede that breaks every device on the address.
 */
export class TunnelSessionManager {
	private session: TunnelSession | null;
	private refreshInFlight: Promise<TunnelSession> | null = null;
	private remintInFlight: Promise<TunnelSession> | null = null;

	private readonly deps: TunnelSessionManagerDeps;

	constructor(deps: TunnelSessionManagerDeps) {
		this.deps = deps;
		this.session = deps.initial ?? null;
	}

	get current(): TunnelSession | null {
		return this.session;
	}

	/** Replaces the session (a fresh sign-in, a stored session restored at cold
	 *  start). */
	async adopt(session: TunnelSession): Promise<void> {
		this.session = session;
		await this.deps.persist?.(session);
	}

	/** Mints from scratch, using a fresh OAuth access token. */
	async mint(input: {
		tunnelId: string;
		hostname: string;
	}): Promise<TunnelSession> {
		const token = await this.deps.oauthAccessToken();
		if (!token)
			throw new TunnelSessionError("oauth", "sign in with Radient again");
		const session = await mintTunnelSession(
			{ ...input, oauthAccessToken: token },
			this.deps,
		);
		await this.adopt(session);
		return session;
	}

	/** Refreshes the grant, single-flight. Concurrent callers await the same
	 *  request rather than each firing their own. */
	async refresh(): Promise<TunnelSession> {
		const current = this.requireSession();
		if (this.refreshInFlight) return this.refreshInFlight;
		this.refreshInFlight = this.runRefresh(current).finally(() => {
			this.refreshInFlight = null;
		});
		return this.refreshInFlight;
	}

	private async runRefresh(current: TunnelSession): Promise<TunnelSession> {
		try {
			const refreshed = await refreshTunnelSession(current, this.deps);
			/* Compare-and-set: `current` was read before the request went out. If a
			 * re-mint (or a fresh sign-in) replaced the session while this refresh
			 * was in flight, adopting the result would resurrect the OLD handle and
			 * its `mintedAt` over the newer session. The newer one wins. */
			if (this.session !== current && this.session !== null) {
				return this.session;
			}
			await this.adopt(refreshed);
			return refreshed;
		} catch (error) {
			if (!(error instanceof TunnelSessionError)) throw error;
			/* `invalid_grant` (which the control plane answers for an empty, unknown,
			 * expired or hostname-mismatched handle) is the one refresh failure a
			 * re-mint can fix. Anything else is reported as-is so the UI can say what
			 * actually happened. */
			if (
				error.failure === "oauth" ||
				error.status === 400 ||
				error.status === 401
			) {
				return await this.remint();
			}
			throw error;
		}
	}

	/**
	 * Re-mints silently, single-flight.
	 *
	 * This is what makes the 30-day absolute handle invisible: past day 25 the
	 * session is replaced before the user can meet its expiry, and only a lapsed
	 * OAuth grant (90 days of no use) reaches the sign-in screen.
	 */
	async remint(): Promise<TunnelSession> {
		const current = this.requireSession();
		if (this.remintInFlight) return this.remintInFlight;
		this.remintInFlight = this.runRemint(current).finally(() => {
			this.remintInFlight = null;
		});
		return this.remintInFlight;
	}

	private async runRemint(current: TunnelSession): Promise<TunnelSession> {
		const token = await this.deps.oauthAccessToken();
		if (!token)
			throw new TunnelSessionError("oauth", "sign in with Radient again");
		const minted = await mintTunnelSession(
			{
				tunnelId: current.tunnelId,
				hostname: current.hostname,
				oauthAccessToken: token,
			},
			this.deps,
		);
		await this.adopt(minted);
		return minted;
	}

	/**
	 * Returns a grant that is valid for at least the refresh margin, refreshing or
	 * re-minting first when required.
	 *
	 * Callers use this instead of reading `current`, so no request can be built from
	 * a grant that is about to expire — which is the shape of the "hard 401 five
	 * minutes later" failure the ADR warns about.
	 */
	async usableSession(): Promise<TunnelSession> {
		let session = this.requireSession();
		if (handleExpired(session, this.deps.now)) {
			throw new TunnelSessionError(
				"oauth",
				"this tunnel session has expired; sign in with Radient again",
			);
		}
		if (needsRemint(session, this.deps.now)) session = await this.remint();
		if (grantNeedsRefresh(session, this.deps.now))
			session = await this.refresh();
		return session;
	}

	/** Revokes and clears. Best-effort server-side, load-bearing locally: the
	 *  caller's next step is deleting the stored items, which is what ends this
	 *  device's access. */
	async revoke(): Promise<{
		revoked: boolean;
		via: "tunnel" | "control-plane" | "none";
	}> {
		const current = this.session;
		this.session = null;
		if (!current) return { revoked: false, via: "none" };
		return await revokeTunnelSession(current, this.deps);
	}

	private requireSession(): TunnelSession {
		if (!this.session) {
			throw new TunnelSessionError(
				"oauth",
				"no tunnel session: mint one before using the relay",
			);
		}
		return this.session;
	}
}
