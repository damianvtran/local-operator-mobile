/**
 * The mock relay's session list carries the daemon's real-shaped nulls, and the
 * app's own schema reads every row of it.
 *
 * WHY (TestFlight 628): the daemon sends `"effort": null` on a row with no
 * recorded rung and `{"degraded": [...]}` alone for the unread block of a
 * degraded listing. No mock row carried either, so a client schema that refused
 * both passed every mock-backed check and failed on the first real machine. This
 * file pins the mock to those shapes AND parses its answer with the shipping
 * schema, asserting no row is dropped — the per-row tolerance in
 * `sessionRowsSchema` must never be what lets a mock frame through.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionListFrameSchema } from "../../src/contracts/schemas.ts";
import { createRelay, DEFAULT_PASSWORD } from "./relay.ts";

const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
	while (stops.length > 0) await stops.pop()?.();
});

async function listFor(scenario: string): Promise<Record<string, unknown>> {
	const relay = createRelay({
		scenario,
		password: DEFAULT_PASSWORD,
		quiet: true,
	});
	const { url } = await relay.listen({ port: 0 });
	stops.push(() => relay.shutdown());
	const login = await fetch(new URL("/login", url), {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `password=${encodeURIComponent(DEFAULT_PASSWORD)}`,
	});
	const cookie = (login.headers.getSetCookie?.() ?? [])[0]?.split(";")[0];
	const response = await fetch(new URL("/api/sessions", url), {
		headers: cookie ? { cookie } : {},
	});
	expect(response.status).toBe(200);
	return (await response.json()) as Record<string, unknown>;
}

function parseAll(body: Record<string, unknown>) {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	try {
		const parsed = sessionListFrameSchema.safeParse(body);
		expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
		/* No row dropped: a mock frame must parse whole, row by row. */
		expect(warn).not.toHaveBeenCalled();
		return parsed;
	} finally {
		warn.mockRestore();
	}
}

describe("the mock relay's list rows wear the daemon's nulls", () => {
	it("sends effort/opened_by/agent_id/avatar_sha256 as null, and the app reads every row", async () => {
		const body = await listFor("degraded-attention");
		const rows = body.sessions as Record<string, unknown>[];
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			for (const key of ["opened_by", "agent_id", "avatar_sha256"]) {
				expect(row, key).toHaveProperty(key, null);
			}
			expect(row).toHaveProperty("effort");
		}
		expect(rows.some((row) => row.effort === null)).toBe(true);
		const parsed = parseAll(body);
		expect(parsed.data?.sessions).toHaveLength(rows.length);
	});

	it("answers a degraded listing's unread block with the degraded shape alone", async () => {
		for (const scenario of ["degraded-listing", "degraded-attention"]) {
			const body = await listFor(scenario);
			const unread = body.unread as Record<string, unknown>;
			expect(unread, scenario).not.toHaveProperty("revision");
			expect(unread, scenario).not.toHaveProperty("count");
			expect((unread.degraded as string[]).length, scenario).toBeGreaterThan(0);
			parseAll(body);
		}
	});
});
