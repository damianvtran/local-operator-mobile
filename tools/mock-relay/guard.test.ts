import { describe, expect, it } from "vitest";

import { createGuardStore, GUARD_SEEDS } from "./guard.ts";

const store = (name: string) => {
	const entry = GUARD_SEEDS[name];
	if (!entry) throw new Error(`no seed ${name}`);
	return createGuardStore(entry.seed);
};
const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;
const ID = "req_EXAMPLE0001";

describe("the mock Guard twin keeps the host's rules", () => {
	it("accepting with the queued digests makes the org sharing; the request is consumed", () => {
		const s = store("guard-waiting");
		const reply = s.handle("POST", `/api/guard/consents/${ID}/accept`, {
			request_digest: A,
			disclosure_digest: B,
		});
		expect(reply?.status).toBe(200);
		const after = s.handle("GET", "/api/guard", undefined)?.body as {
			orgs: { state: string; prompt: unknown; answered_via: string }[];
		};
		expect(after.orgs[0]).toMatchObject({
			state: "sharing",
			prompt: null,
			answered_via: "mobile",
		});
		// Consumed: a second answer finds nothing.
		expect(
			s.handle("POST", `/api/guard/consents/${ID}/decline`, undefined)?.status,
		).toBe(404);
	});

	it("a digest the host did not queue is refused and nothing changes", () => {
		const s = store("guard-waiting");
		const reply = s.handle("POST", `/api/guard/consents/${ID}/accept`, {
			request_digest: A,
			disclosure_digest: `sha256:${"c".repeat(64)}`,
		});
		expect(reply?.status).toBe(409);
		const after = s.handle("GET", "/api/guard", undefined)?.body as {
			orgs: { state: string }[];
		};
		expect(after.orgs[0]?.state).toBe("waiting");
	});

	it("the accept body is closed: an extra key (a scope) is refused", () => {
		const s = store("guard-waiting");
		const reply = s.handle("POST", `/api/guard/consents/${ID}/accept`, {
			request_digest: A,
			disclosure_digest: B,
			scopes: ["decisions"],
		});
		expect(reply?.status).toBe(422);
	});

	it("decline leaves the org not sharing with Share again offered", () => {
		const s = store("guard-waiting");
		s.handle("POST", `/api/guard/consents/${ID}/decline`, undefined);
		const after = s.handle("GET", "/api/guard", undefined)?.body as {
			orgs: { state: string; can_share_again: boolean }[];
		};
		expect(after.orgs[0]).toMatchObject({
			state: "not_sharing",
			can_share_again: true,
		});
	});

	it("revoke is sticky; share-again re-opens the ask but grants nothing", () => {
		const s = store("guard-sharing");
		const revoke = s.handle(
			"POST",
			"/api/guard/orgs/tenant_example_1/revoke",
			undefined,
		);
		expect(
			((revoke as { body: unknown }).body as { status: string }).status,
		).toBe("revoked");
		expect(
			s.handle("POST", "/api/guard/orgs/tenant_example_1/revoke", undefined)
				?.status,
		).toBe(409);
		s.handle("POST", "/api/guard/orgs/tenant_example_1/share-again", undefined);
		const after = s.handle("GET", "/api/guard", undefined)?.body as {
			orgs: { state: string; scopes_shared: string[] }[];
		};
		expect(after.orgs[0]).toMatchObject({
			state: "will_ask",
			scopes_shared: [],
		});
	});

	it("the non-Team card is only for a non-Team account; a Team account gets 404", () => {
		expect(
			store("guard-non-team-owner").handle(
				"GET",
				"/api/guard/non-team-card",
				undefined,
			)?.status,
		).toBe(200);
		expect(
			store("guard-sharing").handle(
				"GET",
				"/api/guard/non-team-card",
				undefined,
			)?.status,
		).toBe(404);
	});

	it("every request is logged, and an unknown Guard route is a 404", () => {
		const s = store("guard-sharing");
		s.handle("GET", "/api/guard", undefined);
		expect(s.handle("GET", "/api/guard/nope", undefined)?.status).toBe(404);
		expect(s.log.map((entry) => entry.path)).toEqual([
			"/api/guard",
			"/api/guard/nope",
		]);
		expect(s.handle("GET", "/api/notifications", undefined)).toBeNull();
	});
});
