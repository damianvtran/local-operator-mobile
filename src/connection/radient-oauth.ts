/**
 * Radient sign-in: authorization-code + PKCE against the existing `lop` client.
 *
 * Nothing here is new to Radient — the client id, the redirect forms and the
 * scopes all already exist, which is the whole reason `ADR 0002` chose this
 * option: a `lop`-audienced access token is already in the tunnel control plane's
 * audience allow-list, so the SAME token mints tunnel sessions with no server
 * change. The two endpoints are the desktop client's, verbatim
 * (`local_operator/providers/oauth/radient.py:35-37`).
 *
 * The two rules that decide whether this flow works in practice:
 *
 * - **The browser session, not a WebView.** The console signs users in through
 *   Google/Microsoft, which block WebView user agents. This is not a detail that
 *   can be "simplified" later; an embedded renderer must never be put in front of
 *   a credential.
 * - **The listener must be bound before the browser opens and closed on every
 *   exit path** — including cancel and timeout. A listener that outlives the flow
 *   is an open port on the user's device for no reason.
 *
 * The expiry skew is the desktop client's five minutes, which is what keeps a
 * token from expiring mid-request on a slow link.
 */

import { resolveFetch } from "../relay/platform-fetch";
import {
	type AuthBrowserSession,
	type CallbackListener,
	loopbackRedirectUri,
	parseCallbackUrl,
} from "./loopback";
import { type CryptoDeps, createPkcePair, randomState } from "./pkce";

/** The port the desktop client uses, and the one a listener-less platform (iOS,
 *  where the browser session captures the callback itself) advertises. The
 *  redirect must carry an explicit port either way: the console's whitelist and
 *  the control plane's `validOAuthRedirect` both require one. */
export const CALLBACK_PORT = 54_549;

export const RADIENT_OAUTH = {
	clientId: "lop",
	authorizeUrl: "https://console.radienthq.com/oauth/authorize",
	tokenUrl: "https://api.radienthq.com/v1/auth/oauth/token",
	scopes: "openid profile email offline_access",
	/** Applied to `expires_in` when deciding whether an access token is usable. */
	expirySkewMs: 5 * 60 * 1000,
	/** How long the browser sheet may stay open before the attempt is abandoned. */
	browserTimeoutMs: 5 * 60 * 1000,
} as const;

/** What is stored after a successful sign-in. */
export interface RadientTokens {
	access: string;
	refresh: string | null;
	/** Epoch ms, minus the skew — so comparing against `Date.now()` is the whole
	 *  expiry check. */
	expires_at: number;
	scope: string;
	token_type: string;
	/** Shown as the signed-in identity. Only ever a label, and only when the token
	 *  response carried one; no userinfo call is made (the endpoint is unverified). */
	account_label: string | null;
}

export type RadientAuthFailure =
	/** The refresh token is gone, expired or revoked: the user must sign in again. */
	| "invalid_grant"
	/** The server answered with an error we should not retry blindly. */
	| "rejected"
	/** No answer at all. */
	| "network";

export class RadientAuthError extends Error {
	override readonly name = "RadientAuthError";
	readonly failure: RadientAuthFailure;
	readonly status?: number;
	constructor(failure: RadientAuthFailure, message: string, status?: number) {
		super(message);
		this.failure = failure;
		if (status !== undefined) this.status = status;
	}
}

export interface RadientOAuthDeps {
	fetchImpl?: typeof globalThis.fetch;
	now?: () => number;
	crypto?: CryptoDeps;
	/** Overridable so a test can assert the exact URL the console receives. */
	authorizeUrl?: string;
	tokenUrl?: string;
}

/** The authorize URL the system browser opens. Exported so the shape is
 *  assertable without opening a browser. */
