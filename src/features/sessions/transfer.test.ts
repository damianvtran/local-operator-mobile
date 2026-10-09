import { describe, expect, it } from "vitest";

import type { TransferReceipt } from "@/contracts";
import {
	MOVE_CLAIM_TIMEOUT_MS,
	MOVE_UNCONFIRMED_CODES,
	MOVE_WAIT_CEILING_S,
	type MoveAsk,
	moveAttempt,
	moveClaim,
	moveWait,
	type TransferPort,
} from "@/features/sessions/transfer";
import { RelayError, type TransferRequest } from "@/relay";

/**
 * The move's state machine, where the decisions are not observable from a frame:
 * what the two requests carry, which answer becomes which state, and the one
 * rule that keeps a retry from running a second move — THE REQUEST ID.
 *
 * The wire side (the route's at-most-once journal) is the relay's own test
 * suite; what this file pins is the CLIENT's half: the id is minted once per
 * intent and re-used by the claim, `wait_s` runs 0 -> 300 across the two steps,
 * and the classification never reads an unconfirmed outcome as a refusal.
 */

const ASK: MoveAsk = {
	sessionId: "6714def86197",
	to: "d_peer01",
	keep: false,
	requestId: "01234567-89ab-cdef-0123-456789abcdef",
};

const RECEIPT: TransferReceipt = {
	phases: [
		{ phase: "prepared", peer: "d_peer01", progress: 0.25 },
		{ phase: "done", peer: "d_peer01", progress: 1 },
	],
	locality: "remote",
	owner_device: "d_peer01",
	source_retired: true,
	session_id: ASK.sessionId,
	new_session_id: ASK.sessionId,
	mode: "move",
	replayed: false,
};

type Call = {
	sessionId: string;
	request: TransferRequest;
	timeoutMs: number | undefined;
};

/** A port that records every call and answers a scripted sequence: a receipt,
 *  or a `RelayError` to throw. Exhausted, it answers the receipt. */
class FakePort implements TransferPort {
	readonly calls: Call[] = [];
	constructor(
		private readonly answers: Array<TransferReceipt | RelayError> = [],
	) {}
	async transfer(
		sessionId: string,
		request: TransferRequest,
		options: { timeoutMs?: number } = {},
	): Promise<TransferReceipt> {
		this.calls.push({ sessionId, request, timeoutMs: options.timeoutMs });
		const answer = this.answers.shift() ?? RECEIPT;
		if (answer instanceof RelayError) throw answer;
		return answer;
	}
}

const refusalError = (
	code: string,
	status: number,
	sentence: string,
): RelayError =>
	new RelayError(status === 503 ? "computer-offline" : "rejected", sentence, {
		status,
		code,
		serverError: sentence,
	});

describe("the two requests", () => {
	it("the attempt issues wait_s 0 with the caller's id and the transport's own deadline", async () => {
		const port = new FakePort();
		const outcome = await moveAttempt(port, ASK);
		expect(outcome).toEqual({ kind: "moved", receipt: RECEIPT });
		expect(port.calls).toHaveLength(1);
		expect(port.calls[0]?.sessionId).toBe(ASK.sessionId);
		expect(port.calls[0]?.request).toEqual({
			to: "d_peer01",
			keep: false,
			wait_s: 0,
			request_id: ASK.requestId,
		});
		// No override: the attempt keeps the transport's default deadline, which
		// is what makes it the SHORT step of the two-step design.
		expect(port.calls[0]?.timeoutMs).toBeUndefined();
	});

	it("the claim re-issues the SAME id and the SAME body — the long deadline is the only change", async () => {
		// The journal fingerprints the whole body (`mobile/transfer_receipts.py`),
		// so the claim may change NOTHING but its own deadline: a raised `wait_s`
		// on a recorded id is a 409 by the relay's own rule.
		const port = new FakePort();
		await moveClaim(port, ASK);
		expect(port.calls).toHaveLength(1);
		expect(port.calls[0]?.request.request_id).toBe(ASK.requestId);
		expect(port.calls[0]?.request.wait_s).toBe(0);
		expect(port.calls[0]?.timeoutMs).toBe(MOVE_CLAIM_TIMEOUT_MS);
	});

	it("the busy remedy raises the wait under the same id, and it is the ONLY caller that does", async () => {
		// A `busy` refusal releases the id (Unclaimed), so a fresh claim under it
		// may state a ceiling; every other path must keep the body identical.
		const port = new FakePort();
		await moveWait(port, ASK);
		expect(port.calls[0]?.request.request_id).toBe(ASK.requestId);
		expect(port.calls[0]?.request.wait_s).toBe(MOVE_WAIT_CEILING_S);
		expect(port.calls[0]?.timeoutMs).toBe(MOVE_CLAIM_TIMEOUT_MS);
	});

	it("attempt then claim: one id across both, and the claim's body is byte-identical", async () => {
		// The at-most-once shape end to end at the client's boundary: neither the
		// claim nor the wait may mint a new id, or the relay would run a second
		// move for one intent. The claim's body must EQUAL the attempt's — that
		// equality is what makes a replay a replay.
		const port = new FakePort([
			refusalError("busy", 409, "the session has a turn in flight"),
			RECEIPT,
		]);
		const attempt = await moveAttempt(port, ASK);
		expect(attempt.kind).toBe("busy");
		const claim = await moveClaim(port, ASK);
		expect(claim.kind).toBe("moved");
		const [first, second] = port.calls;
		expect(first?.request.request_id).toBe(ASK.requestId);
		expect(second?.request.request_id).toBe(ASK.requestId);
		expect(second?.request).toEqual(first?.request);

		// And the busy remedy's own body: same id, raised wait — a DIFFERENT
		// fingerprint, legal only because the busy refusal released the id.
		const waiting = new FakePort();
		await moveWait(waiting, ASK);
		expect(waiting.calls[0]?.request).toEqual({
			to: ASK.to,
			keep: ASK.keep,
			wait_s: MOVE_WAIT_CEILING_S,
			request_id: ASK.requestId,
		});
	});
});

