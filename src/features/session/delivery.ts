/**
 * The send tool's delivery states, as the phone reads them.
 *
 * A cross-session `send` settles in one of four states, and the difference
 * between them is the difference between "it is there", "it is there but the
 * wake went unanswered", "I could not find out", and "it did not go" — the
 * incident this vocabulary exists to stop is the middle two being painted as
 * the last one, because that is how a reader re-sends a message the target
 * already has (local-operator PR #1855; the desktop tool row's four states,
 * local-operator-ui PR #719, are the semantics mirrored here).
 *
 * **Read from `details.delivery.state`, never sniffed from the result text.**
 * The sentence a shell prints is not a data channel; the field is. `state` is
 * one of `delivered | mailbox | unconfirmed | failed` and everything else —
 * an absent `delivery`, a non-object, a state this build does not know — reads
 * as `null`, which is exactly the row this app painted before the field
 * existed. That forward-only rule is the core's own (`request_update.py`:
 * "a state a future build added: report it as failed rather than claiming a
 * delivery this build cannot vouch for" — here, report nothing new and keep
 * the row unchanged rather than guessing).
 *
 * The consequences of each state, quoted from the core's table, because these
 * words are the interface and the app must not re-word them
 * (`local_operator/mobile/peer_send.py:308-313`, `DELIVERY_STATE_WORDS`;
 * `tui/widgets/tool_card.py:799-806`, `DELIVERY_OUTCOME_WORDS`):
 *
 *   - `delivered` — silent, like every other success: the row keeps its tick.
 *   - `mailbox` — "wake unconfirmed": the message is in the target's mailbox;
 *     only the wake got no answer. A reader must NOT re-send.
 *   - `unconfirmed` — "delivery unconfirmed": no answer and no proof either
 *     way. The one state whose hint is "check the target's transcript before
 *     resending", because nothing else can tell whether the message landed.
 *   - `failed` — "not delivered": proven non-delivery; only the cause
 *     is worth acting on.
 *
 * The hint's wording below is adapted from the desktop UI's strings
 * (`SEND_DELIVERY_LABEL` / `SEND_DELIVERY_NOTE`, local-operator-ui #719) with
 * one change this surface forces: it must read as an instruction to a person,
 * not a hover — the phone has no hover, so the hedge lives in the expansion
 * note AND in the row's spoken name, and a test pins both to this module so
 * the two cannot drift.
 */

import type { TranscriptEntry } from "@/contracts";

/** The four states the wire may state, in the core's own names. */
export type SendDeliveryState =
	| "delivered"
	| "mailbox"
	| "unconfirmed"
	| "failed";

const SEND_DELIVERY_STATES: ReadonlySet<string> = new Set([
	"delivered",
	"mailbox",
	"unconfirmed",
	"failed",
]);

/**
 * The delivery state a row's `details` states, or `null` when it states none.
 *
 * `details.delivery` is the nested payload the core attaches to a settled
 * `send` result (`details.delivery = outcome.details()`, `tools/builtin.py`
 * execute_send); this reads its `state` and validates it against the four
 * names. An unknown string is `null` rather than a fifth state: claiming a
 * delivery this build cannot vouch for is the failure this whole table exists
 * to prevent, and keeping the old row is the honest fallback.
 */
export function deliveryStateFromDetails(
	details: unknown,
): SendDeliveryState | null {
	if (details === null || typeof details !== "object") return null;
	const delivery = (details as Record<string, unknown>).delivery;
	if (delivery === null || typeof delivery !== "object") return null;
	const state = (delivery as Record<string, unknown>).state;
	return typeof state === "string" && SEND_DELIVERY_STATES.has(state)
		? (state as SendDeliveryState)
		: null;
}

/**
 * The delivery state a ROW shows — `deliveryStateFromDetails` gated to the tool
 * the field belongs to.
 *
 * `details.delivery` is the `send` tool's own field (the core's
 * `SEND_TOOL_NAME`; the TUI and the desktop row gate on exactly that), so a
 * lookalike key on another tool must not grow the word on a row — and, because
 * the state marker and the row must agree by construction (the `richRows`
 * lesson), must not affirm the marker either. The row and the marker both read
 * through this one function so the gate cannot drift.
 */
