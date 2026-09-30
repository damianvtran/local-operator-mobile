// biome-ignore-all lint/performance/useTopLevelRegex: a regex literal inside an
// assertion is not a hot path — there is no per-frame work here to hoist out of.
// biome-ignore-all lint/style/noNonNullAssertion: an assertion after an explicit
// length/definedness check is the guard; a longhand local for it would obscure it.
/**
 * The connection layer: routes, PKCE, the OAuth callback, discovery, the tunnel
 * session lifecycle, the keystore boundary and the client factory.
 *
 * The tests are grouped by the consequence of getting each wrong, because that is
 * how the code is organised: a normalised tunnel hostname is a `404` the user
 * cannot diagnose, a rotated refresh token dropped on the floor is a forced
 * sign-in, a non-single-flight refresh is the stampede that breaks every device
 * behind one IP, and a credential read outside `storage.ts` is the rule the whole
 * directory exists to keep.
 *
 * Everything here runs in Node with injected collaborators, which is the point of
 * the ports (`fetchImpl`, `CryptoDeps`, `SecureStoreAdapter`, `AuthBrowserSession`).
 */

import { describe, expect, it } from "vitest";

import {
	accessTokenNeedsRefresh,
	authorizationUrl,
	base64Url,
	CALLBACK_PORT,
	type CallbackListener,
	createPkcePair,
	discoverComputers,
	exchangeCode,
	grantNeedsRefresh,
	handleExpired,
	isPrivateHost,
	isSignedOut,
	LoopbackUnavailableError,
	loopbackRedirectUri,
	mapStatus,
	memorySecureStore,
	needsRemint,
	parseCallbackUrl,
	RADIENT_COOKIES,
	RADIENT_OAUTH,
	RadientAuthError,
	type RadientTokens,
	radientCookieHeader,
	refreshRadientTokens,
	requestAuthFor,
	requiresRelayPassword,
	routeBaseUrl,
	routeKey,
	routeLabel,
	SecureStorage,
	SecureStorageError,
	signInToCustomRoute,
	signInWithRadient,
	type TunnelSession,
	TunnelSessionManager,
	toComputer,
	validateCustomBaseUrl,
	validateRadientHostname,
} from "../index";

const HOST = `${"a".repeat(32)}-lop.radienthq.com`;
const RADIENT_ROUTE = {
	mode: "radient",
	hostname: HOST,
	tunnelId: "t-1",
} as const;
const CUSTOM_ROUTE = {
	mode: "custom",
	baseUrl: "https://relay.example",
	allowInsecure: false,
} as const;

/* --------------------------------------------------------------- test doubles */

/** Deterministic crypto: a counter-filled byte source and a real SHA-256 (Node's
 *  WebCrypto), so the PKCE pair is reproducible but the digest is genuine. */
let counter = 0;
function fakeCrypto() {
	return {
		randomBytes: (count: number) => {
			counter += 1;
			const out = new Uint8Array(count);
			for (let index = 0; index < count; index += 1)
				out[index] = (index * 31 + counter) % 256;
			return out;
		},
		sha256: async (input: Uint8Array) =>
			new Uint8Array(
				await crypto.subtle.digest("SHA-256", input as unknown as ArrayBuffer),
			),
	};
}

/** Reads a header off a recorded request. A local accessor rather than an optional
 *  chain cast at each site: `(call?.init?.headers as X).y` is exactly the shape
 *  that throws a TypeError instead of failing an assertion. */
function headerOf(
	call: { init?: RequestInit } | undefined,
	name: string,
): string | undefined {
	const headers = call?.init?.headers as Record<string, string> | undefined;
	return headers?.[name];
}

function jsonResponse(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function recordingFetch(
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
	const calls: { url: string; init?: RequestInit; body: unknown }[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		let body: unknown;
		try {
			body = init?.body ? JSON.parse(String(init.body)) : undefined;
		} catch {
			body = String(init?.body ?? "");
		}
		calls.push({ url, init, body });
		return await handler(url, init);
	}) as unknown as typeof globalThis.fetch;
	return { calls, fetchImpl };
}

const TOKENS: RadientTokens = {
	access: "a",
	refresh: "r",
	expires_at: 0,
	scope: RADIENT_OAUTH.scopes,
	token_type: "Bearer",
	account_label: null,
};

/* --------------------------------------------------------------------- routes */

