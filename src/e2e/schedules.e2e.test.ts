/**
 * The armed index's wire, outside-in: the app's REAL client against a REAL
 * server, and the SURFACE's own state machine reading the answer.
 *
 * Three facts no unit test can hold on its own:
 *
 * 1. The captured `GET /api/schedules` bodies parse through the real HTTP stack
 *    into the rows the Schedules screen renders — the populated capture first,
 *    field for field, including the dormant/ghost flags and the supervisor
 *    block a surface must not re-derive.
 * 2. **A `read_error` payload can never render as "nothing is armed."** The
 *    capture that proves the wire keeps the distinction (`wakes.read_error`
 *    true, the monitors half readable) is fed through the client and then
 *    through `familyState`/`schedulesEmpty` — the exact functions the screen
 *    renders from — and the answer checked is the state machine's: `unreadable`,
 *    never `empty`.
 * 3. A payload that is not the contract is REFUSED at the boundary
 *    (`malformed-frame`), not defaulted into an empty list — the second way a
 *    broken read could masquerade as "nothing armed".
 *
 * The server is this test's own, the `asks.e2e.test.ts`/`deadline` shape: the
 * payloads are the committed captures under `fixtures/relay/`, served verbatim,
 * and what is asserted is what crossed the socket plus what the surface's own
 * reading makes of it.
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
import {
	familyState,
	schedulesEmpty,
	wakeEntryViews,
} from "../features/schedules/schedules-copy";
import { isRelayError } from "../relay";
import { loadFixture } from "../testing/fixtures";

interface Recorded {
	method: string;
	path: string;
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

/** A local server answering every request with one canned body. */
async function serve(status: number, body: unknown): Promise<string> {
	const server = createServer(
		(request: IncomingMessage, response: ServerResponse) => {
			recorded.push({ method: request.method ?? "", path: request.url ?? "" });
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
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

/** The captured body of a fixture, exactly as the relay sent it. */
function captured(rel: string): unknown {
	return loadFixture<{ body: unknown }>(`http/${rel}`).body;
}

describe("GET /api/schedules through the real stack", () => {
	it("parses the populated capture into the rows the screen renders", async () => {
		const baseUrl = await serve(200, captured("schedules-populated.json"));
		const client = clientFor(baseUrl);

		const answer = await client.schedules();
		expect(recorded[0]?.method).toBe("GET");
		expect(recorded[0]?.path).toBe("/api/schedules");

		/* The wake half: the three captured conversations — armed, dormant,
		 *  ghost — with the rows beneath them. */
		expect(answer.wakes.entries.length).toBeGreaterThanOrEqual(3);
		const dormant = answer.wakes.entries.find((entry) => entry.dormant);
		expect(dormant?.dormant).toBe(true);
		const ghost = answer.wakes.entries.find((entry) => entry.ghost);
		expect(ghost?.ghost).toBe(true);
		const armed = answer.wakes.entries.find(
			(entry) => !entry.dormant && !entry.ghost,
		);
		expect(armed?.schedules.length).toBeGreaterThan(0);
		expect(armed?.schedules[0]?.next_due_at).toBeTypeOf("number");

		/* The supervisor block is part of the wake listing and the surface
		 *  reads it rather than re-deriving "will these fire". */
		expect(answer.wakes.supervisor.supported).toBeTypeOf("boolean");
		expect(answer.wakes.supervisor.running).toBeTypeOf("boolean");

		/* The monitor half: every state word the capture carries survives the
		 *  boundary as itself. */
		const states = answer.monitors.entries.flatMap((entry) =>
			entry.monitors.map((row) => row.state),
		);
		expect(states).toEqual(
			expect.arrayContaining(["armed", "disabled", "expired", "dormant"]),
		);

		/* And the surface's own reading of the same answer: ready, derivable
		 *  into view rows, not empty. */
		expect(familyState(answer.wakes)).toBe("ready");
		expect(schedulesEmpty(answer)).toBe(false);
		const views = wakeEntryViews(answer.wakes, Date.now());
		expect(views.length).toBe(answer.wakes.entries.length);
	});
});

describe("an unreadable store is never an empty list", () => {
	it("keeps read_error through the stack, and the surface reads unreadable", async () => {
		const baseUrl = await serve(200, captured("schedules-read-error.json"));
		const client = clientFor(baseUrl);

		const answer = await client.schedules();
		/* The store's own flag, as the capture proves the route sends it. */
		expect(answer.wakes.read_error).toBe(true);
		expect(answer.wakes.entries).toEqual([]);
		/* The monitors half of the same capture IS readable — the flag is
		 *  per-family, which is what keeps the two claims apart on one screen. */
		expect(answer.monitors.read_error).toBe(false);

		/* THE ASSERTION THIS SURFACE EXISTS FOR: the state machine that drives
		 *  the screen answers `unreadable` — the branch that renders the strip —
		 *  and the double-empty predicate is false, so "Nothing is armed" can
		 *  never be painted over this payload. */
		expect(familyState(answer.wakes)).toBe("unreadable");
		expect(familyState(answer.wakes)).not.toBe("empty");
		expect(schedulesEmpty(answer)).toBe(false);
	});

	it("refuses a payload that only looks empty, rather than defaulting it", async () => {
		/* Half a document: the boundary must raise `malformed-frame` — the
		 *  second way a broken read could reach a screen as "nothing armed". */
		const baseUrl = await serve(200, { wakes: {} });
		const client = clientFor(baseUrl);

		let caught: unknown;
		try {
			await client.schedules();
		} catch (failure) {
			caught = failure;
		}
		expect(isRelayError(caught)).toBe(true);
		if (!isRelayError(caught)) return;
		expect(caught.kind).toBe("malformed-frame");
	});
});

/**
 * The head line's FORWARD branch — the one a past-dated capture cannot reach.
 *
 * Every instant in `schedules-populated` was captured on 2026-10-08, so the live
 * entry's head line reads `… overdue` today and `mobile.schedules.head.next`
 * renders on no frame a rig can pin (QA Q2). The mock's `schedules-future` state
 * exists for that and is asserted on the wire in
 * `tools/mock-relay/scenario-control.test.ts`; this test takes the same shape
 * through the REAL client and asks the SURFACE's own reading what it says, so
 * "the arm is renderable" is a rendered sentence rather than a scenario name.
 */
describe("the head line's forward clause", () => {
	interface ForwardBody {
		wakes: {
			entries: {
				dormant: boolean;
				ghost: boolean;
				next_due_at: number | null;
				schedules: { id: string; next_due_at: number; stale: boolean }[];
			}[];
		};
	}

	it("answers `· next …` while the reader is still before the instant", async () => {
		/* One `nowMs` builds the body and reads it, so the label cannot drift between
		 * the two halves of the assertion.
		 *
		 * THE BODY IS THE SHAPE `schedules-future` SERVES: the capture's own armed wake
		 * (`w-armed`, the row the fixture dates an hour out) dated four minutes ahead,
		 * with the stale and overdue rows dropped — a wake the supervisor has given up
		 * on cannot be due in the future, so a future-dated frame that carried one would
		 * put a flag and a clock in contradiction. The scenario's own construction is
		 * asserted on the WIRE in `tools/mock-relay/scenario-control.test.ts`; this test
		 * asks what the surface makes of such an answer. */
		const nowMs = Date.now();
		const body = structuredClone(
			captured("schedules-populated.json"),
		) as ForwardBody;
		const live = body.wakes.entries.find(
			(entry) => !entry.dormant && !entry.ghost,
		);
		expect(live).toBeDefined();
		if (live === undefined) return;
		live.schedules = live.schedules.filter((row) => row.id === "w-armed");
		expect(live.schedules).toHaveLength(1);
		for (const row of live.schedules) row.next_due_at = nowMs + 4 * 60_000;
		live.next_due_at = nowMs + 4 * 60_000;

		const answer = await clientFor(await serve(200, body)).schedules();
		const view = wakeEntryViews(answer.wakes, nowMs).find(
			(entry) => !entry.parked && !entry.ghost,
		);

		/* English spells it `{head} · next {label}` with the relative label `in 4m`. */
		expect(view?.clause).toBe("1 wake · next in 4m");
		expect(view?.rows[0]?.due).toBe("in 4m");

		/* And the branch is chosen by the CLOCK, not by the payload: read the same
		 * answer five minutes later and the clause has switched to the overdue one.
		 * The label is `60s`, not `1m`: the port of the CLI's formatter keeps SECONDS
		 * under 90 (`dueLabel`). */
		const later = wakeEntryViews(answer.wakes, nowMs + 5 * 60_000).find(
			(entry) => !entry.parked && !entry.ghost,
		);
		expect(later?.clause).toBe("1 wake · 60s overdue");
	});
});
