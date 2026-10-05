/**
 * The voice fixture, driven over a real socket.
 *
 * WHY THIS FILE EXISTS AS A TEST AND NOT ONLY AS `verify.ts` CHECKS. The mock's
 * `POST /api/transcribe` used to answer a `200 {text: "", degraded: ["stt"]}`
 * that no client is written to read, and neither a design round nor a QA pass
 * could drive the mic at all: the captured capability block says
 * `available: false`, so the control never rendered. A fixture nobody exercises
 * is not evidence, so these cases start the relay IN PROCESS on an ephemeral
 * port and speak to it over HTTP — multipart bodies, a login cookie and all —
 * rather than asserting a pure function's output twice.
 *
 * `verify.ts` remains the harness's whole-contract run (28 minutes under load);
 * this is the fast, targeted slice for the route, and it runs in `pnpm test`,
 * which CI executes on every pull request.
 */

import { afterEach, describe, expect, it } from "vitest";

import { createRelay, DEFAULT_PASSWORD } from "./relay.ts";
import { STT_MAX_UPLOAD_BYTES } from "./transcribe.ts";

interface Rig {
	base: string;
	authHeader: string | null;
	stop: () => Promise<void>;
}

/** Start the relay in process, log in once, and hand back a cookie-bearing rig. */
async function rig(scenario: string): Promise<Rig> {
	const relay = createRelay({
		scenario,
		password: DEFAULT_PASSWORD,
		quiet: true,
	});
	const { url } = await relay.listen({ port: 0 });
	const login = await fetch(new URL("/login", url), {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `password=${encodeURIComponent(DEFAULT_PASSWORD)}`,
	});
	const setCookie = login.headers.getSetCookie?.() ?? [];
	const authHeader = setCookie[0]?.split(";")[0] ?? null;
	return {
		base: url,
		authHeader,
		stop: () => relay.shutdown(),
	};
}

/** One request with the rig's cookie attached. */
async function call(
	rigged: Rig,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const headers = new Headers(init.headers);
	if (rigged.authHeader !== null) headers.set("cookie", rigged.authHeader);
	return fetch(new URL(path, rigged.base), { ...init, headers });
}

/** The JSON body of a response, in the mock's own `Json` vocabulary. */
const jsonOf = async (res: Response): Promise<Record<string, unknown>> =>
	(await res.json()) as Record<string, unknown>;

/** A multipart body whose single `audio` part is `bytes` of `mime`. */
function audioForm(bytes: number, mime: string): FormData {
	const form = new FormData();
	form.set(
		"audio",
		new Blob([new Uint8Array(bytes)], { type: mime }),
		"recording.m4a",
	);
	return form;
}

/**
 * Read an SSE body until `needle` appears or `ms` elapses.
 *
 * A bounded read rather than `res.text()`: the stream never ends (keepalives),
 * so awaiting the whole body would park until the test's own timeout and report
 * the harness's clock as the app's failure.
 */