export function authorizationUrl(input: {
	redirectUri: string;
	state: string;
	challenge: string;
	authorizeUrl?: string;
	scopes?: string;
}): string {
	const url = new URL(input.authorizeUrl ?? RADIENT_OAUTH.authorizeUrl);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", RADIENT_OAUTH.clientId);
	url.searchParams.set("redirect_uri", input.redirectUri);
	url.searchParams.set("state", input.state);
	url.searchParams.set("code_challenge", input.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("scope", input.scopes ?? RADIENT_OAUTH.scopes);
	return url.toString();
}

interface TokenResponse {
	access_token?: unknown;
	refresh_token?: unknown;
	expires_in?: unknown;
	token_type?: unknown;
	scope?: unknown;
	email?: unknown;
	name?: unknown;
	error?: unknown;
	error_description?: unknown;
}

function tokensFromResponse(
	body: TokenResponse,
	now: () => number,
	previousRefresh: string | null,
): RadientTokens {
	const access = body.access_token;
	if (typeof access !== "string" || access.length === 0) {
		throw new RadientAuthError(
			"rejected",
			"the token response carried no access token",
		);
	}
	const expiresIn =
		typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
			? body.expires_in
			: 3600;
	const refresh =
		typeof body.refresh_token === "string" && body.refresh_token.trim() !== ""
			? body.refresh_token
			: previousRefresh;
	const labelSource =
		typeof body.email === "string"
			? body.email
			: typeof body.name === "string"
				? body.name
				: null;
	return {
		access,
		refresh,
		/* The skew is applied at write time, so every later read is a plain
		 * comparison and there is no second place to get the arithmetic wrong. */
		expires_at: now() + expiresIn * 1000 - RADIENT_OAUTH.expirySkewMs,
		scope: typeof body.scope === "string" ? body.scope : RADIENT_OAUTH.scopes,
		token_type:
			typeof body.token_type === "string" ? body.token_type : "Bearer",
		account_label: labelSource,
	};
}

async function postJson(
	url: string,
	payload: unknown,
	deps: RadientOAuthDeps,
	what: string,
): Promise<TokenResponse> {
	const fetchImpl = resolveFetch(deps.fetchImpl);
	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify(payload),
		});
	} catch {
		throw new RadientAuthError(
			"network",
			`${what} could not reach Radient`,
			undefined,
		);
	}
	let body: TokenResponse = {};
	try {
		/* A boundary cast onto a type whose every field is `unknown`: it asserts only
		 * "this is an object", and `tokensFromResponse` narrows each field it reads
		 * (typeof checks) before using it, so no value is trusted by the cast. */
		body = (await response.json()) as TokenResponse;
	} catch {
		body = {};
	}
	if (!response.ok) {
		const errorCode = typeof body.error === "string" ? body.error : "";
		/* `invalid_grant` is the one failure that means "sign in again": everything
		 * else is worth a retry, or a look at the server's own sentence. */
		const failure: RadientAuthFailure =
			errorCode === "invalid_grant" || response.status === 401
				? "invalid_grant"
				: "rejected";
		const detail =
			typeof body.error_description === "string"
				? body.error_description
				: errorCode || `${what} failed`;
		throw new RadientAuthError(failure, detail, response.status);
	}
	return body;
}

/**
 * Runs one interactive sign-in.
 *
 * Order matters and is deliberate: bind/settle the listener FIRST, then open the
 * browser, then resolve on whichever path delivers the code. The listener is
 * closed in a `finally`, so a cancel, a timeout and a failure all leave no port
 * behind.
 */
