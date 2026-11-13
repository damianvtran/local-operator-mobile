import type { PendingEcho } from "@/features/session/pending-echo";
import type { ContinuationEnvelope } from "@/relay/retry-envelope";
import type { StartupSnapshot } from "./startup-coordinator";

/**
 * The home's optimistic rows: what the reader just sent into a NEW conversation,
 * as the same `PendingEcho` rows the session screen paints
 * (`features/session/pending-echo.ts`, ported from the relay's web client).
 *
 * WHY (operator, TestFlight 906: "Starting new conversations feels quite slow on
 * mobile, when I click to send it takes a while"). The transcript adopts the
 * session only once `POST /api/sessions/start` has returned an id, and the
 * reader's message reached the screen only after the continuation POST and the
 * stream's first frame after that. The message is now on screen from durable
 * admission — the moment the coordinator commits it to the outbox, which is the
 * relay's own rule ("the row is painted the instant the envelope is held").
 *
 * DERIVED, NOT A SECOND STORE. The coordinator already owns every fact a row
 * needs: the queue (admitted, not yet acknowledged), `delivered` (acknowledged,
 * not yet in the transcript) and the phase (what went wrong). Mapping them keeps
 * the failure semantics the coordinator's alone — nothing here can send, drop or
 * restore a message:
 *
 *   - `refused` (the relay definitively refused the create): the queue survives
 *     and the row says "not sent — tap to put back"; the tap is the coordinator's
 *     existing `restoreQueueToDraft`, so the draft comes back editable.
 *   - `unconfirmed` / `blocked`: the row stays, captioned "not confirmed", because
 *     the message may exist on the computer. No second POST is implied by it.
 *   - the auth owner changed: the hook hands back an EMPTY snapshot, so there is
 *     nothing to map and the bytes stay inaccessible.
 *
 * ONE ROW PER COMMAND. Reconciliation is by the envelope's `command_id`, which the
 * relay writes as the user entry's id; the caller filters with
 * `owedPendingEchoes` against the transcript, exactly as the session screen does,
 * so the pending row and its real row are never on screen in the same frame. An
 * envelope briefly in both `delivered` and `queue` (the coordinator publishes
 * delivery before the queue commit, so it is never in neither) is one row, the
 * delivered one.
 */
export function startupEchoes(
	snapshot: Pick<StartupSnapshot, "phase" | "queue" | "delivered">,
): PendingEcho[] {
	const delivered = new Set(
		snapshot.delivered.map((message) => message.command_id),
	);
	const failure: PendingEcho["failure"] =
		snapshot.phase === "refused"
			? "refused"
			: snapshot.phase === "unconfirmed" || snapshot.phase === "blocked"
				? "unconfirmed"
				: undefined;
	return [
		...snapshot.delivered.map((message) => echoOf(message, true)),
		...snapshot.queue
			.filter((message) => !delivered.has(message.command_id))
			.map((message) => ({
				...echoOf(message, false),
				...(failure ? { failure } : {}),
			})),
	];
}

const echoOf = (
	message: ContinuationEnvelope,
	accepted: boolean,
): PendingEcho => ({
	commandId: message.command_id,
	text: message.text,
	imageCount: message.images?.length ?? 0,
	...(message.images?.length ? { images: message.images } : {}),
	// The startup outbox only ever holds prompts (`enqueue`); a steer cannot
	// exist before the conversation does.
	op: "prompt",
	accepted,
});