describe("a route is data, and it is validated rather than normalised", () => {
	it("accepts a tunnel hostname only in the exact form the edge serves", () => {
		expect(validateRadientHostname(HOST, "t-1").ok).toBe(true);
		/* A normalising client (adding `:443`, upper-casing a label) turns a working
		 * tunnel into `404 Unknown tunnel`, so these are refusals, not fixes. */
		expect(validateRadientHostname(`${HOST}:443`, "t-1").ok).toBe(false);
		/* Case IS normalised: DNS is case-insensitive and URL parsing lower-cases the
		 * host anyway, so refusing an upper-case paste would reject a working tunnel. */
		expect(validateRadientHostname(HOST.toUpperCase(), "t-1").ok).toBe(true);
		expect(
			validateRadientHostname(`${"a".repeat(32)}-lop.example.com`, "t-1").ok,
		).toBe(false);
		expect(validateRadientHostname(HOST, "  ").ok).toBe(false);
	});

	it("strips a path from a custom URL but never rewrites scheme, host or port", () => {
		const parsed = validateCustomBaseUrl("https://relay.example/internal/");
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.route.baseUrl).toBe("https://relay.example");
		const withPort = validateCustomBaseUrl("https://relay.example:8443");
		if (withPort.ok)
			expect(withPort.route.baseUrl).toBe("https://relay.example:8443");
	});

	it("refuses credentials in a URL, which would end up in a log", () => {
		const parsed = validateCustomBaseUrl("https://user:secret@relay.example");
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.reason).toMatch(/username and password/);
	});

	it("allows plain http only for a private host AND only with the warning acknowledged", () => {
		const insecure = validateCustomBaseUrl("http://192.168.1.4:4098");
		expect(insecure.ok).toBe(false);
		if (!insecure.ok) expect(insecure.reason).toMatch(/unencrypted/);

		const accepted = validateCustomBaseUrl("http://192.168.1.4:4098", {
			allowInsecure: true,
		});
		expect(accepted.ok).toBe(true);
		if (accepted.ok) expect(accepted.route.allowInsecure).toBe(true);

		/* A public name over http is not a deliberate choice, it is an exposure. */
		expect(
			validateCustomBaseUrl("http://relay.example.com", { allowInsecure: true })
				.ok,
		).toBe(false);
	});

	it("knows which addresses are private", () => {
		for (const host of [
			"127.0.0.1",
			"localhost",
			"10.1.2.3",
			"192.168.0.9",
			"172.20.0.1",
			"100.101.102.103",
			"box.ts.net",
			"mac.local",
		]) {
			expect(isPrivateHost(host), host).toBe(true);
		}
		for (const host of ["relay.example.com", "8.8.8.8", "172.32.0.1"]) {
			expect(isPrivateHost(host), host).toBe(false);
		}
	});

	it("derives the origin, key and label without a credential in any of them", () => {
		expect(routeBaseUrl(RADIENT_ROUTE)).toBe(`https://${HOST}`);
		expect(routeKey(RADIENT_ROUTE)).toBe(`radient:${HOST}`);
		expect(routeLabel(RADIENT_ROUTE)).toBe(HOST.replace(".radienthq.com", ""));
		expect(routeLabel(CUSTOM_ROUTE)).toBe("relay.example");
		expect(requiresRelayPassword(RADIENT_ROUTE)).toBe(false);
		expect(requiresRelayPassword(CUSTOM_ROUTE)).toBe(true);
	});

	it("owns the cookie header on the tunnel route and leaves the jar alone on the custom one", () => {
		const tunnel = requestAuthFor(RADIENT_ROUTE, {
			grant: "grant-value",
		});
		expect(tunnel.credentials).toBe("omit");
		expect(tunnel.origin).toBe(`https://${HOST}`);
		expect(tunnel.cookie).toBe(`${RADIENT_COOKIES.grant}=grant-value`);

		const custom = requestAuthFor(CUSTOM_ROUTE, { grant: "never-sent" });
		expect(custom.credentials).toBe("include");
		/* The jar holds `lop_mobile`; setting our own would defeat its bookkeeping. */
		expect(custom.cookie).toBeNull();
		expect(custom.origin).toBe("https://relay.example");
	});

	it("sends no cookie header at all when there is no session", () => {
		expect(requestAuthFor(RADIENT_ROUTE, {}).cookie).toBeNull();
		expect(radientCookieHeader(null)).toBeNull();
		expect(radientCookieHeader("   ")).toBeNull();
		expect(radientCookieHeader("only-grant")).toBe(
			`${RADIENT_COOKIES.grant}=only-grant`,
		);
	});
});

/* ----------------------------------------------------------------------- pkce */

