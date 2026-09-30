// biome-ignore-all lint/performance/useTopLevelRegex: a regex literal inside an
// assertion is not a hot path — there is no per-frame work here to hoist out of.
// biome-ignore-all lint/style/noNonNullAssertion: an assertion after an explicit
// length/definedness check is the guard; a longhand local for it would obscure it.
/**
 * The persisted-command rules, one test per row of the module's decision table.
 *
 * Each of these guards a specific, expensive failure: a duplicate turn (replaying
 * under a NEW uuid, or failing to replay under the same one), a silently dropped
 * instruction (clearing on an ambiguous status), a poisoned conversation
 * (keeping a rejected envelope, so every later prompt refuses the same id), a
 * stale envelope surviving a sign-out, and an unbounded store growing with every
 * conversation the user visits.
 */

import { describe, expect, it } from "vitest";

import {
	type ContinuationEnvelope,
	dispositionForOutcome,
	dispositionForStatus,
	ENVELOPE_KEY_PREFIX,
	ENVELOPE_TTL_MS,
	envelopeKey,
	isAmbiguousDeliveryStatus,
	isValidEnvelope,
	MAX_PENDING_ENVELOPES,
	MAX_STORED_ENVELOPE_CHARS,
	memoryEnvelopeStore,
	RetryEnvelopeStore,
	sessionIdFromKey,
} from "../index";

const SESSION = "6714def86197";
const OTHER_SESSION = "9ed9e2f534cd";
const UUID = "cf13127c-6523-4138-a225-0eccdba095da";

function envelope(
	overrides: Partial<ContinuationEnvelope> = {},
): ContinuationEnvelope {
	return { op: "prompt", command_id: UUID, text: "hello", ...overrides };
}

function store(now = 1_790_727_300_000) {
	const backing = memoryEnvelopeStore();
	const clock = { value: now };
	return {
		backing,
		clock,
		envelopes: new RetryEnvelopeStore({
			store: backing,
			now: () => clock.value,
		}),
	};
}

describe("the identity of the body is its uuid", () => {
	it("replays the same id after an ambiguous failure", async () => {
		const { envelopes } = store();
		const held = envelope();
		await envelopes.hold(SESSION, held);
		const recovered = await envelopes.peek(SESSION);
		expect(recovered?.command_id).toBe(held.command_id);
		expect(recovered?.text).toBe(held.text);
		expect(recovered?.op).toBe("prompt");
	});

	it("refuses an envelope whose identity is not a uuid, rather than persisting it", async () => {
		const { envelopes } = store();
		await expect(
			envelopes.hold(SESSION, envelope({ command_id: "not-a-uuid" })),
		).rejects.toThrow(/command_id/i);
		expect(await envelopes.peek(SESSION)).toBeNull();
	});

	it("keeps the op distinguishable, so a steer is never replayed as a prompt", async () => {
		const { envelopes } = store();
		await envelopes.hold(
			SESSION,
			envelope({ op: "steer", text: "also say bye" }),
		);
		expect((await envelopes.peek(SESSION))?.op).toBe("steer");
	});

	it("copies images rather than holding a reference to the composer's array", async () => {
		const { envelopes } = store();
		const images = [{ data_b64: "AAAA", mime_type: "image/png" }];
		await envelopes.hold(SESSION, envelope({ images }));
		images[0]!.data_b64 = "BBBB";
		images.push({ data_b64: "CCCC", mime_type: "image/png" });
		const recovered = await envelopes.peek(SESSION);
		expect(recovered?.images).toEqual([
			{ data_b64: "AAAA", mime_type: "image/png" },
		]);
	});
});

