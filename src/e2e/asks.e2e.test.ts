/**
 * The queued-ask wire, outside-in: the app's REAL client against a REAL server.
 *
 * Three facts no unit test can hold. `GET /api/asks` parses through the real
 * HTTP stack into the rows the sheet renders — including the aggregate-only
 * `session_id` + `cwd` columns, which are what make a foreign row answerable.
 * The command route receives the ATOMIC body: `ask_respond` with every question
 * of the ask in ONE map, a deliberate skip riding as the empty list (the wire's
 * own spelling for "no answer"), never a missing key. And a refusal arrives as a
 * 422 carrying the relay's OWN sentence on `displayableMessage`, which is the
 * copy the sheet shows verbatim rather than a status code under a button.
 *
 * The server is this test's own, the `deadline` suite's shape: the payloads are
 * the frozen shapes from `docs/relay/types.ts`, and what is asserted is what
 * crossed the socket. Auth is covered by `relay-client.e2e.test.ts`; this file
 * is about the ask slices of the contract.
 */

import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { type CustomRoute, createRelayClient } from "../connection";
import { isRelayError } from "../relay";

const SESSION = "6714def86197";
const ASK_ID = "ask-67f1c2a0";
/* The relay's own refusal sentence for an expired ask (`asks/render.py:232`). */
const EXPIRED_COPY =
	"this ask expired 7 days ago — ask again if it is still needed.";

interface Recorded {
	method: string;
	path: string;
	body: unknown;
}

const servers: Server[] = [];
const recorded: Recorded[] = [];

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					server.closeAllConnections();
				}),
		),
	);
	recorded.length = 0;
});

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
	});
}

/** A local server whose single handler decides every answer; every request is
 *  recorded so the assertions can be about the BYTES the client sent. */
async function serve(
	handle: (path: string, body: unknown) => { status: number; body: unknown },
): Promise<string> {
	const server = createServer(
		async (request: IncomingMessage, response: ServerResponse) => {
			const raw = await readBody(request);
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw) as unknown;
			} catch {
				parsed = raw;
			}
			recorded.push({
				method: request.method ?? "",
				path: request.url ?? "",
				body: parsed,
			});
			const answer = handle(request.url ?? "", parsed);
			response.writeHead(answer.status, { "content-type": "application/json" });
			response.end(JSON.stringify(answer.body));
		},
	);
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return `http://127.0.0.1:${port}`;
}

function clientFor(baseUrl: string) {
	const route: CustomRoute = { mode: "custom", baseUrl, allowInsecure: true };
	return createRelayClient({ route });
}

/** One queued-ask row, the frozen shape (`docs/relay/types.ts` `PendingAsk`),
 *  with the aggregate-only columns the sheet's foreign rows depend on. */
function askRow(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		ask_id: ASK_ID,
		session_id: SESSION,
		cwd: "~/work/parity",
		created_at: 1_790_727_000_000,
		expires_at: 1_790_727_900_000,
		timeout_s: 900,
		urgent: false,
		status: "open",
		delivered: false,
		questions: [
			{
				id: "q1",
				question: "which credential should I use for the staging API?",
				options: [
					{
						label: "the stored key",
						description: "read from the encrypted store",
					},
					{ label: "a new key", description: "used once, never written" },
				],
				multi: false,
				recommended: 0,
				secret: false,
				persist: false,
			},
			{
				id: "q2",
				question: "paste the key",
				options: [],
				multi: false,
				recommended: null,
				secret: true,
				persist: false,
			},
		],
		...overrides,
	};
}

describe("GET /api/asks through the real stack", () => {
	it("parses the aggregate rows, including session_id + cwd", async () => {
		const baseUrl = await serve(() => ({
			status: 200,
			body: {
				asks: [
					askRow(),
					askRow({
						ask_id: "ask-timed-out",
						status: "timed_out",
						delivered: false,
						urgent: true,
					}),
				],
			},
		}));
		const client = clientFor(baseUrl);

		const answer = await client.asks();
		expect(answer.asks).toHaveLength(2);
		/* The columns a per-session frame cannot carry — without them the sheet
		 * cannot say whose ask a row is, nor route an answer back to it. */
		expect(answer.asks[0]?.session_id).toBe(SESSION);
		expect(answer.asks[0]?.cwd).toBe("~/work/parity");
		expect(answer.asks[1]?.status).toBe("timed_out");
		expect(answer.asks[0]?.questions[1]?.secret).toBe(true);

		expect(recorded[0]?.method).toBe("GET");
		expect(recorded[0]?.path).toBe("/api/asks");
	});
});

describe("the answer travels as one atomic body", () => {
	it("sends every question id in one map, the skip as the empty list", async () => {
		const baseUrl = await serve(() => ({
			status: 200,
			body: { ok: true, detail: "answered" },
		}));
		const client = clientFor(baseUrl);

		const ack = await client.command(SESSION, {
			op: "ask_respond",
			ask_id: ASK_ID,
			answers: { q1: ["the stored key"], q2: [] },
		});
		expect(ack.ok).toBe(true);
		expect(ack.detail).toBe("answered");

		/* The relay's route, verbatim, and the body the queue's atomic contract
		 * requires: both question ids present, the skip spelled as `[]`. A map
		 * missing `q2` would be refused by the queue's partial-answer guard. */
		expect(recorded[0]?.path).toBe(`/api/sessions/${SESSION}/command`);
		expect(recorded[0]?.body).toMatchObject({
			op: "ask_respond",
			ask_id: ASK_ID,
			answers: { q1: ["the stored key"], q2: [] },
		});
	});

	it("carries a decline and a dismissal the same way", async () => {
		const baseUrl = await serve(() => ({
			status: 200,
			body: { ok: true, detail: "declined" },
		}));
		const client = clientFor(baseUrl);

		await client.command(SESSION, { op: "ask_decline", ask_id: ASK_ID });
		await client.command(SESSION, { op: "ask_dismiss", ask_id: ASK_ID });
		expect(recorded.map((entry) => entry.body)).toEqual([
			{ op: "ask_decline", ask_id: ASK_ID },
			{ op: "ask_dismiss", ask_id: ASK_ID },
		]);
	});
});

describe("a refusal is the relay's own sentence", () => {
	it("surfaces the expired-ask copy on displayableMessage, not a status code", async () => {
		const baseUrl = await serve(() => ({
			status: 422,
			body: { error: EXPIRED_COPY },
		}));
		const client = clientFor(baseUrl);

		let caught: unknown;
		try {
			await client.command(SESSION, {
				op: "ask_respond",
				ask_id: ASK_ID,
				answers: { q1: ["x"] },
			});
		} catch (failure) {
			caught = failure;
		}
		expect(isRelayError(caught)).toBe(true);
		if (!isRelayError(caught)) return;
		expect(caught.status).toBe(422);
		expect(caught.kind).toBe("rejected");
		/* The exact bytes the sheet renders under the row it answers. */
		expect(caught.displayableMessage).toBe(EXPIRED_COPY);
	});
});
