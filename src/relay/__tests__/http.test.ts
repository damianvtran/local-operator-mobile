// biome-ignore-all lint/performance/useTopLevelRegex: a regex literal inside an
// assertion is not a hot path — there is no per-frame work here to hoist out of.
// biome-ignore-all lint/style/noNonNullAssertion: an assertion after an explicit
// length/definedness check is the guard; a longhand local for it would obscure it.
/**
 * The HTTP layer's contract: what goes out on the wire, and how what comes back
 * becomes a decision.
 *
 * Every assertion here corresponds to a documented trap — the cookie policy that
 * differs per route, the `Origin` that both gates compare exactly, the
 * `Sec-Fetch-*` headers a native client must never claim, the 303 that must not
 * be followed, the `Set-Cookie` from *every* response that the edge relies on,
 * and the `no-store` the relay does not set for itself. The failures they guard
 * against are the ones that do not reproduce locally: they need a real tunnel,
 * a real five-minute grant, or a proxy that rewrites `Host`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	RelayError,
	RelayHttpClient,
	type RelayRequest,
	type RequestAuth,
	readSetCookies,
	splitCombinedSetCookie,
} from "../index";

const FIXTURE_ROOT = fileURLToPath(
	new URL("../../../fixtures/relay", import.meta.url),
);

const TUNNEL_ORIGIN =
	"https://aaaaaaaabbbbbbbbccccccccdddddddd-lop.radienthq.com";

/** The tunnel route's policy: we own the cookie header, the platform jar is off,
 *  and the origin is the tunnel's own origin (which is what both gates compare). */
const tunnelAuth: RequestAuth = {
	cookie: "__Host-radient-grant=header.payload.signature",
	origin: TUNNEL_ORIGIN,
	credentials: "omit",
};

/** The custom route's policy: the relay's cookie lives in the platform jar. */
const customAuth: RequestAuth = {
	cookie: null,
	origin: "https://relay.example.internal",
	credentials: "include",
};

interface Captured {
	url: string;
	init: RequestInit & { headers: Record<string, string> };
	headerNames: string[];
}

function captureFetch(
	responder: (request: Captured) => Response | Promise<Response>,
) {
	const calls: Captured[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const headers = (init?.headers ?? {}) as Record<string, string>;
		const captured: Captured = {
			url: String(input),
			init: { ...(init ?? {}), headers },
			headerNames: Object.keys(headers).map((name) => name.toLowerCase()),
		};
		calls.push(captured);
		return await responder(captured);
	}) as unknown as typeof globalThis.fetch;
	return { calls, fetchImpl };
}

function client(
	fetchImpl: typeof globalThis.fetch,
	overrides: Partial<ConstructorParameters<typeof RelayHttpClient>[0]> = {},
) {
	return new RelayHttpClient({
		baseUrl: TUNNEL_ORIGIN,
		auth: () => tunnelAuth,
		fetchImpl,
		...overrides,
	});
}

