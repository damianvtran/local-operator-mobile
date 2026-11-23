/**
 * Reactions over the REAL HTTP boundary (spec "Mobile Team Bridge: reactions
 * and start-a-thread", slice PR b, gap G6): the app's own client and store
 * against `tools/mock-team-bridge.ts` run as its CLI, so the wire (verbs,
 * tenant placement, emoji encoding, the answer's parse) is exercised end to
 * end. A raw HTTP write stands in for the desktop (same account, same hub).
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { TENANT } from "@/team-bridge/__tests__/fixtures";
import { createHubClient } from "@/team-bridge/client";
import { createTeamBridgeStore, threadKey } from "@/team-bridge/store";
import { TEAM_BRIDGE_FIXTURE_TOKEN } from "@/testing/team-bridge-token";

// App/client integration belongs to the app config: Node tooling intentionally
// has no app alias map. Keep the actual HTTP fixture tests, not a wider config.
const rigs: { close: () => Promise<void> }[] = [];
const directories: string[] = [];
const LISTEN_ADDRESS = /listening on (127\.0\.0\.1:\d+)/;
async function rig() {
	// Ordinary pnpm test and clean CI runners have no Local Operator environment.
	// Honor its scratch root when supplied, otherwise Node's TMPDIR-aware root;
	// mkdtemp owns a private child, and cleanup removes only that child.
	const scratch = process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir();
	await mkdir(scratch, { recursive: true });
	const root = await mkdtemp(join(scratch, "hub-fixture-test-"));
	directories.push(root);
	await writeFile(join(root, "index.html"), "<p>Synthetic fixture page</p>");
	// Run the Node-only fixture across its real CLI boundary. Importing the
	// tooling graph here would pull explicit Node .ts specifiers into the app
	// compiler; widening either compiler's module contract would hide the defect.
	const child = spawn(
		process.execPath,
		["--experimental-strip-types", "tools/mock-team-bridge.ts", root, "0"],
		{
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const lines = createInterface({ input: child.stdout });
	const address = new Promise<string>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => reject(new Error(`fixture exited ${code}`)));
		lines.on("line", (line) => {
			const match = LISTEN_ADDRESS.exec(line);
			if (match) resolve(`http://${match[1]}`);
		});
	});
	const fixture = {
		listen: async () => ({ url: await address }),
		close: async () => {
			lines.close();
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, "exit");
			child.kill("SIGTERM");
			await exited;
		},
	};
	rigs.push(fixture);
	return fixture;
}
const get = (url: string, path: string) =>
	fetch(`${url}${path}`, { signal: AbortSignal.timeout(2000) });
afterEach(async () => {
	const closed = await Promise.allSettled(
		rigs.splice(0).map((fixture) => fixture.close()),
	);
	const removed = await Promise.allSettled(
		directories
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
	if ([...closed, ...removed].some((result) => result.status === "rejected"))
		throw new Error("owned hub fixture cleanup failed");
}, 15_000);

const CONV = "bcv_humans";
const THUMBS = "\u{1F44D}";
const PARTY = "\u{1F389}";
async function world(scenario: string, fetchImpl?: typeof globalThis.fetch) {
	const fixture = await rig();
	const { url } = await fixture.listen();
	const base = `${url}/mock-hub/${scenario}/v1/messaging`;
	const accessToken = async () => TEAM_BRIDGE_FIXTURE_TOKEN;
	const hub = createHubClient({
		baseUrl: `${url}/mock-hub/${scenario}`,
		fetchImpl,
		accessToken,
	});
	const bridge = createTeamBridgeStore({ hub: () => hub, accessToken });
	const poll = () => bridge.actions.loadThread(TENANT, CONV);
	const held = (id: string) =>
		bridge.store
			.getState()
			.threads[threadKey(TENANT, CONV)]?.messages.find((m) => m.id === id)
			?.reactions;
	const stats = async () =>
		(await (await get(url, "/__stats")).json()).result as {
			requests: { method: string; path: string }[];
			reactionWrites: { put: number; delete: number };
		};
	/** The desktop's write: same hub, same account, raw HTTP. */
	const desktop = (method: "PUT" | "DELETE", id: string, emoji: string) =>
		fetch(
			`${base}/conversations/${CONV}/messages/${id}/reactions/${encodeURIComponent(emoji)}${method === "DELETE" ? `?tenant_id=${TENANT}` : ""}`,
			{
				method,
				headers: {
					authorization: `Bearer ${TEAM_BRIDGE_FIXTURE_TOKEN}`,
					"content-type": "application/json",
				},
				body:
					method === "PUT" ? JSON.stringify({ tenant_id: TENANT }) : undefined,
				signal: AbortSignal.timeout(2000),
			},
		);
	return { bridge, poll, held, stats, desktop, base };
}
const target = (messageId: string) => ({
	tenantId: TENANT,
	conversationId: CONV,
	messageId,
});

