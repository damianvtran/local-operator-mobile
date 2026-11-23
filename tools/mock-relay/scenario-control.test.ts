/**
 * The mock relay's CONTROL surface, asserted on the wire — and the one state it
 * exists to make reachable.
 *
 * Two findings from review round 4 live here:
 *
 * 1. `POST /__mock/scenario` validated the scenario before it validated the
 *    language, so `{scenario: "loading", language: 42}` applied the scenario and
 *    took the pin, and only then answered 400. A rejected request that changes
 *    state is a rig's problem to clean up by hand, and it makes "the request
 *    failed" and "the world is as I left it" two different claims. The control
 *    now validates everything before it moves anything; this test pins that.
 * 2. The entry head line's forward-looking arm (`mobile.schedules.head.next`) was
 *    unreachable from `schedules-populated`, because that capture is dated in the
 *    past and every instant in it is now overdue. `schedules-future` rebases the
 *    capture's own clock onto now; this test proves the wire it serves really is
 *    ahead, which is what makes the arm renderable rather than hypothetical.
 *
 * What this file does NOT prove: that the app renders `· next …` from such an
 * answer. That is the surface's own reading and it is asserted in
 * `src/e2e/schedules.e2e.test.ts`, through the real client.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionProjection } from "../../src/contracts";
import { RelayEndpoints, RelayHttpClient } from "../../src/relay";
import { createRelay, DEFAULT_PASSWORD } from "./relay.ts";

interface ScheduleListing {
	wakes: {
		entries: {
			session_id: string;
			dormant: boolean;
			ghost: boolean;
			next_due_at: number | null;
			schedules: { next_due_at: number | null }[];
		}[];
		generated_at: number;
	};
}

interface MockState {
	scenario: string;
	language: string;
}

const rigs: ReturnType<typeof createRelay>[] = [];

async function start(scenario = "idle") {
	const relay = createRelay({ scenario, quiet: true });
	rigs.push(relay);
	const { url } = await relay.listen({ port: 0 });
	const login = await fetch(`${url}/login`, {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `password=${encodeURIComponent(DEFAULT_PASSWORD)}`,
	});
	const cookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
	return {
		url,
		cookie,
		request: (path: string, body?: unknown): Promise<Response> =>
			fetch(`${url}${path}`, {
				method: body === undefined ? "GET" : "POST",
				redirect: "manual",
				signal: AbortSignal.timeout(2500),
				headers: { cookie, "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
	};
}

afterEach(async () => {
	await Promise.all(rigs.splice(0).map((relay) => relay.shutdown()));
});

describe("the scenario control validates before it applies", () => {
	it("answers 400 for a bad language and leaves the world untouched", async () => {
		const rig = await start();
		const before = (await (
			await rig.request("/__mock/state")
		).json()) as MockState;
		expect(before).toMatchObject({ scenario: "idle", language: "en" });

		/* A NON-STRING tag is the request the old order accepted half of: the
		 * scenario and the pin were applied, then the answer was 400. */
		const rejected = await rig.request("/__mock/scenario", {
			scenario: "loading",
			language: 42,
		});
		expect(rejected.status).toBe(400);
		const failure = (await rejected.json()) as { error?: string };
		expect(failure.error).toContain("language must be a string tag");

		/* Nothing moved: not the scenario, not the language, and the pin did not
		 * change hands — a second client could still take this world without
		 * waiting out the contention window. */
		const after = (await (
			await rig.request("/__mock/state")
		).json()) as MockState;
		expect(after.scenario).toBe(before.scenario);
		expect(after.language).toBe(before.language);

		/* And the control still works when the request IS whole. */
		const accepted = await rig.request("/__mock/scenario", {
			scenario: "loading",
			language: "fr",
		});
		expect(accepted.status).toBe(200);
		const applied = (await (
			await rig.request("/__mock/state")
		).json()) as MockState;
		expect(applied).toMatchObject({ scenario: "loading", language: "fr" });
	});

	it("still refuses an unknown scenario without changing the language", async () => {
		const rig = await start();
		const rejected = await rig.request("/__mock/scenario", {
			scenario: "no-such-state",
			language: "fr",
		});
		expect(rejected.status).toBe(400);
		const after = (await (
			await rig.request("/__mock/state")
		).json()) as MockState;
		expect(after).toMatchObject({ scenario: "idle", language: "en" });
	});
});

