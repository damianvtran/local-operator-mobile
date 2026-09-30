import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	RelayError,
	RelayHttpClient,
	type RelayRequest,
	type RequestAuth,
} from "../index";

const _FIXTURE_ROOT = fileURLToPath(
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
const _customAuth: RequestAuth = {
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