function json(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(status === 204 ? null : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

describe("the header contract", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("sends our own Cookie and the tunnel origin, and nothing a browser would claim", async () => {
		const { calls, fetchImpl } = captureFetch(() =>
			json({ ok: true, version: 5, sessions: 0, dist: false }),
		);
		await client(fetchImpl).json("healthz", {
			method: "GET",
			path: "/healthz",
		});

		const [call] = calls;
		expect(call?.init.headers.cookie).toBe(tunnelAuth.cookie);
		expect(call?.init.headers.origin).toBe(TUNNEL_ORIGIN);
		expect(call?.init.credentials).toBe("omit");
		/* `Sec-Fetch-Site: cross-site|same-site` is rejected at the edge unless it is
		 * a navigation, and a native client has no fetch metadata to declare. */
		expect(call?.headerNames.some((name) => name.startsWith("sec-fetch"))).toBe(
			false,
		);
		/* `Authorization` is deleted by the edge; sending it only muddies diagnostics. */
		expect(call?.headerNames).not.toContain("authorization");
		expect(
			call?.headerNames.some((name) => name.startsWith("x-forwarded")),
		).toBe(false);
	});

	it("never follows a redirect, and never lets anything cache a JSON body", async () => {
		const { calls, fetchImpl } = captureFetch(() =>
			json({ ok: true, version: 5, sessions: 0, dist: false }),
		);
		await client(fetchImpl).json("healthz", {
			method: "GET",
			path: "/healthz",
		});
		expect(calls[0]?.init.redirect).toBe("manual");
		/* `secure_cookie()` is dead code in the relay, so JSON API responses carry no
		 * `Cache-Control` at all — the policy has to be ours. */
		expect(calls[0]?.init.cache).toBe("no-store");
	});

	it("sets a JSON content type only when there is a body", async () => {
		const { calls, fetchImpl } = captureFetch((request) =>
			request.url.endsWith("/pin")
				? json({ ok: true, pinned: true })
				: json({ ok: true, version: 5, sessions: 0, dist: false }),
		);
		const http = client(fetchImpl);
		await http.json("healthz", { method: "GET", path: "/healthz" });
		await http.json("pin", {
			method: "POST",
			path: "/api/sessions/x/pin",
			body: { pinned: true },
		});
		expect(calls[0]?.init.headers["content-type"]).toBeUndefined();
		expect(calls[1]?.init.headers["content-type"]).toBe("application/json");
		expect(calls[1]?.init.body).toBe('{"pinned":true}');
	});

	it("posts the login form the way the relay parses it", async () => {
		const { calls, fetchImpl } = captureFetch(
			() => new Response("", { status: 303 }),
		);
		await client(fetchImpl, { auth: () => customAuth }).raw({
			method: "POST",
			path: "/login",
			form: { password: "hunter2 with spaces & symbols" },
			/* A 303 is this route's success, so it must not be classified as a failure. */
			accept: [303],
		});
		expect(calls[0]?.init.headers["content-type"]).toBe(
			"application/x-www-form-urlencoded",
		);
		/* URLSearchParams escaping, not string interpolation: a password with `&` or a
		 * space must survive the round trip. */
		expect(calls[0]?.init.body).toBe(
			"password=hunter2+with+spaces+%26+symbols",
		);
		expect(calls[0]?.init.credentials).toBe("include");
	});

	it("lets the jar own the relay cookie on the custom route", async () => {
		const { calls, fetchImpl } = captureFetch(() =>
			json({ ok: true, version: 5, sessions: 0, dist: false }),
		);
		await client(fetchImpl, { auth: () => customAuth }).json("healthz", {
			method: "GET",
			path: "/healthz",
		});
		expect(calls[0]?.headerNames).not.toContain("cookie");
		expect(calls[0]?.init.credentials).toBe("include");
	});

	it("resolves an absolute URL for the owner API without the relay's base", async () => {
		/* The owner API's envelope is `{msg, result}`, which is not a relay payload
		 * this build has a schema for yet; the assertions here are about the URL and
		 * the headers, so the body is the probe's. */
		const { calls, fetchImpl } = captureFetch(() =>
			json({ ok: true, version: 5, sessions: 0, dist: false }),
		);
		await client(fetchImpl).json("healthz", {
			method: "GET",
			path: "",
			absoluteUrl: "https://api.radienthq.com/v1/tunnels",
			headers: { authorization: "Bearer owner-token" },
		});
		expect(calls[0]?.url).toBe("https://api.radienthq.com/v1/tunnels");
		expect(calls[0]?.init.headers.authorization).toBe("Bearer owner-token");
	});
});

describe("statuses become typed errors", () => {
	it("classifies the edge's plain-text 503 as the computer being offline", async () => {
		const { fetchImpl } = captureFetch(
			() =>
				new Response("Tunnel temporarily unavailable", {
					status: 503,
					headers: { "content-type": "text/plain; charset=utf-8" },
				}),
		);
		const http = client(fetchImpl);
		const error = await http
			.json("sessionListFrame", { method: "GET", path: "/api/sessions" })
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(RelayError);
		expect((error as RelayError).kind).toBe("computer-offline");
		expect((error as RelayError).surface).toBe("computer-offline");
		expect((error as RelayError).envelope).toBe("keep");
	});

	it("classifies the gateway's JSON 503 by its reason and keeps its sentence", async () => {
		const body = {
			detail:
				"This computer's Radient login is no longer valid, so remote access is off until it is signed in again on this computer.",
			reason: "login_required",
			error: "tunnel authorization unavailable",
		};
		const { fetchImpl } = captureFetch(() => json(body, 503));
		const http = client(fetchImpl);
		const error = (await http
			.json("sessionListFrame", { method: "GET", path: "/api/sessions" })
			.catch((caught: unknown) => caught)) as RelayError;
		expect(error.kind).toBe("gateway-refused");
		expect(error.reason).toBe("login_required");
		/* The reason decides the surface; the detail is what the user reads. */
		expect(error.surface).toBe("console");
		expect(error.detail).toBe(body.detail);
	});

	it("carries Retry-After through, the one reason the gateway sends it for", async () => {
		const { fetchImpl } = captureFetch(() =>
			json(
				{
					detail: "paused",
					reason: "authorization_deferred",
					error: "tunnel authorization unavailable",
				},
				503,
				{
					"retry-after": "120",
				},
			),
		);
		const http = client(fetchImpl);
		const error = (await http
			.json("sessionListFrame", { method: "GET", path: "/api/sessions" })
			.catch((caught: unknown) => caught)) as RelayError;
		expect(error.reason).toBe("authorization_deferred");
		expect(error.retryAfterMs).toBe(120_000);
		expect(error.surface).toBe("retry");
	});

	it("reads the fixture's 502 as a relay that is not running", async () => {
		const fixture = JSON.parse(
			readFileSync(
				join(FIXTURE_ROOT, "http/index-authed-no-dist.json"),
				"utf8",
			),
		) as {
			status: number;
			body: string;
		};
		const { fetchImpl } = captureFetch(
			() =>
				new Response(JSON.stringify({ error: "local harness unavailable" }), {
					status: 502,
				}),
		);
		const http = client(fetchImpl);
		const error = (await http
			.json("sessionListFrame", { method: "GET", path: "/api/sessions" })
			.catch((caught: unknown) => caught)) as RelayError;
		expect(error.kind).toBe("relay-down");
		expect(error.surface).toBe("relay-stopped");
		/* The fixture is the other 5xx on this route: a daemon with no web bundle. */
		expect(fixture.status).toBe(503);
		expect(fixture.body).toContain("mobile web bundle not built");
	});

	it("reads the live 422 body as a pre-admission rejection that clears the envelope", async () => {
		const fixture = JSON.parse(
			readFileSync(join(FIXTURE_ROOT, "http/command-unknown-op.json"), "utf8"),
		) as {
			status: number;
			body: { error: string };
		};
		const { fetchImpl } = captureFetch(() =>
			json(fixture.body, fixture.status),
		);
		const http = client(fetchImpl);
		const error = (await http
			.json("commandAck", {
				method: "POST",
				path: "/api/sessions/x/command",
				body: { op: "frobnicate" },
			})
			.catch((caught: unknown) => caught)) as RelayError;
		expect(error.kind).toBe("rejected");
		expect(error.envelope).toBe("clear");
		expect(error.retry).toBe("never");
		expect(error.serverError).toBe(fixture.body.error);
	});
});

describe("timeouts and transport failures are never a success", () => {
	it("turns an expired deadline into a transport error", async () => {
		const neverSettles = ((_: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				/* Honour the abort the client's deadline raises, the way fetch does. */
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("The operation was aborted.")),
				);
			})) as unknown as typeof globalThis.fetch;
		const http = client(neverSettles, { timeoutMs: 20 });
		const error = (await http
			.json("healthz", { method: "GET", path: "/healthz" })
			.catch((caught: unknown) => caught)) as RelayError;
		expect(error).toBeInstanceOf(RelayError);
		expect(error.kind).toBe("transport");
		expect(error.envelope).toBe("keep");
	});

	it("aborts an in-flight request when the caller's signal fires", async () => {
		const controller = new AbortController();
		const seen: boolean[] = [];
		/* The request must actually be in flight before the abort, or the mock would
		 * be asserting an abort that no fetch ever received. */
		let markStarted: () => void = () => undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const hanging = ((_: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				markStarted();
				const fail = () => {
					seen.push(true);
					reject(new Error("aborted"));
				};
				if (init?.signal?.aborted) {
					fail();
					return;
				}
				init?.signal?.addEventListener("abort", fail);
			})) as unknown as typeof globalThis.fetch;
		const http = client(hanging, { timeoutMs: 0 });
		const request: RelayRequest = {
			method: "GET",
			path: "/healthz",
			signal: controller.signal,
		};
		const pending = http
			.json("healthz", request)
			.catch((caught: unknown) => caught);
		await started;
		controller.abort();
		const error = (await pending) as RelayError;
		expect(seen).toEqual([true]);
		expect(error.kind).toBe("transport");
	});
});