describe("classification", () => {
	it("a 503 is unconfirmed whatever code it carries — never a refusal", async () => {
		for (const code of [
			"relay_unavailable",
			"receipt_store_unreadable",
			"some_future_code",
		]) {
			const port = new FakePort([refusalError(code, 503, "no answer")]);
			const outcome = await moveAttempt(port, ASK);
			expect(outcome.kind).toBe("unconfirmed");
		}
	});

	it("every canonical unconfirmed code is unconfirmed even off a 503", async () => {
		for (const code of MOVE_UNCONFIRMED_CODES) {
			const port = new FakePort([refusalError(code, 409, "unconfirmed")]);
			const outcome = await moveAttempt(port, ASK);
			expect(outcome.kind).toBe("unconfirmed");
		}
	});

	it("a 409 keeps its own arms: busy is its own state, everything else is refused", async () => {
		const busy = await moveAttempt(
			new FakePort([refusalError("busy", 409, "a turn is in flight")]),
			ASK,
		);
		expect(busy.kind).toBe("busy");
		const refused = await moveAttempt(
			new FakePort([
				refusalError("session_retired", 409, "the source is gone"),
			]),
			ASK,
		);
		expect(refused.kind).toBe("refused");
	});

	it("the relay's sentence travels verbatim, through the one copy accessor", async () => {
		const sentence = "the destination device is not in this network";
		const outcome = await moveAttempt(
			new FakePort([refusalError("peer_unreachable", 503, sentence)]),
			ASK,
		);
		if (outcome.kind !== "unconfirmed") throw new Error("expected unconfirmed");
		expect(outcome.refusal.sentence).toBe(sentence);
		expect(outcome.refusal.unconfirmed).toBe(true);
		expect(outcome.refusal.status).toBe(503);
		expect(outcome.refusal.code).toBe("peer_unreachable");
	});

	it("a transport failure with no answer at all is unconfirmed, never refused", async () => {
		const port = new FakePort([
			new RelayError("transport", "network request failed"),
		]);
		const outcome = await moveAttempt(port, ASK);
		expect(outcome.kind).toBe("unconfirmed");
	});

	it("a 2xx body the schema refused is unconfirmed: an unreadable answer makes no claim", async () => {
		const port = new FakePort([
			new RelayError("malformed-frame", "receipt did not match the schema", {
				status: 200,
			}),
		]);
		const outcome = await moveAttempt(port, ASK);
		expect(outcome.kind).toBe("unconfirmed");
	});

	it("a non-RelayError is a bug, not an outcome: it is re-thrown", async () => {
		const port = {
			async transfer(): Promise<TransferReceipt> {
				throw new TypeError("undefined is not a function");
			},
		};
		await expect(moveAttempt(port, ASK)).rejects.toThrow(TypeError);
	});
});