describe("the keep/clear table", () => {
	it("keeps across transport failure, which proves nothing about admission", () => {
		expect(dispositionForOutcome({ kind: "transport" })).toBe("kept");
		expect(dispositionForOutcome({ kind: "frame-error" })).toBe("kept");
	});

	it("keeps the acknowledgement-loss statuses, because admission may have happened", () => {
		expect(isAmbiguousDeliveryStatus(408)).toBe(true);
		expect(isAmbiguousDeliveryStatus(502)).toBe(true);
		expect(isAmbiguousDeliveryStatus(504)).toBe(true);
		for (const status of [408, 502, 504]) {
			expect(dispositionForStatus(status), String(status)).toBe("kept");
		}
	});

	it("clears on every other status, because a pre-admission refusal proves the command never ran", () => {
		/* 401 is deliberately absent: it clears ALL scoped storage, not just this
		 * conversation's envelope, and has its own test below. */
		for (const status of [
			200, 201, 400, 403, 404, 409, 413, 422, 429, 500, 501, 503, 505,
		]) {
			expect(dispositionForStatus(status), String(status)).toBe("cleared");
		}
		expect(isAmbiguousDeliveryStatus(500)).toBe(false);
		expect(isAmbiguousDeliveryStatus(503)).toBe(false);
	});

	it("clears the envelope on a transport-level 401 through clear-all, because the identity changed", async () => {
		const { envelopes, backing } = store();
		await envelopes.hold(SESSION, envelope());
		/* The scoped storage is gone with the session: logout clears everything
		 * rather than this one conversation. */
		const disposition = await envelopes.settle(SESSION, {
			kind: "http-status",
			status: 401,
		});
		expect(disposition).toBe("cleared-all");
		expect(await backing.keys()).toEqual([]);
	});

	it("keeps the envelope on a 502 and clears it on a 422, end to end", async () => {
		const { envelopes } = store();
		await envelopes.hold(SESSION, envelope());
		expect(
			await envelopes.settle(SESSION, { kind: "http-status", status: 502 }),
		).toBe("kept");
		expect(await envelopes.peek(SESSION)).not.toBeNull();
		expect(
			await envelopes.settle(SESSION, { kind: "http-status", status: 422 }),
		).toBe("cleared");
		expect(await envelopes.peek(SESSION)).toBeNull();
	});

	it("keeps the envelope when the acknowledgement arrives but its body cannot be read", async () => {
		/* Admission is unproven in both directions, and the two mistakes are not
		 * symmetric: replaying a deduplicated command is free, losing an instruction
		 * is not. */
		const { envelopes } = store();
		await envelopes.hold(SESSION, envelope());
		expect(await envelopes.settle(SESSION, { kind: "frame-error" })).toBe(
			"kept",
		);
	});
});

describe("the envelope is scoped per session and bounded by count", () => {
	it("keys the item the way the web client does, so both describe one state", () => {
		expect(envelopeKey(SESSION)).toBe(`${ENVELOPE_KEY_PREFIX}${SESSION}`);
		expect(sessionIdFromKey(envelopeKey(SESSION))).toBe(SESSION);
		expect(sessionIdFromKey("lo-mobile-draft:abc")).toBeNull();
	});

	it("does not let one conversation's envelope be read as another's", async () => {
		const { envelopes } = store();
		await envelopes.hold(SESSION, envelope({ text: "first" }));
		await envelopes.hold(OTHER_SESSION, envelope({ text: "second" }));
		expect((await envelopes.peek(SESSION))?.text).toBe("first");
		expect((await envelopes.peek(OTHER_SESSION))?.text).toBe("second");
	});

	it("evicts the oldest, never the one being written", async () => {
		const { envelopes, backing, clock } = store();
		for (let index = 0; index < MAX_PENDING_ENVELOPES; index += 1) {
			clock.value += 1_000;
			await envelopes.hold(
				`session-${index}`,
				envelope({ text: `turn ${index}` }),
			);
		}
		expect((await backing.keys()).length).toBe(MAX_PENDING_ENVELOPES);

		clock.value += 1_000;
		await envelopes.hold("session-new", envelope({ text: "the new one" }));
		const keys = await backing.keys();
		expect(keys.length).toBe(MAX_PENDING_ENVELOPES);
		expect(keys).toContain(envelopeKey("session-new"));
		expect(keys).not.toContain(envelopeKey("session-0"));
	});

	it("does not evict the active route when a retry re-writes its own envelope", async () => {
		const { envelopes, backing, clock } = store();
		for (let index = 0; index < MAX_PENDING_ENVELOPES; index += 1) {
			clock.value += 1_000;
			await envelopes.hold(`session-${index}`, envelope());
		}
		/* Re-holding the OLDEST conversation must not push it out to make room for
		 * itself: the recovery affordance for the route the user is on is the whole
		 * point of the item. */
		clock.value += 1_000;
		await envelopes.hold("session-0", envelope({ text: "retry" }));
		const keys = await backing.keys();
		expect(keys).toContain(envelopeKey("session-0"));
		expect((await envelopes.peek("session-0"))?.text).toBe("retry");
	});
});