describe("reactions over the actual HTTP client and mock hub", () => {
	it("details world serves 14 summaries with independent ownership/sample labels and a real root rollup", async () => {
		const w = await world("reactions_details");
		await w.poll();
		expect(w.held("bcm_3")).toHaveLength(14);
		expect(w.held("bcm_3")?.[0]).toEqual({
			emoji: THUMBS,
			count: 8,
			reacted_by_me: true,
			sample_labels: ["Ada", "Ben", "Cy"],
		});
		expect(w.held("bcm_3")?.[1]).toEqual({
			emoji: PARTY,
			count: 4,
			reacted_by_me: false,
			sample_labels: [],
		});
		const message = w.bridge.store
			.getState()
			.threads[threadKey(TENANT, CONV)]?.messages.find(
				(row) => row.id === "bcm_3",
			);
		expect(message?.reply_count).toBeGreaterThan(0);
		expect(Number.isFinite(Date.parse(message?.last_reply_at ?? ""))).toBe(
			true,
		);
		expect((await w.stats()).reactionWrites).toEqual({ put: 0, delete: 0 });
	});
	it("history rows carry the served summary; a message without reactions carries none", async () => {
		const w = await world("reactions");
		await w.poll();
		expect(w.held("bcm_3")).toEqual([
			{
				emoji: THUMBS,
				count: 2,
				reacted_by_me: false,
				sample_labels: ["Ada", "Aida"],
			},
			{ emoji: PARTY, count: 1, reacted_by_me: true, sample_labels: ["Sam"] },
		]);
		expect(w.held("bcm_1")).toBeUndefined();
	});

	it("desktop → phone within one poll, and phone → desktop's next read", async () => {
		const w = await world("reactions");
		await w.poll();
		expect((await w.desktop("PUT", "bcm_1", "\u{1F440}")).status).toBe(200);
		await w.poll(); // one poll
		expect(w.held("bcm_1")).toEqual([
			{
				emoji: "\u{1F440}",
				count: 1,
				reacted_by_me: true,
				sample_labels: ["Sam"],
			},
		]);
		expect(await w.bridge.actions.toggleReaction(target("bcm_1"), THUMBS)).toBe(
			"added",
		);
		// The desktop's next history read (same account) shows the phone's write.
		const read = await fetch(
			`${w.base}/conversations/${CONV}/messages?tenant_id=${TENANT}`,
			{ signal: AbortSignal.timeout(2000) },
		);
		const row = (await read.json()).result.messages.find(
			(m: { id: string }) => m.id === "bcm_1",
		);
		expect(row.reactions.map((r: { emoji: string }) => r.emoji)).toEqual([
			"\u{1F440}",
			THUMBS,
		]);
	});

	it("tap another's: +1 and mine; again: back; my sole one: gone (PUT body / DELETE query)", async () => {
		const w = await world("reactions");
		await w.poll();
		expect(await w.bridge.actions.toggleReaction(target("bcm_3"), THUMBS)).toBe(
			"added",
		);
		expect(w.held("bcm_3")?.[0]).toMatchObject({
			count: 3,
			reacted_by_me: true,
		});
		expect(await w.bridge.actions.toggleReaction(target("bcm_3"), THUMBS)).toBe(
			"removed",
		);
		expect(w.held("bcm_3")?.[0]).toMatchObject({
			count: 2,
			reacted_by_me: false,
		});
		expect(await w.bridge.actions.toggleReaction(target("bcm_3"), PARTY)).toBe(
			"removed",
		);
		expect(w.held("bcm_3")?.map((r) => r.emoji)).toEqual([THUMBS]);
		const writes = (await w.stats()).requests.filter((r) =>
			r.path.includes("/reactions/"),
		);
		expect(writes.map((r) => r.method)).toEqual(["PUT", "DELETE", "DELETE"]);
	});

	it("a double tap sends ONE write (the mock's own counter)", async () => {
		const w = await world("reactions");
		await w.poll();
		const [first, second] = await Promise.all([
			w.bridge.actions.toggleReaction(target("bcm_3"), THUMBS),
			w.bridge.actions.toggleReaction(target("bcm_3"), THUMBS),
		]);
		expect([first, second]).toEqual(["added", "ignored"]);
		expect((await w.stats()).reactionWrites).toEqual({ put: 1, delete: 0 });
	});

	it("a forced 500 restores the exact prior rows and marks the message failed", async () => {
		const w = await world("reactions_fail");
		await w.poll();
		const before = w.held("bcm_3");
		expect(await w.bridge.actions.toggleReaction(target("bcm_3"), THUMBS)).toBe(
			"failed",
		);
		expect(w.held("bcm_3")).toBe(before);
		const s = w.bridge.store.getState();
		expect(Object.keys(s.reactionFailed)).toEqual([`${TENANT}/${CONV}/bcm_3`]);
		expect(s.reactionPending).toEqual({});
	});

	it("a hub without the route (uncoded 404): reactions hidden, no error", async () => {
		const w = await world("reactions_unserved");
		await w.poll();
		expect(w.held("bcm_3")).toBeUndefined();
		expect(await w.bridge.actions.toggleReaction(target("bcm_3"), THUMBS)).toBe(
			"unserved",
		);
		const s = w.bridge.store.getState();
		expect(s.reactionsUnserved).toBe(true);
		expect(s.reactionFailed).toEqual({});
		// Nothing more is sent once the route is known to be missing.
		await w.bridge.actions.toggleReaction(target("bcm_3"), PARTY);
		expect(
			(await w.stats()).requests.filter((r) => r.path.includes("/reactions/")),
		).toHaveLength(1);
	});
});

