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
	ENVELOPE_KEY_PREFIX,
	ENVELOPE_TTL_MS,
	envelopeKey,
	isValidEnvelope,
	MAX_PENDING_ENVELOPES,
	MAX_STORED_ENVELOPE_CHARS,
	malformedFrameError,
	memoryEnvelopeStore,
	RetryEnvelopeStore,
	relayErrorFromResponse,
	sessionIdFromKey,
	transportError,
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

/* The contract's status/reason matrix (`contract.md` §5.1 plus the gateway's
 * refusal vocabulary), driven through the REAL path a command takes: a response is
 * classified by `relayErrorFromResponse`, settled against a real store holding a
 * real envelope, and the assertion is on what is left in storage. Nothing here
 * calls a disposition function directly, so the classifier and the store cannot
 * drift apart without a row failing.
 *
 * The rule for the rows: KEEP whenever delivery is unknown (a lost acknowledgement,
 * a proxy or connector that may or may not have forwarded it); CLEAR when the relay
 * itself answered a definitive refusal or acknowledgement. Replaying costs nothing
 * because the relay de-duplicates the same `command_id`; discarding costs the
 * user's typed instruction. */
describe("what happens to a stored command for each answer the client can get", () => {
	function answer(
		status: number,
		options: { body?: string; headers?: Record<string, string> } = {},
	) {
		const headers = new Map(
			Object.entries(options.headers ?? {}).map(([k, v]) => [
				k.toLowerCase(),
				v,
			]),
		);
		return relayErrorFromResponse({
			status,
			header: (name: string) => headers.get(name.toLowerCase()) ?? null,
			text: options.body ?? "",
		});
	}

	const gatewayRefusal = (reason: string) =>
		answer(503, {
			body: JSON.stringify({ detail: "refused", reason, error: "unavailable" }),
			headers: { "content-type": "application/json" },
		});

	const KEPT = "kept";
	const CLEARED = "cleared";
	const CLEARED_ALL = "cleared-all";

	const matrix: [string, () => ReturnType<typeof answer>, string][] = [
		// What the RELAY answers (§5.1): a definitive end of this id's ambiguity.
		[
			"400 bad request",
			() => answer(400, { body: '{"error":"bad"}' }),
			CLEARED,
		],
		[
			"403 same-origin refusal",
			() => answer(403, { body: '{"error":"x"}' }),
			CLEARED,
		],
		[
			"404 unknown session",
			() => answer(404, { body: '{"error":"unknown session"}' }),
			CLEARED,
		],
		[
			"409 not connected",
			() => answer(409, { body: '{"error":"session not connected"}' }),
			CLEARED,
		],
		[
			"413 body limit",
			() => answer(413, { body: '{"error":"too large"}' }),
			CLEARED,
		],
		[
			"422 pre-admission refusal",
			() => answer(422, { body: '{"error":"unknown op"}' }),
			CLEARED,
		],
		[
			"429 rate limited",
			() => answer(429, { body: '{"error":"slow down"}' }),
			CLEARED,
		],
		[
			"500 relay error",
			() => answer(500, { body: '{"error":"boom"}' }),
			CLEARED,
		],
		// The identity that owned the scoped storage is gone.
		[
			"401 relay password",
			() => answer(401, { body: '{"error":"authentication required"}' }),
			CLEARED_ALL,
		],
		[
			"401 edge, tunnel session expired",
			() => answer(401, { headers: { "x-radient-login": "/_radient/login" } }),
			CLEARED_ALL,
		],
		// Lost-acknowledgement statuses: admission may have happened.
		["408 timeout", () => answer(408, { body: '{"error":"timeout"}' }), KEPT],
		["502 proxy error", () => answer(502, { body: "Bad Gateway" }), KEPT],
		[
			"504 gateway timeout",
			() => answer(504, { body: '{"error":"no answer"}' }),
			KEPT,
		],
		// The gateway/edge sit upstream of the relay's de-duplication, so a refusal
		// from them proves nothing about whether an earlier attempt landed.
		[
			"502 relay daemon down",
			() => answer(502, { body: '{"error":"local harness unavailable"}' }),
			KEPT,
		],
		[
			"503 edge, computer offline",
			() => answer(503, { body: "Tunnel temporarily unavailable" }),
			KEPT,
		],
		...[
			"authorization_deferred",
			"authorization_lease_pending",
			"control_plane_unreachable",
			"authorization_refused",
			"tunnel_not_authorized",
			"login_required",
		].map((reason): [string, () => ReturnType<typeof answer>, string] => [
			`503 gateway refusal: ${reason}`,
			() => gatewayRefusal(reason),
			KEPT,
		]),
		// No answer at all, or a 2xx whose body could not be read.
		[
			"transport failure",
			() => transportError(new TypeError("fetch failed"), "x"),
			KEPT,
		],
		[
			"unreadable 2xx body",
			() => malformedFrameError("commandAck", new Error("bad"), 200),
			KEPT,
		],
	];

	it.each(matrix)("%s", async (_name, produce, expected) => {
		const { envelopes } = store();
		await envelopes.hold(SESSION, envelope());
		const result = await envelopes.settle(SESSION, {
			kind: "failed",
			error: produce(),
		});
		expect(result).toBe(expected);
		/* What the user feels: the typed instruction is either still there to replay
		 * under its original id, or gone. */
		const remaining = await envelopes.peek(SESSION);
		if (expected === KEPT) expect(remaining?.command_id).toBe(UUID);
		else expect(remaining).toBeNull();
	});

	it("clears only the settled conversation on a definitive answer, and every conversation on a 401", async () => {
		const { envelopes } = store();
		await envelopes.hold(SESSION, envelope());
		await envelopes.hold(OTHER_SESSION, envelope({ text: "other" }));
		await envelopes.settle(SESSION, { kind: "failed", error: answer(422) });
		expect(await envelopes.peek(SESSION)).toBeNull();
		expect(await envelopes.peek(OTHER_SESSION)).not.toBeNull();
		await envelopes.settle(OTHER_SESSION, {
			kind: "failed",
			error: answer(401, { headers: { "x-radient-login": "/_radient/login" } }),
		});
		expect(await envelopes.peek(OTHER_SESSION)).toBeNull();
	});

	it("clears on a definitive acknowledgement, including 'already admitted'", async () => {
		const { envelopes } = store();
		await envelopes.hold(SESSION, envelope());
		expect(await envelopes.settle(SESSION, { kind: "ack" })).toBe(CLEARED);
		expect(await envelopes.peek(SESSION)).toBeNull();
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

describe("holding a new draft while an earlier one is unresolved", () => {
	it("reports that the stored envelope was reused, so the new text is not silently dropped", async () => {
		const { envelopes } = store();
		const first = await envelopes.holdNew(SESSION, "prompt", "first draft");
		expect(first.reused).toBe(false);

		/* Delivery of the first is still unknown (nothing settled it). A second,
		 * different message arrives. The stored bytes must win — the same UUID has
		 * to keep meaning the same body — but the caller must be told, or the
		 * composer replays "first draft" as though it were the new text. */
		const second = await envelopes.holdNew(
			SESSION,
			"prompt",
			"a different draft",
		);
		expect(second.reused).toBe(true);
		expect(second.envelope.command_id).toBe(first.envelope.command_id);
		expect(second.envelope.text).toBe("first draft");
	});

	it("starts fresh once the earlier envelope is settled", async () => {
		const { envelopes } = store();
		const first = await envelopes.holdNew(SESSION, "prompt", "first draft");
		await envelopes.settle(SESSION, { kind: "ack" });
		const next = await envelopes.holdNew(SESSION, "prompt", "second draft");
		expect(next.reused).toBe(false);
		expect(next.envelope.command_id).not.toBe(first.envelope.command_id);
		expect(next.envelope.text).toBe("second draft");
	});
});