describe("PKCE produces what the two gates demand", () => {
	it("generates a verifier in the accepted alphabet and a 43-character challenge", async () => {
		const pair = await createPkcePair(fakeCrypto());
		expect(pair.method).toBe("S256");
		expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
		expect(pair.verifier.length).toBeLessThanOrEqual(128);
		/* The control plane's rule (`session.go:131`). */
		expect(/^[A-Za-z0-9._~-]{43,128}$/.test(pair.verifier)).toBe(true);
		/* The console's rule: exactly 43 base64url characters. */
		expect(/^[A-Za-z0-9_-]{43}$/.test(pair.challenge)).toBe(true);
	});

	it("computes the challenge as base64url(SHA-256(verifier)), not as a re-encoding", async () => {
		const pair = await createPkcePair(fakeCrypto());
		const digest = new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(pair.verifier),
			),
		);
		expect(pair.challenge).toBe(base64Url(digest));
	});

	it("proves the digest is load-bearing by changing the verifier", async () => {
		counter = 0;
		const first = await createPkcePair(fakeCrypto());
		const second = await createPkcePair(fakeCrypto());
		expect(second.verifier).not.toBe(first.verifier);
		expect(second.challenge).not.toBe(first.challenge);
	});

	it("strips base64 padding, which the console's pattern does not allow", () => {
		expect(base64Url(new Uint8Array([0, 0]))).toBe("AAA");
	});
});

/* ------------------------------------------------------------------ oauth flow */

describe("the OAuth callback is verified wherever it arrives", () => {
	it("reads a code and checks the state", () => {
		expect(
			parseCallbackUrl(
				"http://127.0.0.1:54549/callback?code=abc&state=s1",
				"s1",
			),
		).toEqual({ code: "abc", state: "s1" });
	});

	it("discards a code whose state does not match", () => {
		/* A mismatched state means this code was not produced by our authorization
		 * request: accepting it would sign the user in to somebody else's session. */
		expect(() =>
			parseCallbackUrl(
				"http://127.0.0.1:54549/callback?code=abc&state=other",
				"s1",
			),
		).toThrow(LoopbackUnavailableError);
	});

	it("reports a refusal the console put in the query string", () => {
		expect(() =>
			parseCallbackUrl(
				"http://127.0.0.1:54549/callback?error=access_denied",
				"s1",
			),
		).toThrow(/refused/);
	});

	it("rejects a callback with no code", () => {
		expect(() =>
			parseCallbackUrl("http://127.0.0.1:54549/callback?state=s1", "s1"),
		).toThrow(/no authorization code/);
	});

	it("uses the literal loopback host with an explicit port", () => {
		expect(loopbackRedirectUri(54549)).toBe("http://127.0.0.1:54549/callback");
		expect(CALLBACK_PORT).toBe(54_549);
	});

	it("builds the authorize URL the console's whitelist expects", () => {
		const url = new URL(
			authorizationUrl({
				redirectUri: loopbackRedirectUri(CALLBACK_PORT),
				state: "s1",
				challenge: "c".repeat(43),
			}),
		);
		expect(url.origin).toBe("https://console.radienthq.com");
		expect(url.pathname).toBe("/oauth/authorize");
		expect(url.searchParams.get("client_id")).toBe("lop");
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("redirect_uri")).toBe(
			loopbackRedirectUri(CALLBACK_PORT),
		);
		expect(url.searchParams.get("scope")).toBe(RADIENT_OAUTH.scopes);
	});
});

