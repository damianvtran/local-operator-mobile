import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRelayClient } from "@/connection";
import {
	memoryEnvelopeStore,
	type RelayEndpoints,
	RetryEnvelopeStore,
	sendPersistedCommand,
} from "@/relay";
import { createCookieJarFetch } from "@/testing/cookie-jar-fetch";

/**
 * The attachment path against the REAL mock relay, over a real socket.
 *
 * This is the wire proof for composer images, outside-in: the app's own send
 * path (`sendPersistedCommand` → `RelayEndpoints.command`) is driven over a
 * socket against `node tools/mock-relay/relay.ts`, and what it carries is read
 * back three ways —
 *
 *  - the REQUEST: the bytes the client handed to `fetch` for the command carry
 *    `images: [{ data_b64, mime_type }]` (captured in the fetch wrapper — the
 *    last code before the socket);
 *  - the OUTCOME: the relay's own receipt `prompt admitted`, and the same
 *    `command_id` answered `already admitted` on a replay — the durable
 *    de-duplication the retry envelope depends on;
 *  - the DISCRIMINATION: the same blank-text body WITHOUT an image is refused
 *    `422 "text must be a non-empty string"` — the relay's own sentence for the
 *    text-or-image rule — so the first admission is provably the image rescue,
 *    not a body the relay would have taken anyway.
 *
 * The mock's relay-side rules are pinned from the real daemon (`textOrImageRefusal`
 * carries the contract's order and sentences), so a regression in the app's image
 * plumbing — dropping `images`, mis-keying them, moving them off the envelope —
 * fails here rather than in a model's attachment path.
 *
 * Ctrl-C the fleet? No — the relay is spawned per suite on port 0 and shut down
 * through its own control route in `afterAll`, with a kill by exact pid as the
 * backstop (the shape `notification-path.e2e.test.ts` set).
 */

const RELAY = fileURLToPath(
	new URL("../../tools/mock-relay/relay.ts", import.meta.url),
);
const PASSWORD = "[redacted]";

/** A real 1×1 PNG, base64 — the same payload the mock serves from `/image`.
 *  Spelled here as data rather than imported from the server file, so the test
 *  fixture cannot drift with a server-side rename. */
const PNG_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const IMAGE = { data_b64: PNG_B64, mime_type: "image/png" };

let child: ChildProcess | null = null;
let base = "";
let client: RelayEndpoints;
let sessionId = "";

/** Every command body the client put on the wire, in order. */
const commandBodies: Array<Record<string, unknown>> = [];

async function selectScenario(scenario: string): Promise<void> {
	await fetch(`${base}/__mock/scenario`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ scenario }),
	});
}

beforeAll(async () => {
	const jar = createCookieJarFetch();
	/**
	 * The jar fetch with a thin recorder in front: the command bodies are read
	 * where the client hands them over, so the assertion is about the bytes on
	 * the wire rather than about anything the mock decided to echo back.
	 */
	const recordingFetch = (async (input, init) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const body = typeof init?.body === "string" ? init.body : null;
		if (body !== null && url.includes("/command")) {
			commandBodies.push(JSON.parse(body) as Record<string, unknown>);
		}
		return jar.fetch(input as Parameters<typeof jar.fetch>[0], init);
	}) as typeof globalThis.fetch;

	const port = await new Promise<number>((resolve, reject) => {
		const launched = spawn(
			process.execPath,
			[RELAY, "--port", "0", "--print-port", "--quiet", "--password", PASSWORD],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		child = launched;
		let buffered = "";
		const timer = setTimeout(
			() => reject(new Error("the mock relay never printed its port")),
			15_000,
		);
		launched.stdout?.on("data", (chunk: Buffer) => {
			buffered += chunk.toString();
			const line = buffered.split("\n")[0] ?? "";
			const value = Number.parseInt(line.trim(), 10);
			if (Number.isFinite(value) && value > 0) {
				clearTimeout(timer);
				resolve(value);
			}
		});
		launched.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		launched.on("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`the mock relay exited early: ${String(code)}`));
		});
	});
	base = `http://127.0.0.1:${port}`;
	client = createRelayClient({
		route: { mode: "custom", baseUrl: base, allowInsecure: true },
		fetchImpl: recordingFetch,
	});
	const login = await client.login(PASSWORD);
	expect(login.signedIn).toBe(true);

	/* The idle scenario's one live conversation: the corpus capture's own world,
	 * and the session every command route below resolves. */
	await selectScenario("idle");
	const frame = await client.sessions();
	const row = frame.sessions.find(
		(candidate) =>
			typeof candidate.session_id === "string" && candidate.session_id !== "",
	);
	if (row?.session_id === undefined) {
		throw new Error("the idle scenario served no live session to command");
	}
	sessionId = row.session_id;
}, 30_000);

afterAll(async () => {
	try {
		await fetch(`${base}/__mock/shutdown`, { method: "POST" });
	} catch {
		// The control route is best-effort; the kill below is the guarantee.
	}
	const exited = child;
	child = null;
	if (exited && exited.exitCode === null && exited.signalCode === null) {
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				exited.kill("SIGKILL");
				resolve();
			}, 3_000);
			exited.once("exit", () => {
				clearTimeout(timer);
				resolve();
			});
		});
	}
}, 20_000);

describe("an attached image reaches the relay", () => {
	it("puts the image on the wire and is admitted, and the id deduplicates a replay", async () => {
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
		const result = await sendPersistedCommand({
			client,
			envelopes,
			sessionId,
			op: "prompt",
			text: "",
			images: [IMAGE],
		});
		// The relay's own receipt, passed through by the app's send path.
		expect(result.detail).toBe("prompt admitted");

		// The request: what left the client for the command route.
		const sent = commandBodies.at(-1);
		if (sent === undefined) throw new Error("no command body was recorded");
		expect(sent.op).toBe("prompt");
		expect(sent.text).toBe("");
		expect(sent.images).toEqual([IMAGE]);
		expect(typeof sent.command_id).toBe("string");

		// The durable identity: the same id replayed is deduplicated, not re-run.
		const replay = await client.command(sessionId, {
			op: "prompt",
			command_id: String(sent.command_id),
			text: "",
			images: [IMAGE],
		});
		expect(replay.detail).toBe("already admitted");
	});

	it("refuses the same blank text without an image — the rescue is the image", async () => {
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
		await expect(
			sendPersistedCommand({
				client,
				envelopes,
				sessionId,
				op: "prompt",
				text: "",
			}),
		).rejects.toMatchObject({
			kind: "rejected",
			serverError: "text must be a non-empty string",
		});
	});
});