async function readUntil(
	res: Response,
	needle: string,
	ms: number,
): Promise<string> {
	const reader = res.body?.getReader();
	if (reader === undefined) return "";
	const decoder = new TextDecoder();
	const deadline = Date.now() + ms;
	let text = "";
	try {
		while (Date.now() < deadline) {
			const { value, done } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
			if (text.includes(needle)) break;
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	return text;
}

const rigs: Rig[] = [];
const start = async (scenario: string): Promise<Rig> => {
	const started = await rig(scenario);
	rigs.push(started);
	return started;
};

afterEach(async () => {
	await Promise.all(rigs.splice(0).map((started) => started.stop()));
});

describe("the capability block a scenario pins", () => {
	it("advertises an executable path when the world says voice is available", async () => {
		const started = await start("voice");
		const list = await jsonOf(await call(started, "/api/sessions"));
		expect(list.capabilities).toEqual({
			features: expect.any(Object),
			stt: { available: true, path: "provider_stt_radient", reason: "" },
		});
	});

	it("OMITS the key for an older relay, which is not the same shape as `available: false`", async () => {
		const absent = await jsonOf(
			await call(await start("voice-absent"), "/api/sessions"),
		);
		expect("stt" in (absent.capabilities as Record<string, unknown>)).toBe(
			false,
		);
		// The captured block still rides for every other scenario, so the omission
		// above is the override doing its job rather than the block never existing.
		const idle = await jsonOf(await call(await start("idle"), "/api/sessions"));
		const stt = (idle.capabilities as { stt?: { available: boolean } }).stt;
		expect(stt?.available).toBe(false);
	});

	it("rides the SSE list frame too, because one builder serves both transports", async () => {
		const started = await start("voice");
		const res = await call(started, "/api/sessions/events", {
			headers: { accept: "text/event-stream" },
		});
		const text = await readUntil(res, "capabilities", 4000);
		const frame = text
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => {
				try {
					return JSON.parse(line.slice("data:".length).trim()) as Record<
						string,
						unknown
					>;
				} catch {
					return undefined;
				}
			})
			.find((parsed) => parsed !== undefined && "capabilities" in parsed);
		if (frame === undefined) {
			// Loud, with the bytes that WERE read: a silent `undefined` here would
			// report the frame's absence as "the capability block is absent", which
			// is the very distinction this suite exists to draw.
			throw new Error(
				`no sessions frame carried capabilities. Read: ${text.slice(0, 300)}`,
			);
		}
		expect((frame.capabilities as Record<string, unknown>).stt).toEqual({
			available: true,
			path: "provider_stt_radient",
			reason: "",
		});
	});
});

describe("POST /api/transcribe", () => {
	it("answers the contract's success shape with the token that ran", async () => {
		const started = await start("voice");
		const res = await call(started, "/api/transcribe", {
			method: "POST",
			body: audioForm(64, "audio/mp4"),
		});
		expect(res.status).toBe(200);
		expect(await jsonOf(res)).toEqual({
			text: "Add a retry to the send path.",
			provider: "radient",
			model: null,
			// A real STT_BACKENDS key: the app stores it as `input_path`.
			path: "provider_stt_radient",
		});
	});

	it("refuses a mime outside the allowlist with the daemon's sentence", async () => {
		const started = await start("voice");
		const res = await call(started, "/api/transcribe", {
			method: "POST",
			body: audioForm(16, "text/plain"),
		});
		expect(res.status).toBe(422);
		expect(await jsonOf(res)).toEqual({
			error: "Unsupported audio format: text/plain.",
		});
	});

	it("refuses a body with no audio file part", async () => {
		const started = await start("voice");
		const form = new FormData();
		form.set("language", "en");
		const res = await call(started, "/api/transcribe", {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(422);
		expect(await jsonOf(res)).toEqual({ error: "audio file is required" });
	});

	it("refuses an empty audio part", async () => {
		const started = await start("voice");
		const res = await call(started, "/api/transcribe", {
			method: "POST",
			body: audioForm(0, "audio/mp4"),
		});
		expect(res.status).toBe(422);
		expect(await jsonOf(res)).toEqual({ error: "audio file is empty" });
	});

	it("refuses a body that is not multipart at all", async () => {
		const started = await start("voice");
		const res = await call(started, "/api/transcribe", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ audio: "not a file" }),
		});
		expect(res.status).toBe(422);
		expect(await jsonOf(res)).toEqual({ error: "invalid multipart body" });
	});

	it("refuses a declared length over the cap", async () => {
		const started = await start("voice");
		// Past the daemon's 20 MB cap PLUS its 1 MB multipart-framing slack, which is
		// the only arm a real oversize upload trips.
		const res = await call(started, "/api/transcribe", {
			method: "POST",
			body: audioForm(21 * 1024 * 1024 + 64, "audio/mp4"),
		});
		expect(res.status).toBe(413);
		expect(await jsonOf(res)).toEqual({
			error: "Recording is too large — the limit is 20 MB. Try a shorter clip.",
		});
	});

	it("refuses a payload over the cap that the declared length did not catch", async () => {
		const started = await start("voice");
		// One byte over the payload cap, with the framing still inside the declared
		// arm's slack: this is the post-read bound, which the header cannot see.
		const res = await call(started, "/api/transcribe", {
			method: "POST",
			body: audioForm(STT_MAX_UPLOAD_BYTES + 1, "audio/mp4"),
		});
		expect(res.status).toBe(413);
		expect(await jsonOf(res)).toEqual({
			error: "Recording is too large — the limit is 20 MB. Try a shorter clip.",
		});
	});

	it("answers the 503 race for a world with no executable path", async () => {
		const started = await start("voice-absent");
		const res = await call(started, "/api/transcribe", {
			method: "POST",
			body: audioForm(32, "audio/mp4"),
		});
		expect(res.status).toBe(503);
		expect(await jsonOf(res)).toEqual({
			error: "Voice input isn't available on this machine.",
			code: "stt_unavailable",
		});
	});
});
