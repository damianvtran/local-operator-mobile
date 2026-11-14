import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { expect, it } from "vitest";
import { RelayEndpoints } from "@/relay/endpoints";
import { RelayHttpClient } from "@/relay/http";
import {
	memoryEnvelopeStore,
	RetryEnvelopeStore,
} from "@/relay/retry-envelope";
import { sendPersistedCommand } from "@/relay/send-command";
import { StartupCoordinator, type StartupRecord } from "./startup-coordinator";

/**
 * WHERE A FIRST SEND'S TIME GOES (TestFlight 906: "when I click to send it
 * takes a while"). The production coordinator, the production relay client
 * (`RelayEndpoints` over `RelayHttpClient` and real `fetch`) and the production
 * persisted command path (`sendPersistedCommand`), against a loopback relay that
 * answers with the captured fixtures (`fixtures/relay/http/start-session.json`,
 * `command-prompt-ok.json`). The relay answers at once, so every millisecond
 * printed is CLIENT time; a real computer's create latency adds on top of
 * `tap → session id`, which is exactly the interval the optimistic rows now
 * cover.
 *
 * Printed, not gated — EXCEPT the one ordering that is the fix: the message is
 * paintable (in the published queue) before the start POST has even reached
 * the relay, so no network latency can sit between the tap and the bubble.
 * Device storage here is in-memory; on a phone each `persist` also seals the
 * record (`native-private-store.ts`), which this does not measure.
 */
const fixture = (name: string) =>
	JSON.parse(
		readFileSync(
			new URL(`../../../fixtures/relay/http/${name}.json`, import.meta.url),
			"utf8",
		),
	).body as unknown;

const drain = (request: IncomingMessage) =>
	new Promise<void>((resolve) => {
		request.on("data", () => undefined);
		request.on("end", () => resolve());
	});

const run = async (imageBytes: number) => {
	const marks: Record<string, number> = {};
	const at = (name: string) => {
		marks[name] ??= performance.now();
	};
	const server = createServer(async (request, response) => {
		const path = request.url ?? "";
		if (path === "/api/sessions/start") at("start POST received");
		else if (path.endsWith("/command")) at("continuation POST received");
		await drain(request);
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(
			JSON.stringify(
				fixture(
					path === "/api/sessions/start"
						? "start-session"
						: "command-prompt-ok",
				),
			),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("no port");
		const client = new RelayEndpoints(
			new RelayHttpClient({
				fetchImpl: (...args) => globalThis.fetch(...args),
				baseUrl: `http://127.0.0.1:${address.port}`,
				// A loopback relay needs no credential; nothing secret exists here.
				auth: () => ({ cookie: null, origin: null, credentials: "omit" }),
			}),
		);
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
		let disk: StartupRecord | null = null;
		let counter = 0;
		const coordinator = new StartupCoordinator("synthetic-scope", {
			store: {
				load: async () => disk,
				save: async (record) => {
					disk = structuredClone(record);
				},
			},
			start: (selection) => client.startSession(selection),
			send: async (sessionId, envelope) => {
				await sendPersistedCommand({
					client,
					sessionId,
					envelopes,
					...envelope,
					envelope,
				});
			},
			isCurrent: () => true,
			uuid: () =>
				`00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
		});
		await coordinator.ready;
		await coordinator.configure({ cwd: "/synthetic" });
		const images =
			imageBytes > 0
				? [
						{
							mime_type: "image/png",
							data_b64: Buffer.alloc(imageBytes).toString("base64"),
						},
					]
				: [];
		coordinator.edit("synthetic first message", images);
		coordinator.subscribe(() => {
			const snap = coordinator.snapshot();
			if (snap.queue.length > 0) at("message paintable (optimistic row)");
			if (snap.sessionId !== null) at("session id published (old mount)");
			if (snap.delivered.length > 0) at("continuation acknowledged");
		});
		const tap = performance.now();
		await coordinator.enqueue(() => at("durable admission (keyboard yields)"));
		await coordinator.settled();
		const rows = Object.entries(marks)
			.map(([name, time]) => [name, Number((time - tap).toFixed(2))] as const)
			.sort((a, b) => a[1] - b[1]);
		return { marks, rows };
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
};

it("measures tap → paint → start → session id → continuation (printed)", async () => {
	for (const [label, bytes] of [
		["text only", 0],
		["one 1.5 MB image", 1.5 * 1024 * 1024],
	] as const) {
		const samples: Array<Record<string, number>> = [];
		for (let i = 0; i < 5; i++) {
			const { marks, rows } = await run(bytes);
			const paint = marks["message paintable (optimistic row)"];
			const startPost = marks["start POST received"];
			expect(paint).toBeDefined();
			expect(startPost).toBeDefined();
			// THE FIX'S ORDERING: the row can paint before any network happens.
			expect(paint as number).toBeLessThanOrEqual(startPost as number);
			samples.push(Object.fromEntries(rows));
		}
		const names = Object.keys(samples[0] ?? {});
		const median = (values: number[]) =>
			[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
		console.log(
			`STARTUP LATENCY (${label}, n=5, ms from tap; median [min..max])\n${names
				.map((name) => {
					const values = samples.map((s) => s[name] as number);
					return `  ${name.padEnd(38)} ${median(values)} [${Math.min(...values)}..${Math.max(...values)}]`;
				})
				.join("\n")}`,
		);
	}
}, 60_000);
