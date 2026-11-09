import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
	createOwnedStreamCleanup,
	runCleanupStages,
	throwCleanupFailures,
} from "./avatar-capture-test-cleanup.ts";
import { createRelay } from "./relay.ts";
import { AGENT_AVATAR_SHAS, REMOVED_AVATAR_SHA } from "./scenarios.ts";

/** Mock-only capture controls must retain a selected response, not merely delay
 * route dispatch. Otherwise a late request can silently select the NEW picture
 * and a screenshot never exercises the stale-response privacy boundary.
 * No product imports: the first RED was a real
 * unsupported control response, not an unresolved module. See the scratch plan
 * supplied with this test for the proposed additive JSON contract. */
type Agent = "researcher" | "reviewer";
type Variant = Agent | "removed" | "none";
type Row = {
	session_id: string;
	agent_id?: string | null;
	avatar_sha256?: string | null;
};
type Listing = { sessions: Row[] };
type Barrier = {
	id: string;
	state: string;
	selected?: { status: number; sha256: string | null };
};
type Event = {
	seq: number;
	kind: string;
	barrierId?: string;
	sessionId?: string;
	agentId?: string | null;
	sha256?: string | null;
	status?: number;
};
type Evidence = { world: number; barriers: Barrier[]; events: Event[] };
type Reply = { status: number; sha256: string } | { closed: true };
const root = "/__mock/avatar-capture";
const oldSha = AGENT_AVATAR_SHAS.researcher;
const newSha = AGENT_AVATAR_SHAS.reviewer;
const avatar = (agent: Agent = "researcher", sha = oldSha) =>
	`/v1/agents/${agent}/avatar?v=${sha}`;
// The cleanup registry owns only close(), not the factory's full inferred shape.
// This capability boundary also prevents a recursive start/registry type cycle.
const rigs: { close(): Promise<void> }[] = [];