export async function signInWithRadient(deps: {
	browser: AuthBrowserSession;
	/** Required where the platform cannot return a callback URL — i.e. Android. */
	listener?: CallbackListener;
	now?: () => number;
	fetchImpl?: typeof globalThis.fetch;
	crypto?: CryptoDeps;
	authorizeUrl?: string;
	tokenUrl?: string;
	/** Fires once the authorize URL is known, so a UI can show "waiting for your
	 *  browser" before the sheet appears. */
	onAuthorizeUrl?: (url: string) => void;
}): Promise<RadientTokens> {
	const now = deps.now ?? (() => Date.now());
	const cryptoDeps = deps.crypto ?? {};
	const state = await randomState(cryptoDeps);
	const pkce = await createPkcePair(cryptoDeps);

	const redirectUri =
		deps.listener?.redirectUri ?? loopbackRedirectUri(CALLBACK_PORT);
	if (!deps.listener && !deps.browser.returnsCallback) {
		/* The platform can neither bind a listener nor hand back the callback URL, so
		 * the code would go nowhere. Failing here beats a browser sheet the user
		 * completes for nothing. */
		throw new RadientAuthError(
			"rejected",
			"this platform cannot capture the OAuth callback: no listener and no browser callback",
		);
	}

	const authorizeUrl = authorizationUrl({
		redirectUri,
		state,
		challenge: pkce.challenge,
		authorizeUrl: deps.authorizeUrl,
	});
	deps.onAuthorizeUrl?.(authorizeUrl);

	/* Started BEFORE the browser opens: a fast callback must not be missed because
	 * nothing was listening yet. */
	const fromListener = deps.listener ? deps.listener.waitForCode() : null;
	try {
		const fromBrowser = await deps.browser.open(authorizeUrl, redirectUri);
		if (fromBrowser) {
			/* iOS: the session matched the callback itself. */
			const result = parseCallbackUrl(fromBrowser, state);
			return await exchangeCode(result.code, redirectUri, pkce.verifier, {
				now,
				fetchImpl: deps.fetchImpl,
				tokenUrl: deps.tokenUrl,
			});
		}
		if (!fromListener) {
			/* The browser closed without a URL and there is nothing listening: the user
			 * dismissed the sheet. This is a cancellation, not an error to retry. */
			throw new RadientAuthError("rejected", "sign-in was cancelled");
		}
		/* Android: the listener collected the code while the tab stayed open, and the
		 * promise settles once the user returns (or the state check fails). */
		const result = await fromListener;
		return await exchangeCode(result.code, redirectUri, pkce.verifier, {
			now,
			fetchImpl: deps.fetchImpl,
			tokenUrl: deps.tokenUrl,
		});
	} finally {
		/* Every exit path, including cancel and timeout: a listener that outlives the
		 * flow is an open port on the user's device. */
		await deps.listener?.close().catch(() => undefined);
		await deps.browser.dismiss().catch(() => undefined);
	}
}

/** Exchanges the authorization code for tokens. Split out so the token handling
 *  is tested without a browser. */
export async function exchangeCode(
	code: string,
	redirectUri: string,
	verifier: string,
	deps: RadientOAuthDeps = {},
): Promise<RadientTokens> {
	const now = deps.now ?? (() => Date.now());
	const body = await postJson(
		deps.tokenUrl ?? RADIENT_OAUTH.tokenUrl,
		{
			grant_type: "authorization_code",
			client_id: RADIENT_OAUTH.clientId,
			code,
			redirect_uri: redirectUri,
			code_verifier: verifier,
		},
		deps,
		"the Radient token exchange",
	);
	return tokensFromResponse(body, now, null);
}

/**
 * Refreshes the access token with the rolling refresh token.
 *
 * Radient rotates the refresh token on every use, so the new one is stored when
 * the response carries it and the previous one is kept when it does not — losing
 * a rotated token would sign the user out on the next refresh.
 */
export async function refreshRadientTokens(
	tokens: RadientTokens,
	deps: RadientOAuthDeps = {},
): Promise<RadientTokens> {
	if (!tokens.refresh) {
		throw new RadientAuthError("invalid_grant", "no refresh token is stored");
	}
	const now = deps.now ?? (() => Date.now());
	const body = await postJson(
		deps.tokenUrl ?? RADIENT_OAUTH.tokenUrl,
		{
			grant_type: "refresh_token",
			client_id: RADIENT_OAUTH.clientId,
			refresh_token: tokens.refresh,
		},
		deps,
		"the Radient token refresh",
	);
	return tokensFromResponse(body, now, tokens.refresh);
}

/**
 * True when the access token needs refreshing before use.
 *
 * `expires_at` already carries the skew, so this is the only expiry comparison in
 * the codebase; a second one beside it is how two screens disagree about whether
 * the user is signed in.
 */
export function accessTokenNeedsRefresh(
	tokens: RadientTokens,
	now: number = Date.now(),
): boolean {
	return tokens.expires_at <= now;
}

/** True when the refresh token itself is gone, which is a sign-in. */
export function isSignedOut(tokens: RadientTokens | null): boolean {
	return tokens === null || tokens.refresh === null;
}
