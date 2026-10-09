/**
 * The move/offload flow: one user intent, one request id, at-most-once.
 *
 * WHAT THIS IS. `POST /api/sessions/{id}/transfer` moves (or `keep`-copies) one
 * conversation between devices. The relay journals the request id, so a retry
 * under the SAME id replays the recorded outcome instead of running a second
 * move (a replay answers `replayed: true`), a same id with different input is a
 * `409`, and a re-issue that arrives MID-MOVE waits on the journal and then
 * replays the settled outcome. This module turns that contract into the states
 * a surface renders, and it is pure TypeScript with an injected port so every
 * branch is testable without a relay.
 *
 * THE TWO-STEP SHAPE — `wait_s: 0` first, then the SAME id with the wait
 * ceiling — is the contract's own instruction for a phone:
 *
 * 1. {@link moveAttempt} issues with `wait_s: 0` and the transport's ordinary
 *    deadline. It returns the move's answer whenever the relay can give one
 *    quickly — a receipt, or a fast refusal (`busy` is instant, which is the
 *    point of `wait_s: 0`).
 * 2. {@link moveClaim} re-issues the SAME `request_id` with `wait_s: 300` (the
 *    contract's ceiling) and a longer, user-asked deadline. It exists to CLAIM
 *    the outcome of the first attempt: a mid-move re-issue coalesces on the
 *    relay's per-key lock and answers the settled outcome; an already-recorded
 *    outcome replays at once; and if the first attempt never reached the relay,
 *    the raised wait lets the relay wait out a busy source before moving.
 *    Because the id is the same, none of this can run a second move.
 *
 * WHY NOT ONE HELD CONNECTION: the possible waits here are minutes (a copy or a
 * recall is bounded in the hundreds of seconds — `mobility.move_client_bound_s`),
 * and ""a phone cannot hold a socket that long without the reader having to
 * watch it. The two-step shape keeps the FIRST request short; the long wait is
 * the claim, which is user-asked and whose own give-up is still reported as
 * UNCONFIRMED, never as a refusal.
 *
 * A REFUSAL AND AN UNKNOWN OUTCOME ARE DIFFERENT INSTRUCTIONS. A `409` is a
 * refusal: nothing changed, the id is released, and the surface may offer the
 * relay's remedy. A `503` — or the app's own deadline, or an answer the app
 * could not read — means the request WAS sent and this device never learned the
 * outcome: the surface re-reads the row and says so, and it never reports
 * "nothing changed" about a move that may have happened. The unconfirmed codes
 * are mirrored from the relay (`mobile/mesh.py` `MOVE_UNCONFIRMED_CODES`, itself
 * pinned equal to the desktop route's set), and the 503 rule is the desktop
 * mesh surface's own: **a 503 IS unconfirmed whatever code it carries**.
 */

import type { TransferReceipt } from "@/contracts";
import { isRelayError, type RelayError, type TransferRequest } from "@/relay";

/**
 * The relay's unconfirmed family — the move MAY have run and this device never
 * learned the outcome (`mobile/mesh.py` `MOVE_UNCONFIRMED_CODES`, pinned there
 * equal to the desktop route's set). Mirrored here as the client's reading of
 * both the code set and the 503 status that carries it.
 */
export const MOVE_UNCONFIRMED_CODES: ReadonlySet<string> = new Set([
	"relay_unavailable",
	"deadline_exceeded",
	"peer_unreachable",
]);

/** The wait ceiling the transfer route accepts, in seconds (0..300 is the
 *  contract; 300 is the most patience the relay will hold). */
export const MOVE_WAIT_CEILING_S = 300;

/**
 * The claim's own deadline, in ms: the wait ceiling plus a margin so the answer
 * is never cut exactly at the relay's own bound. It applies ONLY to
 * {@link moveClaim} — the attempt deliberately keeps the transport default
 * (20 s), because its whole job is to return fast and let the claim own the
 * long wait.
 */
export const MOVE_CLAIM_TIMEOUT_MS = MOVE_WAIT_CEILING_S * 1000 + 30_000;

/** One move's identity and intent. `requestId` is minted ONCE per user intent
 *  ({@link newTransferRequestId}) and reused by every re-issue. */