describe("sign-in hands back tokens, or a cancellation", () => {
	/** A browser session that hands back `url`. `open` receives the authorize URL,
	 *  so a double that needs a valid `state` reads it from there rather than
	 *  inventing one the flow would (correctly) reject. */
	const browserSession = (url: string | null, returnsCallback = true) => ({
		returnsCallback,
		open: async (authorizeUrl: string) => {
			if (url === null) return null;
			const state = new URL(authorizeUrl).searchParams.get("state") ?? "";
			return url.replace("state=S", `state=${state}`);
		},
		dismiss: async () => undefined,
	});

	it("exchanges the code the browser session returned", async () => {
		const { calls, fetchImpl } = recordingFetch(() =>
			jsonResponse({
				access_token: "at",
				refresh_token: "rt",
				expires_in: 3600,
			}),
		);
		const tokens = await signInWithRadient({
			browser: browserSession(
				"http://127.0.0.1:54549/callback?code=c1&state=S",
			),
			fetchImpl,
			crypto: fakeCrypto(),
			now: () => 1_000_000,
		});
		expect(tokens.access).toBe("at");
		const [tokenCall] = calls;
		expect(tokenCall?.url).toBe(RADIENT_OAUTH.tokenUrl);
		if (tokenCall) {
			const body = tokenCall.body as Record<string, string>;
			expect(body.grant_type).toBe("authorization_code");
			expect(body.code).toBe("c1");
			expect(typeof body.code_verifier).toBe("string");
		}
	});

	it("reports a dismissed sheet as a cancellation rather than a network failure", async () => {
		await expect(
			signInWithRadient({
				browser: browserSession(null),
				crypto: fakeCrypto(),
			}),
		).rejects.toBeInstanceOf(RadientAuthError);
	});

	it("refuses a platform that can neither listen nor return the callback", async () => {
		await expect(
			signInWithRadient({
				browser: browserSession(null, false),
				crypto: fakeCrypto(),
			}),
		).rejects.toThrow(/cannot capture the OAuth callback/);
	});

	it("closes the listener on every exit path, including a failure", async () => {
		let closed = 0;
		const listener: CallbackListener = {
			redirectUri: loopbackRedirectUri(12345),
			waitForCode: async () => ({ code: "c1", state: "S" }),
			close: async () => {
				closed += 1;
			},
		};
		/* The exchange fails after the listener has already delivered a code: the
		 * listener must still be closed, because it is closed in a `finally` and not
		 * on the success path only. */
		await expect(
			signInWithRadient({
				browser: browserSession(null, false),
				listener,
				fetchImpl: recordingFetch(() =>
					jsonResponse(
						{ error: "invalid_grant", error_description: "no" },
						400,
					),
				).fetchImpl,
				crypto: fakeCrypto(),
			}),
		).rejects.toBeInstanceOf(RadientAuthError);
		expect(closed).toBe(1);
	});
});

describe("token refresh keeps a rotated refresh token", () => {
	it("stores the new refresh token when the response carries one", async () => {
		const { fetchImpl } = recordingFetch(() =>
			jsonResponse({
				access_token: "at2",
				refresh_token: "rt2",
				expires_in: 3600,
			}),
		);
		const tokens = await refreshRadientTokens(
			{ ...TOKENS, refresh: "rt1" },
			{ fetchImpl, now: () => 0 },
		);
		expect(tokens.refresh).toBe("rt2");
	});

	it("keeps the previous one when it does not, rather than signing the user out", async () => {
		const { fetchImpl } = recordingFetch(() =>
			jsonResponse({ access_token: "at2", expires_in: 3600 }),
		);
		const tokens = await refreshRadientTokens(
			{ ...TOKENS, refresh: "rt1" },
			{ fetchImpl, now: () => 0 },
		);
		expect(tokens.refresh).toBe("rt1");
	});

	it("keeps the working refresh token when the response sends an empty one (HTTP 200)", async () => {
		/* `auth_service.go:752-770` answers 200 with `"refresh_token": ""` when no new
		 * token row was created. Writing that blank over the stored value is a silent
		 * loss of the credential the day-25 re-mint depends on. */
		for (const empty of ["", "   "]) {
			const { fetchImpl } = recordingFetch(() =>
				jsonResponse({
					access_token: "at2",
					refresh_token: empty,
					expires_in: 3600,
				}),
			);
			const tokens = await refreshRadientTokens(
				{ ...TOKENS, refresh: "rt1" },
				{ fetchImpl, now: () => 0 },
			);
			expect(tokens.refresh, JSON.stringify(empty)).toBe("rt1");
		}
	});

	it("classifies invalid_grant as a sign-in and anything else as retryable", async () => {
		const invalidGrant = recordingFetch(() =>
			jsonResponse({ error: "invalid_grant" }, 400),
		).fetchImpl;
		await expect(
			refreshRadientTokens(
				{ ...TOKENS, refresh: "rt1" },
				{ fetchImpl: invalidGrant },
			),
		).rejects.toMatchObject({
			failure: "invalid_grant",
		});
		const serverError = recordingFetch(() =>
			jsonResponse({ error: "server_error" }, 500),
		).fetchImpl;
		await expect(
			refreshRadientTokens(
				{ ...TOKENS, refresh: "rt1" },
				{ fetchImpl: serverError },
			),
		).rejects.toMatchObject({
			failure: "rejected",
		});
	});

	it("applies the expiry skew at write time, so the check has one arithmetic", () => {
		const tokens = { ...TOKENS, expires_at: 500, refresh: "r" };
		expect(accessTokenNeedsRefresh(tokens, 499)).toBe(false);
		expect(accessTokenNeedsRefresh(tokens, 500)).toBe(true);
		expect(isSignedOut(tokens)).toBe(false);
		expect(isSignedOut({ ...tokens, refresh: null })).toBe(true);
	});
});