describe("a 2xx body that does not match its schema", () => {
	it("is a malformed-frame error, not a value with missing fields", async () => {
		const { fetchImpl } = captureFetch(() =>
			json({ ok: true, version: "five", sessions: 0, dist: false }),
		);
		const http = client(fetchImpl);
		const error = (await http
			.json("healthz", { method: "GET", path: "/healthz" })
			.catch((caught: unknown) => caught)) as RelayError;
		expect(error.kind).toBe("malformed-frame");
		expect(error.message).toContain("healthz");
		/* Admission was never proven, so a persisted command stays retryable. */
		expect(error.envelope).toBe("keep");
	});

	it("is raised before any caller can see a partial payload", async () => {
		const { fetchImpl } = captureFetch(
			() => new Response("<html>a captive portal</html>", { status: 200 }),
		);
		const http = client(fetchImpl);
		const error = (await http
			.json("sessionListFrame", { method: "GET", path: "/api/sessions" })
			.catch((caught: unknown) => caught)) as RelayError;
		expect(error.kind).toBe("malformed-frame");
	});
});

describe("Set-Cookie, which the edge relies on us persisting", () => {
	it("hands every Set-Cookie to onResponse, including on a failure", async () => {
		const seen: string[][] = [];
		const headers = new Headers({ "x-radient-login": "/_radient/login" });
		/* Two separate `set-cookie` headers, which is how the edge actually sends
		 * them: a combined header is the fallback `readSetCookies` handles. */
		headers.append("set-cookie", "__Host-radient-grant=old; Path=/; Secure");
		headers.append("set-cookie", "__Host-radient-refresh=new; Path=/; Secure");
		const { fetchImpl } = captureFetch(
			() => new Response("nope", { status: 401, headers }),
		);
		const http = client(fetchImpl, {
			onResponse: (facts) => void seen.push([...facts.setCookies]),
		});
		await http
			.json("sessionListFrame", { method: "GET", path: "/api/sessions" })
			.catch(() => undefined);
		expect(seen).toEqual([
			[
				"__Host-radient-grant=old; Path=/; Secure",
				"__Host-radient-refresh=new; Path=/; Secure",
			],
		]);
	});

	it("reads a combined header and prefers the standard accessor", () => {
		const headers = new Headers();
		headers.append("set-cookie", "a=1; Path=/");
		headers.append("set-cookie", "b=2; Path=/");
		const values = readSetCookies(headers);
		expect(values).toContain("a=1; Path=/");
		expect(values).toContain("b=2; Path=/");
	});

	it("splits a combined value without breaking an Expires date", () => {
		const combined =
			"a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/, b=2; Path=/";
		expect(splitCombinedSetCookie(combined)).toEqual([
			"a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/",
			"b=2; Path=/",
		]);
	});
});

