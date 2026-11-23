// biome-ignore-all lint/style/noNonNullAssertion: an assertion after a guard is
// the guard.
/**
 * The transcribe transport: the multipart body's field name, the statuses the
 * route reads rather than throws, and the `401` that must go through the shared
 * reload rule instead of being swallowed as a transcription failure.
 */

/* The encoder that actually builds the request body on the phone: SDK 57's global
 * `fetch` is `expo/fetch`, and this is the module it converts a `FormData` with.
 * Reaching into the package's source is deliberate — asserting against our own
 * copy of what we BELIEVE the encoder accepts is how this defect survived review.
 * An expo upgrade that moves the file fails this import loudly instead of
 * quietly weakening the test. */
import { convertFormDataAsync } from "expo/src/winter/fetch/convertFormData";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("the native upload's bytes part", () => {
	/* The runtime's `FormData` keeps a part as given — React Native's does, and
	 * `expo/fetch` patches it — while this Node host's undici `FormData` stringifies
	 * anything that is not a `Blob`. So the assertions run against a stand-in with
	 * the runtime's semantics, and the ENCODER stays the real one. */
	class RuntimeFormData {
		readonly parts: [string, unknown][] = [];
		append(name: string, value: unknown) {
			this.parts.push([name, value]);
		}
		get(name: string) {
			return this.parts.find(([key]) => key === name)?.[1] ?? null;
		}
		entries() {
			return this.parts[Symbol.iterator]();
		}
	}

	const audioBytes = new TextEncoder().encode("fake-m4a-bytes");
	const bytesPart = {
		name: "recording.m4a",
		type: "audio/mp4",
		bytes: async () => audioBytes,
	};

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("is the `audio` field of the body the encoder builds", async () => {
		vi.stubGlobal("FormData", RuntimeFormData);
		const form = transcribeForm({ audio: bytesPart });
		expect(form.get("audio")).toBe(bytesPart);

		const { body } = await convertFormDataAsync(
			form as unknown as FormData,
			"TESTBOUNDARY",
		);
		const text = new TextDecoder().decode(body);
		expect(text).toContain(
			'content-disposition: form-data; name="audio"; filename="recording.m4a"',
		);
		expect(text).toContain("content-type: audio/mp4");
		expect(text).toContain("fake-m4a-bytes");
	});

	it("reproduces what the `{ uri }` descriptor hits, so bytes are what make the upload possible", async () => {
		/* The premise of the fix, kept as a control: this is the encoder's own
		 * refusal — defect 2 — and it is why the caller cannot hand over the
		 * descriptor React Native's `fetch` would have read. */
		vi.stubGlobal("FormData", RuntimeFormData);
		const uriPart = {
			uri: "file:///cache/recording.m4a",
			name: "recording.m4a",
			type: "audio/mp4",
		};
		const form = transcribeForm({ audio: uriPart });
		expect(form.get("audio")).toEqual(uriPart);
		await expect(
			convertFormDataAsync(form as unknown as FormData, "TESTBOUNDARY"),
		).rejects.toThrow("Unsupported FormDataPart implementation");
	});

	it("leaves the Blob arm a Blob, with its filename", () => {
		/* The path the web/Node targets upload through, unchanged by the bytes arm. */
		const form = transcribeForm({
			audio: new Blob(["x"], { type: "audio/mp4" }),
			filename: "take.m4a",
		});
		expect(form.get("audio")).toBeInstanceOf(Blob);
	});
});
