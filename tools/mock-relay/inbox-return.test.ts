import { afterEach, describe, expect, it } from "vitest";

import { createRelay, DEFAULT_PASSWORD } from "./relay.ts";

/**
 * The one-shot list-read refusal behind the inbox return proof.
 *
 * WHY IT IS A CONTROL ROUTE AND NOT A `--fault`: the capture's failure cell needs
 * exactly ONE refused `GET /api/notifications` at a moment the flow chooses, and
 * every persistent fault in `faults.ts` refuses every request until it is cleared.
 * A gateway fault there would have poisoned the fixture bootstrap, the login and
 * the control calls the same run makes afterwards. This is the smallest thing that
 * can be wrong in the right way: the next list read fails, everything else is
 * untouched, and the failure cannot outlive the read that consumed it.
 *
 * These cases run against the real socket, because the property under test is
 * which requests the relay refuses — a canned answer would prove nothing about
 * the route table.
 */

const rigs: ReturnType<typeof createRelay>[] = [];

async function start() {
	const relay = createRelay({ scenario: "idle", quiet: true });
	rigs.push(relay);
	const { url } = await relay.listen({ port: 0 });
	const login = await fetch(`${url}/login`, {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `password=${encodeURIComponent(DEFAULT_PASSWORD)}`,
	});
	const cookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
	const get = (path: string) =>
		fetch(`${url}${path}`, {
			redirect: "manual",
			signal: AbortSignal.timeout(2500),
			headers: { cookie },
		});
	const control = (path: string) =>
		fetch(`${url}${path}`, {
			method: "POST",
			signal: AbortSignal.timeout(2500),
			headers: { "x-lo-harness": "test-client" },
		});
	return { url, get, control };
}

afterEach(async () => {
	await Promise.all(rigs.splice(0).map((relay) => relay.shutdown()));
});

describe("the inbox return failure door", () => {
	it("refuses exactly the next list read, then serves server truth again", async () => {
		const rig = await start();
		const first = await rig.get("/api/notifications?state=all");
		expect(first.status).toBe(200);
		const held = (await first.json()) as { items: Array<{ id: string }> };
		expect(held.items.length).toBeGreaterThan(0);

		expect((await rig.control("/__mock/inbox-return")).status).toBe(200);
		/* The refusal is a real HTTP answer from this route, in the relay's own
		 * error shape, because that is what the client's refusal path parses. */
		const refused = await rig.get("/api/notifications?state=all");
		expect(refused.status).toBe(503);
		expect((await refused.json()) as { error?: string }).toMatchObject({
			error: expect.stringContaining("synthetic inbox return read failure"),
		});

		/* ONE SHOT: the very next read is answered from the store, so Try again is
		 * a real recovery rather than a second refusal. */
		const recovered = await rig.get("/api/notifications?state=all");
		expect(recovered.status).toBe(200);
		const back = (await recovered.json()) as { items: Array<{ id: string }> };
		expect(back.items.map((row) => row.id)).toEqual(
			held.items.map((row) => row.id),
		);
	});

	it("leaves every other route and every later control call untouched", async () => {
		const rig = await start();
		expect((await rig.control("/__mock/inbox-return")).status).toBe(200);
		/* The scoped refusal must not become a generic gateway outage: a run that
		 * armed it would otherwise lose its own fixture and control traffic. */
		expect((await rig.get("/api/sessions")).status).toBe(200);
		expect((await rig.get("/__mock/state")).status).toBe(200);
		/* A conversation-scoped read from the DETAIL must not consume the arm: the
		 * refusal exists for the list's own return read, and the detail walks the same
		 * route with `session_id`. */
		expect(
			(await rig.get("/api/notifications?state=all&session_id=s_0001")).status,
		).toBe(200);
		expect((await rig.get("/api/notifications?state=unread")).status).toBe(503);
		expect((await rig.get("/api/notifications?state=unread")).status).toBe(200);
	});

	it("records the refused read and the recovered read, so a proof can cite them", async () => {
		const rig = await start();
		await rig.get("/api/notifications?state=all");
		await rig.control("/__mock/inbox-return");
		const before = (await (await rig.get("/__mock/record")).json()) as {
			requests?: unknown[];
		};
		/* The ledger is OFF until a proof arms it: an ordinary matrix run must not
		 * grow an array of every request it serves. */
		expect(before.requests).toEqual([]);
		await rig.get("/api/notifications?state=all");
		await rig.get("/api/notifications?state=all");
		const after = (await (await rig.get("/__mock/record")).json()) as {
			requests: Array<{ path: string; status: number }>;
		};
		expect(
			after.requests
				.filter((row) => row.path.startsWith("/api/notifications"))
				.map((row) => row.status),
		).toEqual([503, 200]);
	});
});