describe("the token exchange itself", () => {
	it("reports a missing access token instead of storing nothing", async () => {
		const { fetchImpl } = recordingFetch(() =>
			jsonResponse({ token_type: "Bearer" }),
		);
		await expect(
			exchangeCode("c", "http://127.0.0.1/callback", "v", { fetchImpl }),
		).rejects.toThrow(/no access token/);
	});

	it("treats a network failure as its own failure kind", async () => {
		const fetchImpl = (async () => {
			throw new Error("ENOTFOUND");
		}) as unknown as typeof globalThis.fetch;
		await expect(
			exchangeCode("c", "u", "v", { fetchImpl }),
		).rejects.toMatchObject({ failure: "network" });
	});
});

/* ------------------------------------------------------------------- discovery */

describe("discovery turns tunnels into computers, honestly", () => {
	const tunnel = (overrides: Record<string, unknown> = {}) => ({
		id: "t-1",
		name: "laptop",
		device_id: "d-1",
		hostname: HOST,
		status: "active",
		harnesses: [{ id: "local-operator", enabled: true, hostname: HOST }],
		updated_at: "2026-09-29T10:00:00Z",
		...overrides,
	});

	it("reads the envelope's result and maps the status vocabulary", async () => {
		const { fetchImpl } = recordingFetch(() =>
			jsonResponse({ msg: "ok", result: [tunnel()] }),
		);
		const result = await discoverComputers({
			accessToken: () => "at",
			fetchImpl,
		});
		expect(result.kind).toBe("computers");
		if (result.kind !== "computers") return;
		expect(result.computers[0]?.status).toBe("ready");
		expect(result.computers[0]?.supportsLocalOperator).toBe(true);
	});

	it("sends a bearer token and no cookies, because this host is not the tunnel", async () => {
		const { calls, fetchImpl } = recordingFetch(() =>
			jsonResponse({ msg: "ok", result: [] }),
		);
		await discoverComputers({ accessToken: () => "at", fetchImpl });
		const [call] = calls;
		expect(call?.url).toBe("https://api.radienthq.com/v1/tunnels");
		expect(headerOf(call, "authorization")).toBe("Bearer at");
		expect(call?.init?.credentials).toBe("omit");
	});

	it("distinguishes an empty account from a failure", async () => {
		const empty = await discoverComputers({
			accessToken: () => "at",
			fetchImpl: recordingFetch(() => jsonResponse({ msg: "ok", result: [] }))
				.fetchImpl,
		});
		expect(empty.kind).toBe("none");
		const unreachable = await discoverComputers({
			accessToken: () => "at",
			fetchImpl: (async () => {
				throw new Error("offline");
			}) as unknown as typeof globalThis.fetch,
		});
		expect(unreachable.kind).toBe("unreachable");
	});

	it("treats a 401 as a sign-in, and an unknown shape as a version problem rather than an empty account", async () => {
		expect(
			(
				await discoverComputers({
					accessToken: () => "at",
					fetchImpl: recordingFetch(() => jsonResponse({ msg: "no" }, 401))
						.fetchImpl,
				})
			).kind,
		).toBe("unauthorized");
		const badShape = await discoverComputers({
			accessToken: () => "at",
			fetchImpl: recordingFetch(() =>
				jsonResponse({ msg: "ok", result: { nope: true } }),
			).fetchImpl,
		});
		expect(badShape.kind).toBe("rejected");
	});

	it("reports a missing token without a request", async () => {
		const { calls, fetchImpl } = recordingFetch(() => jsonResponse({}));
		expect(
			(await discoverComputers({ accessToken: () => null, fetchImpl })).kind,
		).toBe("unauthorized");
		expect(calls).toHaveLength(0);
	});

	it("selects the Local Operator harness exactly, and shows a non-target as such", () => {
		const target = toComputer(tunnel() as never);
		expect(target.hostname).toBe(HOST);
		const opencodeOnly = toComputer(
			tunnel({ harnesses: [{ id: "opencode", enabled: true }] }) as never,
		);
		expect(opencodeOnly.supportsLocalOperator).toBe(false);
		const disabled = toComputer(
			tunnel({
				harnesses: [{ id: "local-operator", enabled: false }],
			}) as never,
		);
		expect(disabled.supportsLocalOperator).toBe(false);
	});

	it("keeps an absent billing object as unknown, never as ineligible", () => {
		const computer = toComputer(tunnel() as never);
		expect(computer.billing.eligible).toBeNull();
		const ineligible = toComputer(
			tunnel({
				billing: { eligible: false, quote: "Add a payment method." },
			}) as never,
		);
		expect(ineligible.billing.eligible).toBe(false);
		expect(ineligible.billing.message).toBe("Add a payment method.");
	});

	it("maps every status the console can report", () => {
		expect(mapStatus("active")).toBe("ready");
		expect(mapStatus("disabled")).toBe("off");
		expect(mapStatus("suspended")).toBe("suspended");
		expect(mapStatus("pending")).toBe("provisioning");
		expect(mapStatus("reconciling")).toBe("provisioning");
		expect(mapStatus("revoking")).toBe("gone");
		expect(mapStatus("deleted")).toBe("gone");
		expect(mapStatus(undefined)).toBe("unknown");
	});
});