it("rejects a delayed pre-write HTTP history answer, then accepts a fresh poll and sends DELETE", async () => {
	let hold = false;
	let release!: () => void;
	let captured!: () => void;
	const snapshotReady = new Promise<void>((yes) => {
		captured = yes;
	});
	const released = new Promise<void>((yes) => {
		release = yes;
	});
	const w = await world("reactions", async (input, init) => {
		const response = await fetch(input, init);
		if (
			hold &&
			String(input).includes("/messages?") &&
			(!init?.method || init.method === "GET")
		) {
			hold = false;
			// Drain the actual HTTP answer BEFORE the write; only its delivery is delayed.
			const body = await response.text();
			captured();
			await released;
			return new Response(body, {
				status: response.status,
				headers: response.headers,
			});
		}
		return response;
	});
	await w.poll();
	hold = true;
	const oldPoll = w.poll();
	await snapshotReady;
	try {
		expect(await w.bridge.actions.toggleReaction(target("bcm_3"), THUMBS)).toBe(
			"added",
		);
	} finally {
		release();
	}
	await oldPoll;
	expect(w.held("bcm_3")?.find((r) => r.emoji === THUMBS)?.reacted_by_me).toBe(
		true,
	);
	expect(await w.bridge.actions.toggleReaction(target("bcm_3"), THUMBS)).toBe(
		"removed",
	);
	expect(
		(await w.stats()).requests
			.filter((r) => r.path.includes("/reactions/"))
			.map((r) => r.method),
	).toEqual(["PUT", "DELETE"]);
	await w.desktop("PUT", "bcm_3", THUMBS);
	await w.poll();
	expect(w.held("bcm_3")?.find((r) => r.emoji === THUMBS)?.reacted_by_me).toBe(
		true,
	);
});

it("honours a real HTTP 429 Retry-After across messages without optimistic leaks", async () => {
	let now = 1000;
	const methods: string[] = [];
	const statuses: number[] = [];
	const server = createServer((request, response) => {
		request.resume();
		methods.push(request.method ?? "");
		const status = methods.length === 1 ? 429 : 200;
		statuses.push(status);
		response.writeHead(status, {
			"content-type": "application/json",
			...(status === 429 ? { "Retry-After": "60" } : {}),
		});
		response.end(
			JSON.stringify(
				status === 429
					? { error: "Rate limited", code: "rate_limited" }
					: {
							result: {
								message_id: "bcm_1",
								reactions: [
									{
										emoji: THUMBS,
										count: 1,
										reacted_by_me: true,
										sample_labels: [],
									},
								],
							},
						},
			),
		);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	rigs.push({
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((yes, no) =>
				server.close((error) => (error ? no(error) : yes())),
			);
		},
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing fixture address");
	const accessToken = async () => TEAM_BRIDGE_FIXTURE_TOKEN;
	const hub = createHubClient({
		baseUrl: `http://127.0.0.1:${address.port}`,
		accessToken,
	});
	const bridge = createTeamBridgeStore({
		hub: () => hub,
		accessToken,
		now: () => now,
	});
	expect(await bridge.actions.toggleReaction(target("bcm_1"), THUMBS)).toBe(
		"failed",
	);
	const before = bridge.store.getState();
	expect(before.reactionPending).toEqual({});
	expect(await bridge.actions.toggleReaction(target("bcm_3"), PARTY)).toBe(
		"ignored",
	);
	expect(bridge.store.getState()).toBe(before);
	now += 59999;
	expect(await bridge.actions.toggleReaction(target("bcm_1"), THUMBS)).toBe(
		"ignored",
	);
	expect(methods).toEqual(["PUT"]);
	now += 2;
	expect(await bridge.actions.toggleReaction(target("bcm_1"), THUMBS)).toBe(
		"added",
	);
	expect(statuses).toEqual([429, 200]);
	expect(methods).toEqual(["PUT", "PUT"]);
	expect(bridge.store.getState().reactionPending).toEqual({});
});