describe("schedules-future makes the forward-looking instant reachable", () => {
	it("serves the populated capture with its clock ahead of the reader", async () => {
		const rig = await start();
		const pinned = await rig.request("/__mock/scenario", {
			scenario: "schedules-future",
		});
		expect(pinned.status).toBe(200);

		const listing = (await (
			await rig.request("/api/schedules")
		).json()) as ScheduleListing;
		const now = Date.now();

		/* The capture's own shape survived the shift: three conversations, and the
		 * capture clock now reads as this run. */
		expect(listing.wakes.entries).toHaveLength(3);
		expect(listing.wakes.generated_at).toBeGreaterThan(now - 60_000);
		expect(listing.wakes.generated_at).toBeLessThan(now + 60_000);

		/* THE ARM THIS SCENARIO EXISTS FOR: the one live entry's soonest instant is
		 * AHEAD of the reader, so `mobile.schedules.head.next` renders instead of the
		 * `… overdue` clause every instant of `schedules-populated` produces today. */
		const live = listing.wakes.entries.filter(
			(entry) => !entry.dormant && !entry.ghost,
		);
		expect(live).toHaveLength(1);
		const soonest = live[0]?.next_due_at ?? 0;
		expect(soonest).toBeGreaterThan(now);

		/* WHAT REMAINS IS COHERENT: the gap from the capture clock is the fixture's
		 * own 3600 s, its one row is the same instant, and no stale or overdue row was
		 * carried into a future-dated frame (a stale wake cannot be ahead). */
		expect(Math.round((soonest - listing.wakes.generated_at) / 1000)).toBe(
			3600,
		);
		const rows = live[0]?.schedules ?? [];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.next_due_at).toBe(soonest);
	});
});

it("serves the same scoped chart sidecars on seed and ordinary admission over one negotiated stream", async () => {
	const { url, cookie } = await start("inline-charts");
	const endpoints = new RelayEndpoints(
		new RelayHttpClient({
			baseUrl: url,
			auth: () => ({ cookie, origin: null, credentials: "omit" }),
		}),
	);
	const sessionId = "6714def86197";
	const collect = (inlineUi: boolean) => {
		const frames: SessionProjection[] = [];
		const { connection } = endpoints.sessionStream(sessionId, {
			inlineUi,
			onFrame(frame) {
				if (frame.kind === "projection") frames.push(frame.data);
			},
		});
		return { frames, connection };
	};
	const rich = collect(true);
	const legacy = collect(false);
	rich.connection.start();
	legacy.connection.start();
	try {
		await vi.waitFor(() => {
			expect(rich.frames).toHaveLength(1);
			expect(legacy.frames).toHaveLength(1);
		});
		const seed = rich.frames[0];
		const overlay = seed?.inline_ui as { messages?: object } | undefined;
		expect(Object.keys(overlay?.messages ?? {})).toHaveLength(10);
		expect(legacy.frames[0]?.inline_ui).toBeUndefined();
		const text = "ordinary chart fixture admission";
		expect(
			await endpoints.command(sessionId, {
				op: "prompt",
				command_id: "00000000-0000-4000-8000-000000000376",
				text,
			}),
		).toMatchObject({ ok: true });
		await vi.waitFor(() => {
			expect(rich.frames).toHaveLength(2);
			expect(legacy.frames).toHaveLength(2);
		});
		const update = rich.frames[1];
		expect(update?.version).toBeGreaterThan(seed?.version ?? 0);
		expect(update?.transcript.at(-1)).toMatchObject({ kind: "user", text });
		expect(legacy.frames[1]?.transcript).toEqual(update?.transcript);
		expect(update?.inline_ui).toEqual(seed?.inline_ui);
		expect(legacy.frames[1]?.inline_ui).toBeUndefined();
		const history = await endpoints.history(sessionId, { inlineUi: true });
		expect(history.inline_ui).toEqual(update?.inline_ui);
	} finally {
		rich.connection.stop();
		legacy.connection.stop();
	}
});