export interface MoveAsk {
	sessionId: string;
	/** The device asked to take it, or `"local"` for a recall to this device. */
	to: string;
	/** `true` forks at the destination and leaves the source running. */
	keep: boolean;
	requestId: string;
}

/** A refusal as the surface must render it: the code, the author's sentence,
 *  and whether the outcome is unknown. */
export interface TransferRefusal {
	/** The machine contract: a relay code, or this client's own for a
	 *  transport case (`deadline_exceeded`). */
	code: string;
	/** The relay's own sentence, verbatim — never paraphrased. */
	sentence: string;
	/** The HTTP status, or `null` when no response was produced at all. */
	status: number | null;
	/** True when the outcome is unknown and the move must not be repeated
	 *  blind — the row is re-read instead. */
	unconfirmed: boolean;
}

/** What one attempt or claim can answer. */
export type MoveOutcome =
	| { kind: "moved"; receipt: TransferReceipt }
	| { kind: "busy"; refusal: TransferRefusal }
	| { kind: "unconfirmed"; refusal: TransferRefusal }
	| { kind: "refused"; refusal: TransferRefusal };

/** The slice of the relay client a move needs. `RelayEndpoints` satisfies it;
 *  tests inject a stub. */
export interface TransferPort {
	transfer(
		sessionId: string,
		request: TransferRequest,
		options?: { timeoutMs?: number },
	): Promise<TransferReceipt>;
}

/**
 * A new request id for one move intent — a UUID, because the relay's route
 * validates that shape (`REQUEST_ID_PATTERN`) and refuses anything looser.
 * Lowercased because the relay's pattern is lowercase hex and RFC 4122 output
 * already is; the explicit case keeps a future runtime's uppercase output from
 * being refused as a *client* bug.
 *
 * The failure direction is deliberate: a runtime with no CSPRNG cannot mint an
 * id, and a predictable id would defeat the de-duplication it exists for — so
 * this throws rather than degrade (the same rule `retry-envelope` states).
 */
export function newTransferRequestId(): string {
	const cryptoObject = (globalThis as { crypto?: Crypto }).crypto;
	if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
		return cryptoObject.randomUUID().toLowerCase();
	}
	throw new Error(
		"no crypto.randomUUID on this runtime: a move request id cannot be generated safely",
	);
}

/** `{to, keep, wait_s, request_id}` — exactly the route's accepted keys, in the
 *  order the relay documents them. */
function body(ask: MoveAsk, waitS: number): TransferRequest {
	return {
		to: ask.to,
		keep: ask.keep,
		wait_s: waitS,
		request_id: ask.requestId,
	};
}

/** Classifies one thrown value into the move's outcome vocabulary.
 *
 *  - a `503` — ANY code — is UNCONFIRMED (the desktop mesh surface's rule:
 *    the request was sent and this device never learned the outcome);
 *  - an unconfirmed CODE (a non-503 carrying one — e.g. the app's own
 *    give-up) is UNCONFIRMED the same way;
 *  - a transport failure (no response at all) is UNCONFIRMED: the request was
 *    issued and nothing came back, and "nothing changed" would be a claim this
 *    client cannot make;
 *  - a `2xx` body the schema refused is UNCONFIRMED as well — an answer nobody
 *    can read makes no claim either way (the desktop normaliser's rule);
 *  - everything else — `409`, `422`, `507` — is a REFUSAL: the relay judged it
 *    and nothing moved. `busy` keeps its own arm because its remedy differs:
 *    re-issue the same id with the wait raised.
 *
 *  Anything that is not a `RelayError` is a bug, not an outcome: it is
 *  re-thrown rather than smoothed into a state a surface would render.
 */
export function classifyMoveError(error: unknown): MoveOutcome {
	if (!isRelayError(error)) throw error;
	const relayError: RelayError = error;
	const code = relayError.code ?? "move_refused";
	if (
		relayError.status === 503 ||
		MOVE_UNCONFIRMED_CODES.has(code) ||
		relayError.kind === "transport" ||
		relayError.kind === "malformed-frame"
	) {
		return {
			kind: "unconfirmed",
			refusal: refusalFrom(relayError, code, true),
		};
	}
	if (code === "busy") {
		return { kind: "busy", refusal: refusalFrom(relayError, code, false) };
	}
	return { kind: "refused", refusal: refusalFrom(relayError, code, false) };
}

