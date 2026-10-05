// biome-ignore-all lint/style/noNonNullAssertion: an assertion after a guard is
// the guard.
/**
 * The transcribe transport: the multipart body's field name, the statuses the
 * route reads rather than throws, and the `401` that must go through the shared
 * reload rule instead of being swallowed as a transcription failure.
 */

import { describe, expect, it } from "vitest";

import {
	RelayEndpoints,
	RelayError,
	RelayHttpClient,
	type RelayRequest,
	type RequestAuth,
} from "@/relay";
import { transcribeForm } from "@/relay/endpoints";

const BASE = "https://tunnel.example.invalid";
const auth: RequestAuth = { cookie: null, origin: BASE, credentials: "omit" };

/** A fake `RelayHttpClient` that records the one request `transcribe` builds and
 *  answers with a canned status and body. Used where the assertion is about the
 *  REQUEST shape (`accept`, the multipart field name), not the classification. */
class CapturingHttp {
	request: RelayRequest | null = null;
	constructor(private readonly answer: { status: number; text: string }) {}
	async raw(request: RelayRequest) {
		this.request = request;
		return {
			status: this.answer.status,
			headers: {},
			text: this.answer.text,
			redirectHidden: false,
		};
	}
}

describe("transcribeForm", () => {
	it("names the file part `audio` — the daemon's required field", () => {
		const form = transcribeForm({ audio: new Blob(["x"]), filename: "a.m4a" });
		const part = form.get("audio");
		expect(part).toBeInstanceOf(Blob);
		expect(form.get("language") ?? null).toBeNull();
	});

	it("carries the forward-compat fields only when supplied", () => {
		const withFields = transcribeForm({
			audio: new Blob(["x"]),
			language: "en",
			prompt: "names",
			model: "whisper-1",
		});
		expect(withFields.get("language")).toBe("en");
		expect(withFields.get("prompt")).toBe("names");
		expect(withFields.get("model")).toBe("whisper-1");
	});
});

describe("RelayEndpoints.transcribe", () => {
	it("posts multipart to /api/transcribe and permits the refusal statuses", async () => {
		const http = new CapturingHttp({ status: 200, text: '{"text":"hi"}' });
		const endpoints = new RelayEndpoints(http as unknown as RelayHttpClient);
		await endpoints.transcribe({ audio: new Blob(["x"]), filename: "r.m4a" });
		const request = http.request!;
		expect(request.method).toBe("POST");
		expect(request.path).toBe("/api/transcribe");
		expect(request.multipart).toBeInstanceOf(FormData);
		expect(request.body).toBeUndefined();
		const accept = [...(request.accept ?? [])].sort();
		expect(accept).toEqual([402, 413, 422, 500, 502, 503].sort());
		/* `401` is deliberately NOT accepted: the transport's taxonomy must raise
		 * it so the shared reload rule runs once. */
		expect(request.accept ?? []).not.toContain(401);
	});

	it("returns the status and body for a refusal rather than throwing", async () => {
		const http = new CapturingHttp({
			status: 413,
			text: JSON.stringify({ error: "too big" }),
		});
		const endpoints = new RelayEndpoints(http as unknown as RelayHttpClient);
		const answer = await endpoints.transcribe({ audio: new Blob(["x"]) });
		expect(answer).toEqual({ status: 413, text: '{"error":"too big"}' });
	});

	it("raises a 401 through the shared reload rule (clear-all)", async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
			calls.push({ url: String(url), init: init ?? {} });
			return new Response(JSON.stringify({ error: "auth required" }), {
				status: 401,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof globalThis.fetch;
		const client = new RelayHttpClient({
			baseUrl: BASE,
			auth: () => auth,
			fetchImpl,
		});
		const endpoints = new RelayEndpoints(client);
		let thrown: unknown = null;
		try {
			await endpoints.transcribe({ audio: new Blob(["x"]) });
		} catch (cause) {
			thrown = cause;
		}
		expect(thrown).toBeInstanceOf(RelayError);
		expect((thrown as RelayError).kind).toBe("relay-unauthorized");
		expect((thrown as RelayError).envelope).toBe("clear-all");
		/* The body reached the wire as multipart, and NO content-type was set by us
		 * (the platform's serialiser owns the boundary). */
		expect(calls[0]!.init.body).toBeInstanceOf(FormData);
		const headers = calls[0]!.init.headers as Record<string, string>;
		expect(headers["content-type"]).toBeUndefined();
	});

	it("sends a 402 refusal back as data, not as an error", async () => {
		const fetchImpl = (async () =>
			new Response(JSON.stringify({ error: "out of credit" }), {
				status: 402,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof globalThis.fetch;
		const endpoints = new RelayEndpoints(
			new RelayHttpClient({ baseUrl: BASE, auth: () => auth, fetchImpl }),
		);
		expect(await endpoints.transcribe({ audio: new Blob(["x"]) })).toEqual({
			status: 402,
			text: '{"error":"out of credit"}',
		});
	});
});
