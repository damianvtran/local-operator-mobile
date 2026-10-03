import { describe, expect, it } from "vitest";

import {
	envelopeStoreFor,
	forgetEnvelopeStore,
} from "@/features/session/envelope-store";

/**
 * One store per session, because two is a duplicate POST.
 *
 * The store is what makes a replay reuse a `command_id`. Two instances on one
 * session would each believe they held the only envelope, so the second `holdNew`
 * would mint a new id for an instruction the first had already persisted — the
 * relay would then see two distinct commands for one thing the reader typed.
 * Sharing is therefore a correctness property, not an optimisation.
 */
describe("the envelope store's lifetime", () => {
	it("hands the same instance back for the same session", () => {
		const first = envelopeStoreFor("session-a");
		expect(envelopeStoreFor("session-a")).toBe(first);
		expect(envelopeStoreFor("session-a")).toBe(first);
	});

	it("keeps sessions apart, so one session's unresolved instruction is not another's", () => {
		const a = envelopeStoreFor("session-a");
		const b = envelopeStoreFor("session-b");
		expect(b).not.toBe(a);
	});

	it("drops the instance on request, without disturbing the other sessions", () => {
		const before = envelopeStoreFor("session-c");
		forgetEnvelopeStore("session-c");
		const after = envelopeStoreFor("session-c");
		expect(after).not.toBe(before);
		expect(envelopeStoreFor("session-a")).toBe(envelopeStoreFor("session-a"));
	});
});