describe("streams", () => {
	it("returns a reader without consuming the body, so frames survive", async () => {
		const { fetchImpl } = captureFetch(
			() =>
				new Response(
					'event: sessions\ndata: {"sessions":[],"degraded":[],"capabilities":{}}\n\n',
					{
						status: 200,
						headers: { "content-type": "text/event-stream; charset=utf-8" },
					},
				),
		);
		const http = client(fetchImpl);
		const stream = await http.stream({
			method: "GET",
			path: "/api/sessions/events",
		});
		const { value } = await stream.reader.read();
		expect(new TextDecoder().decode(value)).toContain("event: sessions");
		await stream.release();
	});

	it("classifies a non-2xx before a stream reader can be handed a 401", async () => {
		const { fetchImpl } = captureFetch(
			() =>
				new Response("Sign in with Radient", {
					status: 401,
					headers: { "x-radient-login": "/_radient/login" },
				}),
		);
		const http = client(fetchImpl);
		const error = (await http
			.stream({ method: "GET", path: "/api/sessions/events" })
			.catch((caught: unknown) => caught)) as RelayError;
		/* An `EventSource`-shaped client can never see this status and retries
		 * forever; the taxonomy is the only place that can catch it. */
		expect(error.kind).toBe("radiant-login-required");
	});
});

describe("binary bodies", () => {
	it("returns bytes and the mime type", async () => {
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		const { fetchImpl } = captureFetch(
			() =>
				new Response(bytes, {
					status: 200,
					headers: { "content-type": "image/png" },
				}),
		);
		const http = client(fetchImpl);
		const result = await http.bytes({
			method: "GET",
			path: "/api/sessions/x/image?entry=y&i=0",
		});
		expect(Array.from(result.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
		expect(result.mimeType).toBe("image/png");
	});
});

describe("a runtime that cannot stream is named, not faked", () => {
	it("refuses a response with no readable body", async () => {
		const { fetchImpl } = captureFetch(
			() =>
				({
					ok: true,
					status: 200,
					headers: new Headers(),
					body: null,
				}) as unknown as Response,
		);
		const http = client(fetchImpl);
		const error = (await http
			.stream({ method: "GET", path: "/api/sessions/events" })
			.catch((caught: unknown) => caught)) as RelayError;
		expect(error).toBeInstanceOf(RelayError);
		expect(error.kind).toBe("transport");
		expect(error.message).toContain("cannot stream");
	});
});

describe("no fetch at all is a build problem", () => {
	it("throws at construction rather than failing every request later", () => {
		vi.stubGlobal("fetch", undefined);
		try {
			expect(
				() =>
					new RelayHttpClient({
						baseUrl: TUNNEL_ORIGIN,
						auth: () => tunnelAuth,
						fetchImpl: undefined as unknown as typeof globalThis.fetch,
					}),
			).toThrow(/fetch implementation/);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