/* --------------------------------------------------------------- tunnel session */

describe("the tunnel session lifecycle", () => {
	function session(overrides: Partial<TunnelSession> = {}): TunnelSession {
		return {
			grant: "g",
			grantExpiresAt: 1_000_000,
			refreshHandle: "h",
			refreshExpiresAt: 1_000_000_000,
			hostname: HOST,
			tunnelId: "t-1",
			mintedAt: 0,
			...overrides,
		};
	}

	const mintHandler = () => (url: string) =>
		url.includes("/session/code")
			? jsonResponse({ code: "one-time", state: "s", callback_uri: `${url}` })
			: jsonResponse({
					access_token: "grant",
					refresh_token: "handle",
					expires_in: 300,
					refresh_expires_in: 2_500_000,
				});

	it("mints with a challenge and exchanges it with the verifier", async () => {
		const { calls, fetchImpl } = recordingFetch(mintHandler());
		const manager = new TunnelSessionManager({
			fetchImpl,
			now: () => 5_000,
			crypto: fakeCrypto(),
			oauthAccessToken: async () => "oat",
		});
		const minted = await manager.mint({ tunnelId: "t-1", hostname: HOST });
		expect(calls).toHaveLength(2);
		const codeBody = calls[0]?.body as Record<string, string>;
		expect(codeBody.tunnel_id).toBe("t-1");
		expect(codeBody.hostname).toBe(HOST);
		expect(codeBody.code_challenge_method).toBe("S256");
		expect((codeBody.code_challenge ?? "").length).toBe(43);
		expect(headerOf(calls[0], "authorization")).toBe("Bearer oat");
		const tokenBody = calls[1]?.body as Record<string, string>;
		expect(tokenBody.code).toBe("one-time");
		expect(typeof tokenBody.code_verifier).toBe("string");
		expect(minted.grant).toBe("grant");
		expect(minted.refreshHandle).toBe("handle");
		expect(manager.current?.grant).toBe("grant");
	});

	it("refuses to mint without an OAuth token, rather than sending a blank bearer", async () => {
		const { calls, fetchImpl } = recordingFetch(mintHandler());
		const manager = new TunnelSessionManager({
			fetchImpl,
			crypto: fakeCrypto(),
			oauthAccessToken: async () => null,
		});
		await expect(
			manager.mint({ tunnelId: "t-1", hostname: HOST }),
		).rejects.toMatchObject({ failure: "oauth" });
		expect(calls).toHaveLength(0);
	});

	it("maps a 402 to billing, which is what it means", async () => {
		const { fetchImpl } = recordingFetch(() =>
			jsonResponse({ msg: "tunnel billing is inactive" }, 402),
		);
		const manager = new TunnelSessionManager({
			fetchImpl,
			crypto: fakeCrypto(),
			oauthAccessToken: async () => "oat",
		});
		await expect(
			manager.mint({ tunnelId: "t-1", hostname: HOST }),
		).rejects.toMatchObject({ failure: "billing", status: 402 });
	});

	it("keeps the handle's existing expiry when a refresh response omits it", async () => {
		/* The handle is non-rotating and absolute, so a silent response changes
		 * nothing about it. Defaulting to 0 declared a valid 30-day handle dead and
		 * sent the user to sign-in. */
		const { fetchImpl } = recordingFetch(() =>
			jsonResponse({
				access_token: "grant2",
				refresh_token: "handle",
				expires_in: 300,
			}),
		);
		const original = session({ refreshExpiresAt: 2_000_000_000 });
		const manager = new TunnelSessionManager({
			fetchImpl,
			now: () => 999_000,
			crypto: fakeCrypto(),
			oauthAccessToken: async () => "oat",
			initial: original,
		});
		const refreshed = await manager.refresh();
		expect(refreshed.refreshExpiresAt).toBe(2_000_000_000);
		expect(handleExpired(refreshed, () => 999_000)).toBe(false);
	});

	it("does not let a refresh that started before a re-mint overwrite the newer session", async () => {
		let releaseRefresh: (() => void) | undefined;
		const refreshGate = new Promise<void>((resolve) => {
			releaseRefresh = resolve;
		});
		const { fetchImpl } = recordingFetch(async (url) => {
			if (url.includes("/session/refresh")) {
				await refreshGate;
				return jsonResponse({
					access_token: "stale-grant",
					refresh_token: "old-handle",
					expires_in: 300,
				});
			}
			if (url.includes("/session/code")) {
				return jsonResponse({
					code: "one-time",
					state: "s",
					callback_uri: url,
				});
			}
			return jsonResponse({
				access_token: "new-grant",
				refresh_token: "new-handle",
				expires_in: 300,
				refresh_expires_in: 2_500_000,
			});
		});
		const manager = new TunnelSessionManager({
			fetchImpl,
			now: () => 5_000,
			crypto: fakeCrypto(),
			oauthAccessToken: async () => "oat",
			initial: session({ refreshHandle: "old-handle" }),
		});
		const inFlight = manager.refresh();
		/* The refresh request is now parked at the server. A re-mint lands first. */
		await manager.remint();
		expect(manager.current?.refreshHandle).toBe("new-handle");
		releaseRefresh?.();
		const result = await inFlight;
		expect(result.refreshHandle).toBe("new-handle");
		expect(manager.current?.grant).toBe("new-grant");
		expect(manager.current?.refreshHandle).toBe("new-handle");
	});

	it("single-flights concurrent refreshes, so a cold start does not stampede a 5/s limiter", async () => {
		let refreshes = 0;
		const { fetchImpl } = recordingFetch((url) => {
			if (url.includes("/session/refresh")) {
				refreshes += 1;
				return jsonResponse({
					access_token: "grant2",
					refresh_token: "handle",
					expires_in: 300,
				});
			}
			return jsonResponse({});
		});
		const manager = new TunnelSessionManager({
			fetchImpl,
			now: () => 999_000,
			crypto: fakeCrypto(),
			oauthAccessToken: async () => "oat",
			initial: session(),
		});
		const [a, b, c] = await Promise.all([
			manager.refresh(),
			manager.refresh(),
			manager.refresh(),
		]);
		expect(refreshes).toBe(1);
		expect(a.grant).toBe("grant2");
		expect(b.grant).toBe("grant2");
		expect(c.grant).toBe("grant2");
	});

	it("re-mints when the refresh handle is refused, which is the only thing that can fix it", async () => {
		const seen: string[] = [];
		const { fetchImpl } = recordingFetch((url) => {
			seen.push(url);
			if (url.includes("/session/refresh"))
				return jsonResponse({ error: "invalid_grant" }, 400);
			if (url.includes("/session/code")) return jsonResponse({ code: "c" });
			return jsonResponse({
				access_token: "fresh",
				refresh_token: "fresh-handle",
				expires_in: 300,
			});
		});
		const manager = new TunnelSessionManager({
			fetchImpl,
			now: () => 0,
			crypto: fakeCrypto(),
			oauthAccessToken: async () => "oat",
			initial: session(),
		});
		const refreshed = await manager.refresh();
		expect(refreshed.grant).toBe("fresh");
		expect(seen.some((url) => url.includes("/session/code"))).toBe(true);
	});

	it("revokes through the tunnel first, and falls back to the control plane when the hostname is gone", async () => {
		const tunnelFirst = recordingFetch((url) =>
			url.includes("/_radient/logout")
				? jsonResponse({}, 200)
				: jsonResponse({}, 404, { "content-type": "text/plain" }),
		);
		const viaTunnel = await new TunnelSessionManager({
			fetchImpl: tunnelFirst.fetchImpl,
			oauthAccessToken: async () => "oat",
			initial: session(),
		}).revoke();
		expect(viaTunnel.via).toBe("tunnel");
		expect(tunnelFirst.calls[0]?.url).toBe(`https://${HOST}/_radient/logout`);

		const fallback = recordingFetch((url) =>
			url.includes("/_radient/logout")
				? new Response("nope", { status: 404 })
				: jsonResponse({}, 200),
		);
		const viaControlPlane = await new TunnelSessionManager({
			fetchImpl: fallback.fetchImpl,
			oauthAccessToken: async () => "oat",
			initial: session(),
		}).revoke();
		expect(viaControlPlane.via).toBe("control-plane");
		expect(fallback.calls).toHaveLength(2);
	});

	it("re-mints after day 25 and refuses once the handle is past day 30", () => {
		const day = 24 * 60 * 60 * 1000;
		const fresh = session({ mintedAt: 0, refreshExpiresAt: 30 * day });
		expect(needsRemint(fresh, () => 24 * day)).toBe(false);
		expect(needsRemint(fresh, () => 25 * day)).toBe(true);
		expect(handleExpired(fresh, () => 30 * day)).toBe(true);

		/* Within the margin of its expiry, a grant is refreshed before the next
		 * request — which is what makes the 5-minute life invisible. */
		expect(
			grantNeedsRefresh(session({ grantExpiresAt: 100_000 }), () => 50_000),
		).toBe(true);
		/* 70 s of life is outside the 60 s margin, so no refresh is owed yet. */
		expect(
			grantNeedsRefresh(session({ grantExpiresAt: 100_000 }), () => 30_000),
		).toBe(false);
	});
});