export function sendDeliveryStateOf(
	entry: Pick<TranscriptEntry, "tool_name" | "details">,
): SendDeliveryState | null {
	return entry.tool_name.toLowerCase() === "send"
		? deliveryStateFromDetails(entry.details)
		: null;
}

/**
 * The trailing word a send row prints for a state, in the slot a failure's
 * word would take. Only the three states that need saying have one: `delivered`
 * is silent like every other success, and each word names its SUBJECT — never a
 * bare verdict (`unconfirmed` alone reads "it did not go", the exact reading
 * that produces the duplicate this table prevents; agent review of #719,
 * round 1, U2).
 */
export const SEND_DELIVERY_WORD: Readonly<
	Partial<Record<SendDeliveryState, string>>
> = {
	mailbox: "wake unconfirmed",
	unconfirmed: "delivery unconfirmed",
	failed: "not delivered",
};

/**
 * The wrapping sentence the EXPANSION prints for a state — the half of the
 * story the collapsed row cannot carry: what the state MEANS and what to do
 * about it. Measured on the desktop's own frames (UX round 1, U1/U4): the raw
 * result text is one machine line whose actionable half sits off the right
 * edge, so the instruction gets its own wrapping line here too. The raw result
 * text is not removed — it stays as the row's output block, which is where the
 * message id and the attempt count live.
 *
 * `delivered` has no entry by design: a success says nothing, and the
 * expansion of a delivered send is the row it always was.
 */
export const SEND_DELIVERY_NOTE: Readonly<
	Partial<Record<SendDeliveryState, string>>
> = {
	mailbox:
		"Delivered to their mailbox. The wake got no answer, so they will read the message on their next turn. Check the target's transcript before resending.",
	unconfirmed:
		"Not confirmed: there was no answer and the message is not in their transcript. It may still arrive, so check the target's transcript before resending.",
	failed:
		"Nothing was delivered. Fix the cause named above, or retry the send.",
};

/**
 * What assistive tech hears for each state (the word is drawn; this is spoken).
 *
 * The amber state's spoken sentence carries the hedge the drawn word cannot
 * (UX round 1, U3 on the desktop): `delivery unconfirmed` alone is "it did not
 * go", and a hedge that only a sighted reader can reach is not a hedge. The
 * row's accessible name is built from this table, so the hint the manager
 * requires — "check the target's transcript before resending" — is in the name
 * as well as on screen.
 *
 * `failed` has no entry: its drawn word IS the announcement.
 */
export const SEND_DELIVERY_LABEL: Readonly<
	Partial<Record<SendDeliveryState, string>>
> = {
	mailbox:
		"delivered, wake unconfirmed — the wake got no answer, so they will read it on their next turn. Check the target's transcript before resending.",
	unconfirmed:
		"delivery unconfirmed — it may still arrive, so check the target's transcript before resending.",
};

/**
 * Whether a state is the amber middle: settled without a failure claim, yet not
 * the plain success either. This is what swaps the row's tick for the warning
 * mark — `delivered` and `failed` keep the glyph their tool state already
 * earned.
 */
export function isPartialDelivery(
	state: SendDeliveryState | null | undefined,
): state is "mailbox" | "unconfirmed" {
	return state === "mailbox" || state === "unconfirmed";
}

/**
 * The accessible name a `send` row carries for its delivery state, or `null`
 * when the state adds nothing to the row's existing name.
 *
 * `failed` speaks its word only ("not delivered" is the whole statement);
 * `delivered` adds nothing; the amber pair speaks the full hedge. The row
 * appends this to its existing name, so the reader still hears which call and
 * which target the sentence is about.
 */
export function deliveryAccessibleName(
	state: SendDeliveryState | null | undefined,
): string | null {
	if (state === null || state === undefined) return null;
	if (state === "failed") return SEND_DELIVERY_WORD.failed ?? null;
	return SEND_DELIVERY_LABEL[state] ?? null;
}