async function start() {
	const relay = createRelay({
		scenario: "agent-avatars",
		password: "fixture-only",
		quiet: true,
	});
	const { url } = await relay.listen({ host: "127.0.0.1", port: 0 });
	const controllers = new Set<AbortController>();
	const streamCleanup = createOwnedStreamCleanup();
	const pending = new Set<ReturnType<typeof httpRequest>>();
	const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
	const completions: Promise<unknown>[] = [];
	let cookie = "";
	let stopped = false;
	const request = (path: string, body?: unknown, authenticated = true) =>
		fetch(`${url}${path}`, {
			method: body === undefined ? "GET" : "POST",
			redirect: "manual",
			signal: AbortSignal.timeout(2500),
			headers: {
				"content-type": "application/json",
				...(authenticated ? { cookie } : {}),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	const evidence = async () => {
		const response = await request(root);
		expect(response.status).toBe(200);
		return (await response.json()) as Evidence;
	};
	const rig = {
		url,
		request,
		evidence,
		async arm(id = "old", extra: Record<string, unknown> = {}) {
			const response = await request(`${root}/barriers`, {
				id,
				agentId: "researcher",
				sha256: oldSha,
				timeoutMs: 2000,
				response: "selected",
				...extra,
			});
			expect(response.status).toBe(201);
		},
		async release(id = "old", outcome = "release") {
			return request(`${root}/barriers/${id}/release`, { outcome });
		},
		async update(sessionId: string, agentId: Agent | null, variant: Variant) {
			const response = await request(`${root}/metadata`, {
				sessionId,
				agentId,
				variant,
			});
			expect(response.status).toBe(200);
		},
		async listing() {
			const response = await request("/api/sessions");
			expect(response.status).toBe(200);
			return (await response.json()) as Listing;
		},
		async entered(id = "old") {
			await expect
				.poll(
					async () =>
						(await evidence()).barriers.find((row) => row.id === id)?.state,
				)
				.toBe("entered");
		},
		// Node's response callback fires at HEADERS, unlike a body-only probe. A
		// completed control receipt therefore cannot conceal leaked image headers.
		begin(path = avatar(), authenticated = true) {
			let headers = false;
			let resolveReply: (value: Reply) => void = () => {};
			let finished = false;
			let deadline: ReturnType<typeof setTimeout> | undefined;
			const done = new Promise<Reply>((resolve) => {
				resolveReply = resolve;
			});
			const settle = (value: Reply) => {
				if (finished) return;
				finished = true;
				clearTimeout(deadline);
				resolveReply(value);
			};
			const req = httpRequest(
				`${url}${path}`,
				{
					agent: false,
					headers: authenticated ? { cookie } : {},
				},
				(res) => {
					headers = true;
					const hash = createHash("sha256");
					res.on("data", (chunk: Buffer) => hash.update(chunk));
					res.once("end", () =>
						settle({
							status: res.statusCode ?? 0,
							sha256: hash.digest("hex"),
						}),
					);
					res.once("error", () => settle({ closed: true }));
					res.once("aborted", () => settle({ closed: true }));
				},
			);
			pending.add(req);
			req.once("error", () => settle({ closed: true }));
			req.once("close", () => {
				pending.delete(req);
				settle({ closed: true });
			});
			// An inactivity timeout can be renewed forever by trickled bytes. This
			// wall-clock deadline owns only this request, including its body read.
			deadline = setTimeout(() => {
				req.destroy();
				settle({ closed: true });
			}, 3000);
			req.end();
			completions.push(done);
			return { done, hasHeaders: () => headers, close: () => req.destroy() };
		},
		async stream() {
			const controller = new AbortController();
			controllers.add(controller);
			const openingTimer = setTimeout(() => controller.abort(), 2500);
			const response = await fetch(`${url}/api/sessions/events`, {
				headers: { cookie },
				signal: controller.signal,
			}).finally(() => clearTimeout(openingTimer));
			expect(response.status).toBe(200);
			const reader = response.body?.getReader();
			if (!reader) throw new Error("fixture SSE body absent");
			readers.add(reader);
			streamCleanup.register(reader, controller);
			const decoder = new TextDecoder();
			let buffer = "";
			return {
				async next(): Promise<Listing> {
					const timer = setTimeout(() => controller.abort(), 2500);
					try {
						for (;;) {
							const boundary = /\r?\n\r?\n/.exec(buffer);
							if (boundary?.index !== undefined) {
								const frame = buffer.slice(0, boundary.index);
								buffer = buffer.slice(boundary.index + boundary[0].length);
								if (!/^event: sessions$/m.test(frame.replaceAll("\r", "")))
									continue;
								const data = frame
									.split(/\r?\n/)
									.filter((line) => line.startsWith("data: "))
									.map((line) => line.slice(6))
									.join("\n");
								return JSON.parse(data) as Listing;
							}
							const chunk = await reader.read();
							if (chunk.done)
								throw new Error("fixture SSE ended before sessions frame");
							buffer += decoder.decode(chunk.value, { stream: true });
						}
					} finally {
						clearTimeout(timer);
					}
				},
			};
		},
		async close(): Promise<void> {
			const releases = await Promise.allSettled([
				runCleanupStages(
					stopped
						? []
						: [
								{
									stage: "release holds",
									run: async () => {
										const response = await request(root);
										if (response.status !== 200) {
											await response.arrayBuffer();
											return;
										}
										const snapshot = (await response.json()) as Evidence;
										const released = await Promise.allSettled(
											snapshot.barriers
												.filter((hold) => hold.state === "entered")
												.map(async (hold) => {
													const response = await rig.release(hold.id);
													await response.arrayBuffer();
												}),
										);
										if (
											released.some((result) => result.status === "rejected")
										) {
											throw new Error("release cleanup failed");
										}
									},
								},
							],
				),
			]);
			// All owner stages launch even when releasing holds failed. Only the
			// paired reader's exact deliberate retirement reason is normal closure.
			const owners = await Promise.allSettled([
				runCleanupStages([
					...Array.from(controllers, (controller) => ({
						stage: "abort stream" as const,
						run: () => streamCleanup.abort(controller),
					})),
					...Array.from(readers, (reader) => ({
						stage: "cancel reader" as const,
						run: () => streamCleanup.cancel(reader),
					})),
					...Array.from(pending, (req) => ({
						stage: "destroy request" as const,
						run: () => req.destroy(),
					})),
					{
						stage: "shutdown",
						run: async () => {
							if (!stopped) {
								await relay.shutdown();
								stopped = true;
							}
						},
					},
					{ stage: "request completions", run: () => Promise.all(completions) },
				]),
			]);
			throwCleanupFailures([...releases, ...owners]);
		},
		async shutdown(): Promise<void> {
			await relay.shutdown();
			stopped = true;
		},
	};
	// Register ownership before login assertions so setup failure also tears down.
	rigs.push(rig);
	const login = await fetch(`${url}/login`, {
		method: "POST",
		redirect: "manual",
		signal: AbortSignal.timeout(2500),
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: "password=fixture-only",
	});
	expect(login.status).toBe(303);
	cookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
	expect(Boolean(cookie)).toBe(true);
	await login.arrayBuffer();
	return rig;
}

afterEach(async () => {
	const results = await Promise.allSettled(
		rigs.splice(0).map((rig) => rig.close()),
	);
	throwCleanupFailures(results);
}, 15_000);

async function target(rig: Awaited<ReturnType<typeof start>>) {
	const row = (await rig.listing()).sessions.find(
		(item) => item.agent_id === "researcher" && item.avatar_sha256 === oldSha,
	);
	if (!row) throw new Error("known pictured fixture session absent");
	return row.session_id;
}

const rowFor = (listing: Listing, sid: string) =>
	listing.sessions.find((row) => row.session_id === sid);

describe("avatar capture controls over an owned loopback socket", () => {
	it("arms the additive selected-response control (first unsupported-route RED)", async () => {
		const rig = await start();
		await target(rig);
		await rig.arm();
		expect((await rig.evidence()).barriers).toMatchObject([
			{ id: "old", state: "armed" },
		]);
	});

	it("holds authenticated selection before headers, without blocking unrelated traffic", async () => {
		const rig = await start();
		await rig.arm();
		// /v1 is the existing browser audience: normal auth redirects, unlike
		// /api's JSON401. This must not consume the post-auth capture barrier.
		const unauthenticated = await rig.request(avatar(), undefined, false);
		expect(unauthenticated.status).toBe(303);
		expect(unauthenticated.headers.get("location")).toBe("/login");
		expect(await unauthenticated.text()).toBe("");
		expect((await rig.evidence()).barriers[0]?.state).toBe("armed");
		const held = rig.begin();
		await rig.entered();
		expect(held.hasHeaders()).toBe(false);
		expect((await rig.request("/api/models")).status).toBe(200);
		await rig.listing();
		expect((await rig.request(avatar("reviewer", newSha))).status).toBe(200);
		// Same agent, DIFFERENT requested digest must not consume or join the hold.
		expect((await rig.request(avatar("researcher", newSha))).status).toBe(200);
		const stream = await rig.stream();
		expect((await stream.next()).sessions.length).toBeGreaterThan(0);
		expect(held.hasHeaders()).toBe(false);
		expect((await rig.evidence()).barriers[0]?.selected).toEqual({
			status: 200,
			sha256: oldSha,
		});
		expect((await rig.release()).status).toBe(200);
		expect(await held.done).toEqual({ status: 200, sha256: oldSha });
		expect((await rig.release()).status).toBe(400);
	});

	it("publishes same-world metadata on the live list stream and releases OLD bytes", async () => {
		const rig = await start();
		const sid = await target(rig);
		const stream = await rig.stream();
		const initial = await stream.next();
		const ids = initial.sessions.map((row) => row.session_id);
		const sharedIds = initial.sessions
			.filter((row) => row.agent_id === "researcher")
			.map((row) => row.session_id);
		expect(sharedIds.length).toBeGreaterThan(1);
		await rig.arm();
		const held = rig.begin();
		await rig.entered();
		const before = await rig.evidence();
		await rig.update(sid, "researcher", "reviewer");
		const changed = await stream.next();
		expect(changed.sessions.map((row) => row.session_id)).toEqual(ids);
		for (const affectedId of sharedIds) {
			expect(rowFor(changed, affectedId)).toMatchObject({
				agent_id: "researcher",
				avatar_sha256: newSha,
			});
		}
		// A backing image is agent-scoped: even the fixture's formerly removed
		// reference must agree, not just the single row used to trigger the edit.
		expect(await rig.listing()).toEqual(changed);
		expect((await rig.evidence()).world).toBe(before.world);
		expect(held.hasHeaders()).toBe(false);
		expect(await rig.begin(avatar("researcher", newSha)).done).toEqual({
			status: 200,
			sha256: newSha,
		});
		expect((await rig.release()).status).toBe(200);
		expect(await held.done).toEqual({ status: 200, sha256: oldSha });
		await expect
			.poll(async () =>
				(await rig.evidence()).events.some(
					(event) => event.kind === "completed" && event.barrierId === "old",
				),
			)
			.toBe(true);
		const events = (await rig.evidence()).events;
		const selected = events.find(
			(event) => event.kind === "selected" && event.barrierId === "old",
		);
		const entered = events.find(
			(event) => event.kind === "entered" && event.barrierId === "old",
		);
		const published = events.find(
			(event) => event.kind === "metadata-published" && event.sessionId === sid,
		);
		const released = events.find(
			(event) => event.kind === "released" && event.barrierId === "old",
		);
		const completed = events.find(
			(event) => event.kind === "completed" && event.barrierId === "old",
		);
		expect(selected?.seq).toBeLessThan(entered?.seq ?? -1);
		expect(entered?.seq).toBeLessThan(published?.seq ?? -1);
		expect(published?.seq).toBeLessThan(released?.seq ?? -1);
		expect(released?.seq).toBeLessThan(completed?.seq ?? -1);
		expect(completed).toMatchObject({ status: 200, sha256: oldSha });
	});

	it("changes known agent/hash/null variants coherently without replacing the world", async () => {
		const rig = await start();
		const sid = await target(rig);
		const stream = await rig.stream();
		await stream.next();
		for (const [agentId, variant, sha] of [
			["reviewer", "reviewer", newSha],
			["reviewer", "removed", REMOVED_AVATAR_SHA],
			["researcher", "none", null],
			[null, "none", null],
			["researcher", "researcher", oldSha],
		] as const) {
			await rig.update(sid, agentId, variant);
			expect(rowFor(await stream.next(), sid)).toMatchObject({
				agent_id: agentId,
				avatar_sha256: sha,
			});
			if (agentId) {
				const reply = await rig.begin(avatar(agentId, sha ?? oldSha)).done;
				if (sha === oldSha || sha === newSha) {
					expect(reply).toEqual({ status: 200, sha256: sha });
				} else expect(reply).toMatchObject({ status: 404 });
			}
		}
	});

	it("retains a selected 404 even when that same agent is restored", async () => {
		const rig = await start();
		const sid = await target(rig);
		await rig.update(sid, "researcher", "removed");
		await rig.arm("removed", { sha256: REMOVED_AVATAR_SHA });
		const held = rig.begin(avatar("researcher", REMOVED_AVATAR_SHA));
		await rig.entered("removed");
		expect((await rig.evidence()).barriers[0]?.selected).toEqual({
			status: 404,
			sha256: null,
		});
		await rig.update(sid, "researcher", "researcher");
		expect((await rig.release("removed")).status).toBe(200);
		expect(await held.done).toMatchObject({ status: 404 });
		expect(await rig.begin().done).toEqual({ status: 200, sha256: oldSha });
	});

	it("scopes explicit auth/refusal samples to one selected avatar, never bypassing login", async () => {
		const rig = await start();
		for (const [response, status] of [
			["unauthorized", 401],
			["forbidden", 403],
			["refused", 503],
		] as const) {
			await rig.arm(response, { response });
			const unauthenticated = await rig.request(avatar(), undefined, false);
			expect(unauthenticated.status).toBe(303);
			expect(unauthenticated.headers.get("location")).toBe("/login");
			expect(await unauthenticated.text()).toBe("");
			expect(
				(await rig.evidence()).barriers.find((row) => row.id === response)
					?.state,
			).toBe("armed");
			const held = rig.begin();
			await rig.entered(response);
			expect(held.hasHeaders()).toBe(false);
			expect((await rig.request("/api/models")).status).toBe(200);
			expect((await rig.release(response)).status).toBe(200);
			expect(await held.done).toMatchObject({ status });
			expect(await rig.begin().done).toEqual({ status: 200, sha256: oldSha });
		}
	});

	it("cancels client-close holds and rejects release before entry or unknown outcomes", async () => {
		const rig = await start();
		await rig.arm();
		expect((await rig.release()).status).toBe(400);
		const held = rig.begin();
		await rig.entered();
		expect((await rig.release("old", "surprise")).status).toBe(400);
		expect((await rig.request(`${root}/barriers/old/release`, {})).status).toBe(
			400,
		);
		expect(held.hasHeaders()).toBe(false);
		held.close();
		expect(await held.done).toEqual({ closed: true });
		await expect
			.poll(async () => (await rig.evidence()).barriers[0]?.state)
			.toBe("cancelled");
		expect((await rig.release()).status).toBe(400);
	});

	it("expires a bounded hold with 504 and cannot later release its image", async () => {
		const rig = await start();
		await rig.arm("expiry", { timeoutMs: 500 });
		const held = rig.begin();
		await rig.entered("expiry");
		expect(await held.done).toMatchObject({ status: 504 });
		expect((await rig.evidence()).barriers[0]?.state).toBe("expired");
		expect((await rig.release("expiry")).status).toBe(400);
		expect(await rig.begin().done).toEqual({ status: 200, sha256: oldSha });
	});

	it("reset cancels the old socket and timers before a successor world reuses the ID", async () => {
		const rig = await start();
		const sid = await target(rig);
		await rig.arm("old", { timeoutMs: 500 });
		const held = rig.begin();
		await rig.entered();
		const world = (await rig.evidence()).world;
		await rig.update(sid, "researcher", "reviewer");
		expect((await rig.request("/__mock/reset", {})).status).toBe(200);
		expect(await held.done).toEqual({ closed: true });
		expect((await rig.evidence()).world).toBeGreaterThan(world);
		expect((await rig.release()).status).toBe(400);
		expect(rowFor(await rig.listing(), sid)).toMatchObject({
			avatar_sha256: oldSha,
		});
		await rig.arm();
		const successor = rig.begin();
		await rig.entered();
		// Wait past the predecessor deadline: its timer must not act on a reused ID.
		await new Promise((resolve) => setTimeout(resolve, 550));
		expect(successor.hasHeaders()).toBe(false);
		expect((await rig.evidence()).barriers[0]?.state).toBe("entered");
		expect((await rig.release()).status).toBe(200);
		expect(await successor.done).toEqual({ status: 200, sha256: oldSha });
	});

	it("shutdown closes the held request and refuses a new connection", async () => {
		const rig = await start();
		await rig.arm();
		const held = rig.begin();
		await rig.entered();
		await rig.shutdown();
		expect(await held.done).toEqual({ closed: true });
		// begin uses agent:false, so this is a fresh connection rather than a
		// pooled keep-alive probe. This does not claim server.close's callback ran.
		expect(await rig.begin("/api/sessions").done).toEqual({ closed: true });
	}, 8000);

	it("rejects malformed/unknown controls atomically, duplicates and finite capacity overflow", async () => {
		const rig = await start();
		const sid = await target(rig);
		const before = await rig.listing();
		const validMetadata = {
			sessionId: sid,
			agentId: "researcher",
			variant: "reviewer",
		};
		for (const field of Object.keys(validMetadata)) {
			const missing: Record<string, unknown> = { ...validMetadata };
			delete missing[field];
			expect((await rig.request(`${root}/metadata`, missing)).status).toBe(400);
		}
		for (const body of [
			{ sessionId: "unknown", agentId: "researcher", variant: "researcher" },
			{ sessionId: sid, agentId: "unknown", variant: "researcher" },
			{ sessionId: sid, agentId: null, variant: "researcher" },
			{ sessionId: sid, agentId: "researcher", variant: "unknown" },
			{
				sessionId: sid,
				agentId: "researcher",
				variant: "reviewer",
				sha256: "bad",
			},
			{
				sessionId: sid,
				agentId: "researcher",
				variant: "reviewer",
				body: "forbidden-input",
			},
			null,
			[],
			{ sessionId: 42 },
		])
			expect((await rig.request(`${root}/metadata`, body)).status).toBe(400);
		expect(await rig.listing()).toEqual(before);
		const valid = {
			id: "invalid",
			agentId: "researcher",
			sha256: oldSha,
			timeoutMs: 2000,
			response: "selected",
		};
		for (const field of Object.keys(valid)) {
			const missing: Record<string, unknown> = { ...valid };
			delete missing[field];
			expect((await rig.request(`${root}/barriers`, missing)).status).toBe(400);
		}
		for (const patch of [
			{ id: "../escape" },
			{ agentId: "unknown" },
			{ sha256: "bad" },
			{ sha256: "f".repeat(64) },
			{ timeoutMs: 0 },
			{ timeoutMs: 30_001 },
			{ timeoutMs: 1.5 },
			{ response: "unknown" },
			{ path: "/api/models" },
			{ headers: { "x-fixture": "forbidden-input" } },
			{ body: "forbidden-input" },
		])
			expect(
				(await rig.request(`${root}/barriers`, { ...valid, ...patch })).status,
			).toBe(400);
		expect((await rig.evidence()).barriers).toEqual([]);
		await rig.arm();
		expect(
			(await rig.request(`${root}/barriers`, { ...valid, id: "old" })).status,
		).toBe(400);
		for (let n = 1; n < 16; n++) await rig.arm(`capacity-${n}`);
		expect(
			(await rig.request(`${root}/barriers`, { ...valid, id: "overflow" }))
				.status,
		).toBe(400);
		expect((await rig.evidence()).barriers).toHaveLength(16);
		// This is deliberately NOT an extension of startup's generic path matcher.
		expect(
			(
				await rig.request("/__mock/barriers", {
					id: "legacy-avatar",
					point: "avatar",
					path: avatar(),
				})
			).status,
		).toBe(400);
		expect(
			(
				await rig.request("/__mock/barriers", {
					id: "legacy",
					point: "config",
					path: "/api/models",
				})
			).status,
		).toBe(201);
	});

	it("accepts both timeout endpoints without a long-lived timer escaping teardown", async () => {
		const rig = await start();
		await rig.arm("minimum", { timeoutMs: 1 });
		await expect
			.poll(
				async () =>
					(await rig.evidence()).barriers.find((row) => row.id === "minimum")
						?.state,
			)
			.toBe("expired");
		await rig.arm("maximum", { timeoutMs: 30_000 });
		const held = rig.begin();
		await rig.entered("maximum");
		expect(held.hasHeaders()).toBe(false);
		expect((await rig.release("maximum")).status).toBe(200);
		expect(await held.done).toEqual({ status: 200, sha256: oldSha });
	});

	it("consumes distinct same-key barriers FIFO without coupling their releases", async () => {
		const rig = await start();
		await rig.arm("first");
		await rig.arm("second");
		const first = rig.begin();
		await rig.entered("first");
		expect(
			(await rig.evidence()).barriers.find((row) => row.id === "second")?.state,
		).toBe("armed");
		const second = rig.begin();
		await rig.entered("second");
		expect(first.hasHeaders()).toBe(false);
		expect(second.hasHeaders()).toBe(false);
		expect((await rig.release("second")).status).toBe(200);
		expect(await second.done).toEqual({ status: 200, sha256: oldSha });
		expect(first.hasHeaders()).toBe(false);
		expect((await rig.release("first")).status).toBe(200);
		expect(await first.done).toEqual({ status: 200, sha256: oldSha });
	});

	it("truncates metadata evidence to the latest 128 ordered events without leaking payloads", async () => {
		const rig = await start();
		const sid = await target(rig);
		await rig.arm();
		const held = rig.begin();
		await rig.entered();
		await rig.update(sid, null, "none");
		expect((await rig.release()).status).toBe(200);
		expect(await held.done).toEqual({ status: 200, sha256: oldSha });
		await expect
			.poll(async () =>
				(await rig.evidence()).events.some(
					(event) => event.kind === "completed" && event.barrierId === "old",
				),
			)
			.toBe(true);
		const before = await rig.evidence();
		const priorLast = before.events.at(-1)?.seq;
		expect(priorLast).toBeDefined();
		// Cross the cap with real control events. A short happy-path sample would
		// pass even if the implementation retained an unbounded array forever.
		const deadline = Date.now() + 8000;
		for (let index = 0; index < 130; index++) {
			if (Date.now() >= deadline)
				throw new Error("fixture metadata flood deadline");
			await rig.update(
				sid,
				"researcher",
				index % 2 ? "reviewer" : "researcher",
			);
		}
		const evidence = await rig.evidence();
		expect(evidence.events).toHaveLength(128);
		expect(evidence.events[0]?.seq).toBe((priorLast ?? 0) + 3);
		expect(evidence.events.at(-1)?.seq).toBe((priorLast ?? 0) + 130);
		for (let index = 0; index < evidence.events.length; index++) {
			const event = evidence.events[index];
			expect(event).toMatchObject({
				kind: "metadata-published",
				sessionId: sid,
			});
			if (index > 0)
				expect(event?.seq).toBe((evidence.events[index - 1]?.seq ?? -1) + 1);
		}
		for (const event of evidence.events) {
			expect(
				Object.keys(event).every((key) =>
					[
						"seq",
						"kind",
						"barrierId",
						"sessionId",
						"agentId",
						"sha256",
						"status",
					].includes(key),
				),
			).toBe(true);
		}
		for (const barrier of evidence.barriers) {
			expect(
				Object.keys(barrier).every((key) =>
					[
						"id",
						"agentId",
						"sha256",
						"timeoutMs",
						"response",
						"state",
						"selected",
					].includes(key),
				),
			).toBe(true);
			if (barrier.selected) {
				expect(Object.keys(barrier.selected).sort()).toEqual([
					"sha256",
					"status",
				]);
			}
		}
		const serialized = JSON.stringify(evidence);
		// Boolean assertions avoid echoing a sensitive response if the guard fails.
		expect(
			/fixture-only|data:image|base64|iVBOR|cookie|authorization|password|prompt|data_b64/i.test(
				serialized,
			),
		).toBe(false);
	}, 15_000);
});

describe("avatar fixture cleanup ownership", () => {
	it("accepts only the paired reader's exact deliberate retirement reason", async () => {
		const cleanup = createOwnedStreamCleanup();
		const controller = new AbortController();
		const reader = {
			cancel: async () => {
				throw controller.signal.reason;
			},
		};
		cleanup.register(reader, controller);
		cleanup.abort(controller);
		expect(controller.signal.reason.name).toBe("AbortError");
		await expect(cleanup.cancel(reader)).resolves.toBeUndefined();
	});

	it("rejects another reader's reason even when both controllers were retired", async () => {
		const cleanup = createOwnedStreamCleanup();
		const first = new AbortController();
		const second = new AbortController();
		const firstReader = { cancel: async () => {} };
		const secondReader = {
			cancel: async () => {
				throw first.signal.reason;
			},
		};
		cleanup.register(firstReader, first);
		cleanup.register(secondReader, second);
		cleanup.abort(first);
		cleanup.abort(second);
		expect(first.signal.reason === second.signal.reason).toBe(false);
		await expect(cleanup.cancel(secondReader)).rejects.toBe(
			first.signal.reason,
		);
	});

	it("rejects a same-name AbortError with a different identity", async () => {
		const cleanup = createOwnedStreamCleanup();
		const controller = new AbortController();
		const other = new DOMException("fixture stream retired", "AbortError");
		const reader = {
			cancel: async () => {
				throw other;
			},
		};
		cleanup.register(reader, controller);
		cleanup.abort(controller);
		await expect(cleanup.cancel(reader)).rejects.toBe(other);
	});

	it("preserves a prior timeout instead of replacing it with retirement", async () => {
		const cleanup = createOwnedStreamCleanup();
		const controller = new AbortController();
		const timeout = new DOMException("fixture timeout", "TimeoutError");
		const reader = {
			cancel: async () => {
				throw timeout;
			},
		};
		cleanup.register(reader, controller);
		controller.abort(timeout);
		cleanup.abort(controller);
		expect(controller.signal.reason === timeout).toBe(true);
		await expect(cleanup.cancel(reader)).rejects.toBe(timeout);
	});

	it("preserves unrelated network errors after deliberate retirement", async () => {
		const cleanup = createOwnedStreamCleanup();
		const controller = new AbortController();
		const network = new TypeError("synthetic network failure");
		const reader = {
			cancel: async () => {
				throw network;
			},
		};
		cleanup.register(reader, controller);
		cleanup.abort(controller);
		await expect(cleanup.cancel(reader)).rejects.toBe(network);
	});

	it("rejects AbortError from a reader whose controller was never aborted", async () => {
		const cleanup = createOwnedStreamCleanup();
		const controller = new AbortController();
		const failure = new DOMException("synthetic read failure", "AbortError");
		const reader = {
			cancel: async () => {
				throw failure;
			},
		};
		cleanup.register(reader, controller);
		await expect(cleanup.cancel(reader)).rejects.toBe(failure);
		expect(controller.signal.aborted).toBe(false);
	});

	it("preserves safe stage/type codes through all rigs while attempting every owner", async () => {
		const cleanup = createOwnedStreamCleanup();
		const controller = new AbortController();
		const reader = {
			cancel: async () => {
				throw controller.signal.reason;
			},
		};
		cleanup.register(reader, controller);
		cleanup.abort(controller);
		const attempted: string[] = [];
		const results = await Promise.allSettled([
			runCleanupStages([
				{
					stage: "cancel reader",
					run: async () => {
						attempted.push("reader");
						await cleanup.cancel(reader);
					},
				},
				{
					stage: "shutdown",
					run: () => {
						attempted.push("shutdown");
						// Even the owned reason is NOT normal outside paired cancel().
						throw controller.signal.reason;
					},
				},
				{
					stage: "destroy request",
					run: () => {
						attempted.push("request");
					},
				},
				{
					stage: "request completions",
					run: () => {
						attempted.push("completions");
						throw new TypeError("synthetic private detail must not escape");
					},
				},
			]),
			runCleanupStages([
				{
					stage: "shutdown",
					run: () => {
						attempted.push("other rig");
					},
				},
			]),
		]);
		expect(attempted.sort()).toEqual([
			"completions",
			"other rig",
			"reader",
			"request",
			"shutdown",
		]);
		expect(() => throwCleanupFailures(results)).toThrow(
			"fixture cleanup failed: shutdown/AbortError, request completions/TypeError",
		);
		// Re-aggregation must retain only codes, not the original private message.
		const outer = await Promise.allSettled([
			Promise.resolve().then(() => throwCleanupFailures(results)),
		]);
		expect(outer[0]).toMatchObject({
			status: "rejected",
			reason: {
				message:
					"fixture cleanup failed: shutdown/AbortError, request completions/TypeError",
			},
		});
		if (outer[0]?.status === "rejected") {
			expect(Object.hasOwn(outer[0].reason, "cause")).toBe(false);
			expect(JSON.stringify(outer[0].reason).includes("synthetic")).toBe(false);
		}
		expect(() => throwCleanupFailures(outer)).toThrow(
			"fixture cleanup failed: shutdown/AbortError, request completions/TypeError",
		);
	});

	it("bounds a stuck owner and reports its deadline after attempting remaining owners", async () => {
		let attempted = false;
		const results = await Promise.allSettled([
			runCleanupStages(
				[
					{ stage: "cancel reader", run: () => new Promise<void>(() => {}) },
					{
						stage: "shutdown",
						run: () => {
							attempted = true;
						},
					},
				],
				1,
			),
		]);
		expect(attempted).toBe(true);
		expect(() => throwCleanupFailures(results)).toThrow(
			"fixture cleanup failed: cancel reader/Deadline",
		);
	});
});
