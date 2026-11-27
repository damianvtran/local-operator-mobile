import { describe, expect, it } from "vitest";

import { RelayEndpoints, RelayHttpClient } from "@/relay";
import { createGuardStore, GUARD_SEEDS } from "../../../tools/mock-relay/guard";
import { createGuardController } from "./guard-controller";

const ID = "req_EXAMPLE0001";

/**
 * The real phone client (RelayHttpClient + RelayEndpoints + the Guard
 * controller) against the mock twin over a fetch seam, so the settled-card path
 * is exercised through the code the app runs, not through a hand-built error.
 * Two shapes of "someone answered first" are covered (R1-3): the host's own
 * (the card is kept, a repeat answer is 409 `approval_decision_conflict`) and the
 * older one (the id is gone: 404 `approval_not_found`).
 */
const BASE = "https://synthetic-computer.example.invalid";
function phoneAgainst(seed: Parameters<typeof createGuardStore>[0]) {
	const s = createGuardStore(seed);
	/** What the twin answered, in order, so a test can see the status the phone met. */
	const replies: { path: string; status: number; code?: string }[] = [];
	const http = new RelayHttpClient({
		baseUrl: BASE,
		auth: () => ({ cookie: null, origin: null, credentials: "omit" }),
		fetchImpl: async (url, init) => {
			const raw = init?.body;
			const reply = s.handle(
				init?.method ?? "GET",
				new URL(String(url)).pathname,
				typeof raw === "string" ? JSON.parse(raw) : undefined,
			);
			if (reply === null) return new Response("not found", { status: 404 });
			replies.push({
				path: new URL(String(url)).pathname,
				status: reply.status,
				code: (reply.body as { code?: string } | null)?.code,
			});
			return Response.json(reply.body, { status: reply.status });
		},
	});
	// A clock the test moves past the card's 500 ms input debounce.
	let clock = 0;
	const controller = createGuardController(
		new RelayEndpoints(http),
		() => clock,
	);
	return {
		s,
		replies,
		controller,
		later: () => {
			clock += 1_000;
		},
	};
}
const waitingSeed = () => {
	const entry = GUARD_SEEDS["guard-waiting"];
	if (!entry) throw new Error("no seed guard-waiting");
	return entry.seed;
};

describe("the phone controller against the mock twin", () => {
	it("a card another device answered first: the host's 409 reads as 'changed', not 'failed'", async () => {
		const { s, replies, controller, later } = phoneAgainst(waitingSeed());
		void controller.activate();
		await controller.reload();
		await controller.openConsent("tenant_example_1");
		expect(controller.getState().consent.phase).toBe("open");
		// Another surface answers while the phone shows the card.
		s.handle("POST", `/api/guard/consents/${ID}/decline`, undefined);
		later();
		await controller.decline();
		const answer = s.log.filter((entry) => entry.path.endsWith("/decline"));
		expect(answer).toHaveLength(2); // the other device's, then the phone's
		// The phone's own answer met the settled-card 409 and is NOT reported as
		// "your choice wasn't saved".
		expect(replies.find((r) => r.path.endsWith("/decline"))).toMatchObject({
			status: 409,
			code: "approval_decision_conflict",
		});
		const outcome = controller.getState().outcome;
		expect(outcome).not.toBeNull();
		expect(outcome?.kind).not.toBe("failed");
		controller.deactivate();
	});

	it("opening a card the host kept as settled says the request changed", async () => {
		const { s, controller } = phoneAgainst(waitingSeed());
		void controller.activate();
		await controller.reload();
		s.handle("POST", `/api/guard/consents/${ID}/decline`, undefined);
		await controller.openConsent("tenant_example_1");
		expect(controller.getState().consent.phase).toBe("closed");
		expect(controller.getState().outcome).toMatchObject({ kind: "changed" });
		controller.deactivate();
	});

	it("the older 404 shape (an id the host no longer has) still reads as 'changed'", async () => {
		const seed = waitingSeed();
		const { controller } = phoneAgainst({
			...seed,
			card: { ...(seed.card ?? {}), approval_id: "req_OTHER" },
		});
		void controller.activate();
		await controller.reload();
		await controller.openConsent("tenant_example_1");
		expect(controller.getState().outcome).toMatchObject({ kind: "changed" });
		controller.deactivate();
	});
});