describe("the TTL and corrupt state", () => {
	it("holds the item for 24 hours and drops it after", async () => {
		const { envelopes, clock, backing } = store();
		await envelopes.hold(SESSION, envelope());
		clock.value += ENVELOPE_TTL_MS - 1;
		expect(await envelopes.peek(SESSION)).not.toBeNull();

		clock.value += 2;
		expect(await envelopes.peek(SESSION)).toBeNull();
		/* A stale item is pruned, not merely ignored: it must not be able to grow the
		 * store or be resurrected by another read. */
		expect(await backing.keys()).toEqual([]);
	});

	it("drops an item whose saved_at is in the future, which means a moved clock", async () => {
		const { envelopes, clock, backing } = store();
		await envelopes.hold(SESSION, envelope());
		clock.value -= ENVELOPE_TTL_MS * 2;
		expect(await envelopes.peek(SESSION)).toBeNull();
		expect(await backing.keys()).toEqual([]);
	});

	it("drops a truncated item rather than trusting half of it", async () => {
		const { envelopes, backing } = store();
		/* A native store can write partially; `localStorage` could not. A truncated
		 * envelope has no trustworthy uuid/body pairing. */
		await backing.set(
			envelopeKey(SESSION),
			`{"version":1,"saved_at":1790727300000,"envelope":{"op":"pro`,
		);
		expect(await envelopes.peek(SESSION)).toBeNull();
		expect(await backing.keys()).toEqual([]);
	});

	it("drops an item whose op is not a continuable op", async () => {
		const { envelopes, backing } = store();
		await backing.set(
			envelopeKey(SESSION),
			JSON.stringify({
				version: 1,
				saved_at: 1_790_727_300_000,
				envelope: { op: "set_model", command_id: UUID, text: "" },
			}),
		);
		expect(await envelopes.peek(SESSION)).toBeNull();
		expect(await backing.keys()).toEqual([]);
	});

	it("refuses an envelope too large to retain safely", async () => {
		const { envelopes } = store();
		const huge = "x".repeat(MAX_STORED_ENVELOPE_CHARS + 1);
		await expect(
			envelopes.hold(SESSION, envelope({ text: huge })),
		).rejects.toThrow(/large/i);
	});
});

describe("clear-all is the sign-out path", () => {
	it("removes every scoped item and leaves unrelated storage alone", async () => {
		const { envelopes, backing } = store();
		await backing.set("unrelated:preference", "dark");
		await envelopes.hold(SESSION, envelope());
		await envelopes.hold(OTHER_SESSION, envelope());
		await envelopes.clearAll();
		expect(await backing.keys()).toEqual(["unrelated:preference"]);
	});

	it("clears a single conversation without touching the rest", async () => {
		const { envelopes, backing } = store();
		await envelopes.hold(SESSION, envelope());
		await envelopes.hold(OTHER_SESSION, envelope());
		await envelopes.clear(SESSION);
		expect(await backing.keys()).toEqual([envelopeKey(OTHER_SESSION)]);
	});
});

describe("validation", () => {
	it("accepts a well-formed envelope and rejects the near-misses", () => {
		expect(isValidEnvelope({ op: "prompt", command_id: UUID, text: "" })).toBe(
			true,
		);
		expect(
			isValidEnvelope({ op: "prompt", command_id: UUID, text: "", images: [] }),
		).toBe(true);
		expect(isValidEnvelope({ op: "shell", command_id: UUID, text: "" })).toBe(
			false,
		);
		expect(
			isValidEnvelope({ op: "prompt", command_id: "nope", text: "" }),
		).toBe(false);
		expect(isValidEnvelope({ op: "prompt", command_id: UUID })).toBe(false);
		expect(
			isValidEnvelope({
				op: "prompt",
				command_id: UUID,
				text: "",
				images: [{ data_b64: 1, mime_type: "image/png" }],
			}),
		).toBe(false);
		expect(isValidEnvelope(null)).toBe(false);
	});
});