/* -------------------------------------------------------------------- storage */

describe("the keystore boundary", () => {
	const oauth = {
		access: "at",
		refresh: "rt",
		expires_at: 1_000,
		account_label: null,
		scope: "s",
		token_type: "Bearer",
	};
	const tunnel = {
		grant: "g",
		grant_expires_at: 1_000,
		refresh_handle: "h",
		refresh_expires_at: 2_000,
		hostname: HOST,
		tunnel_id: "t-1",
		minted_at: 0,
	};

	it("round-trips each concern as its own item", async () => {
		const adapter = memorySecureStore();
		const storage = new SecureStorage(adapter, { now: () => 500 });
		await storage.writeOauth(oauth);
		await storage.writeTunnelSession(tunnel);
		expect((await storage.readOauth())?.access).toBe("at");
		expect((await storage.readTunnelSession())?.refresh_handle).toBe("h");
		/* One item per concern: a corrupt blob must cost one credential, not all. */
		expect(adapter.items.size).toBe(2);
	});

	it("refuses a value the platform would reject, rather than failing at the worst moment", async () => {
		const storage = new SecureStorage(memorySecureStore());
		await expect(
			storage.writeOauth({ ...oauth, access: "x".repeat(4_000) }),
		).rejects.toBeInstanceOf(SecureStorageError);
	});

	it("treats a corrupt item as absent AND deletes it, so it cannot fail twice", async () => {
		const adapter = memorySecureStore({ "lop.mobile.oauth": "{not json" });
		const storage = new SecureStorage(adapter);
		expect(await storage.readOauth()).toBeNull();
		expect(adapter.items.has("lop.mobile.oauth")).toBe(false);
	});

	it("reports presence, and how long each credential has left", async () => {
		const adapter = memorySecureStore();
		const storage = new SecureStorage(adapter, { now: () => 900 });
		await storage.writeOauth(oauth);
		const presence = await storage.presence();
		expect(presence.oauth).toBe(true);
		expect(presence.oauthExpiresInMs).toBe(100);
		expect(presence.tunnel).toBe(false);
		expect(presence.remembersPassword).toBe(false);
	});

	it("clears everything on sign-out", async () => {
		const adapter = memorySecureStore();
		const storage = new SecureStorage(adapter);
		await storage.writeOauth(oauth);
		await storage.writeTunnelSession(tunnel);
		await storage.writeCustomRoute({
			base_url: "https://relay.example",
			password: "kept",
			allow_insecure: false,
		});
		await storage.clearAll();
		expect(adapter.items.size).toBe(0);
	});
});

/* ------------------------------------------------------------- client factory */

describe("the client factory wires a route to its credentials", () => {
	it("signs in to a custom route only on a 303", async () => {
		const ok = recordingFetch(() => new Response("", { status: 303 }));
		const signedIn = await signInToCustomRoute(CUSTOM_ROUTE, "hunter2", {
			fetchImpl: ok.fetchImpl,
		});
		expect(signedIn.signedIn).toBe(true);
		const body = String(ok.calls[0]?.init?.body ?? "");
		/* A form body, because the relay's login route reads nothing else. */
		expect(body).toBe(
			`password=${encodeURIComponent("hunter2").replace(/%20/g, "+")}`,
		);
		expect(headerOf(ok.calls[0], "origin")).toBe("https://relay.example");
		expect(ok.calls[0]?.init?.credentials).toBe("include");

		const refused = recordingFetch(
			() => new Response("<html>bad password</html>", { status: 401 }),
		);
		const denied = await signInToCustomRoute(CUSTOM_ROUTE, "wrong", {
			fetchImpl: refused.fetchImpl,
		});
		expect(denied.signedIn).toBe(false);
		expect(denied.detail).toMatch(/not accepted/);
	});
});