function refusalFrom(
	error: RelayError,
	code: string,
	unconfirmed: boolean,
): TransferRefusal {
	return {
		code,
		/* The relay's sentence, through the taxonomy's one accessor — which is
		 * exactly the "never composed over" rule: for a `transport` kind it is
		 * the app's own sentence (the runtime's raw words must not reach copy),
		 * and every authored refusal passes through untouched. */
		sentence: error.displayableMessage,
		status: error.status ?? null,
		unconfirmed,
	};
}

async function run(
	port: TransferPort,
	ask: MoveAsk,
	waitS: number,
	timeoutMs?: number,
): Promise<MoveOutcome> {
	try {
		const receipt = await port.transfer(ask.sessionId, body(ask, waitS), {
			timeoutMs,
		});
		return { kind: "moved", receipt };
	} catch (error) {
		return classifyMoveError(error);
	}
}

/**
 * Stage one: the user's tap, issued without waiting (`wait_s: 0`) under the
 * transport's ordinary deadline. A `busy` answer arrives here instantly and the
 * surface offers the wait remedy; anything slower is claimed by
 * {@link moveClaim} under the same id.
 */
export function moveAttempt(
	port: TransferPort,
	ask: MoveAsk,
): Promise<MoveOutcome> {
	return run(port, ask, 0);
}

/**
 * Stage two: the CLAIM — the SAME id and the SAME body, re-issued.
 *
 * WHY THE SAME `wait_s` AND NOT A RAISED ONE, which is the one place this
 * module corrects a first reading of the core lane's brief. The journal
 * fingerprints the WHOLE parsed body, `wait_s` included
 * (`mobile/transfer_receipts.py:run`), and "a same id with different input is
 * a 409" — so a re-issue that RAISED the wait on an id the relay has already
 * recorded is refused as a conflict, not claimed as an outcome. The raised
 * wait is legal in exactly one place, and {@link moveWait} owns it: an id a
 * `busy` refusal RELEASED ("every other refusal left nothing behind and
 * releases the id"), where a fresh claim under the same id may state a
 * ceiling.
 *
 * With the body unchanged, the claim is the honest "what became of the same
 * request?":
 *
 * - a recorded outcome replays at once (`replayed: true`) — for an
 *   unconfirmed record that replays the same "no answer", and for a receipt,
 *   the move that settled since;
 * - a re-issue that arrives MID-MOVE waits on the journal's per-key lock and
 *   then replays the settled outcome — which is why this call keeps the LONG
 *   deadline: the lock wait can run to the move's own bound;
 * - an id the relay never recorded — the first attempt died on the wire —
 *   DIALS, which is the retry the user asked for, at-most-once;
 * - an id whose first attempt is still running with no result yet answers the
 *   journal's own conflict sentence ("Request outcome is indeterminate..."), a
 *   refusal that changes nothing and points the reader at the list.
 */
export function moveClaim(
	port: TransferPort,
	ask: MoveAsk,
): Promise<MoveOutcome> {
	return run(port, ask, 0, MOVE_CLAIM_TIMEOUT_MS);
}

/**
 * The `busy` refusal's remedy: the same id with the wait ceiling.
 *
 * ONLY legal from a `busy` state, and that is the relay's rule rather than a
 * preference: a `busy` refusal is `Unclaimed` — the journal RELEASES the id
 * ("every other refusal left nothing behind and releases the id, so a user
 * who frees the session up and presses again is not answered from a refusal
 * forever") — so this is a FRESH claim that may state its own patience, and
 * the relay waits for the source to go idle before moving. Called against a
 * recorded id it is refused `409 receipt_conflict` for the changed body, which
 * is why the sheet offers it from the busy state alone.
 */
export function moveWait(
	port: TransferPort,
	ask: MoveAsk,
): Promise<MoveOutcome> {
	return run(port, ask, MOVE_WAIT_CEILING_S, MOVE_CLAIM_TIMEOUT_MS);
}
