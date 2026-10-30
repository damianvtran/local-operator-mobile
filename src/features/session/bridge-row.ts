/**
 * The `bridge` tool's row, as the phone reads it.
 *
 * WHY A FIRST-CLASS ROW. `bridge` is the agent's Team Bridge tool: it posts to a
 * channel, DMs a teammate, reacts, reads a directory. Rendered as a generic tool
 * row it showed the word `bridge`, a machine summary and — worst — a settled
 * tick on a message that never reached a conversation (the peer-inbox path),
 * which is exactly the "it went" reading that makes a person resend or assume a
 * colleague saw something they did not. The desktop and TUI lane
 * (local-operator c733bb5b44de) fixed the contract at the source: the relay now
 * sends `entry.summary` already localized for bridge rows (never an opaque
 * `bcv_…` id), and attaches a structured `details.bridge_row`:
 *
 *   { op, action, target: { kind, label }, preview, count, emoji,
 *     outcome: null | inbox_only | refused | failed | unconfirmed
 *              | awaiting_acceptance,
 *     code }
 *
 * This module turns that payload into what the row paints. It is pure (no
 * React) so `vitest` pins every arm in Node, the way `delivery.ts` pins the
 * send row's states.
 *
 * THE RULES, each the contract's, not this file's invention:
 *
 *   - **Parse defensively; unknown reads as absent.** A missing, non-object or
 *     malformed `bridge_row` — an older relay, or a future field this build does
 *     not know — yields `null`, and the row keeps the generic treatment (icon
 *     and headline only, no outcome word). An outcome string this build does not
 *     know is `null` too: inventing a verdict for it would be this surface
 *     claiming something the relay did not say. The same forward-only rule
 *     `deliveryStateFromDetails` follows.
 *   - **`inbox_only` is never success.** The message landed in a peer's inbox,
 *     not in a conversation anyone reads; it is painted amber with its own words
 *     and the warning mark, never the tick.
 *   - **No opaque ids on the headline.** The relay promises a localized summary,
 *     but a mixed-build frame (an older relay beside this client) may still
 *     carry `bcv_…`/`bcmsg_…`/`acc_…`/`ep_…` tokens; those are stripped here so
 *     the one line a reader scans never shows an id they cannot act on. The raw
 *     output block in the expansion is untouched — that is where ids belong.
 */

import type { TranscriptEntry } from "@/contracts";

/** The tool's own name on the wire (the core's tool registry). */
export const BRIDGE_TOOL_NAME = "bridge";

export type BridgeOutcome =
	| "inbox_only"
	| "refused"
	| "failed"
	| "unconfirmed"
	| "awaiting_acceptance";

export type BridgeTargetKind =
	| "channel"
	| "dm"
	| "person"
	| "message"
	| "directory"
	| "none";

const OUTCOMES: ReadonlySet<string> = new Set<BridgeOutcome>([
	"inbox_only",
	"refused",
	"failed",
	"unconfirmed",
	"awaiting_acceptance",
]);

const TARGET_KINDS: ReadonlySet<string> = new Set<BridgeTargetKind>([
	"channel",
	"dm",
	"person",
	"message",
	"directory",
	"none",
]);

/** The parsed payload: only the fields this client renders, each narrowed. */
export interface BridgeRow {
	op: string | null;
	action: string | null;
	targetKind: BridgeTargetKind;
	/** The relay's human label for the target (a channel or person name), or
	 *  `null` when absent or when it is itself an opaque id. */
	targetLabel: string | null;
	preview: string | null;
	count: number | null;
	emoji: string | null;
	/** `null` is the settled, unremarkable case: nothing to say beside the row. */
	outcome: BridgeOutcome | null;
	code: string | null;
}

/** Whether a row is a bridge row at all — the gate every reader goes through,
 *  so a lookalike `bridge_row` key on another tool never grows the treatment
 *  (the `sendDeliveryStateOf` lesson). */
export const isBridgeRow = (
	entry: Pick<TranscriptEntry, "tool_name">,
): boolean => entry.tool_name.toLowerCase() === BRIDGE_TOOL_NAME;

const stringOrNull = (value: unknown): string | null =>
	typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/**
 * Opaque Team Bridge ids: conversation (`bcv_`), message (`bcmsg_`), account
 * (`acc_`) and endpoint (`ep_`). Word-bounded so a real word that merely
 * contains `ep_` mid-token is left alone; the tail is the id alphabet the core
 * mints (letters, digits, `-` and `_`).
 */
const OPAQUE_ID = /\b(?:bcv|bcmsg|acc|ep)_[A-Za-z0-9_-]+/g;
const RUNS_OF_SPACE = /\s+/g;
/** A separator an id leaves dangling once removed: one followed directly by
 *  another separator or by the end (`to bcv_x · hi` → `to · hi`, not `to  · hi`). */
const ORPHAN_SEPARATOR = /(^|\s)[·→:,]\s*(?=[·→:,]|$)/g;
/** A separator left LEADING the line (`→ acc_1 · hi` → `· hi`): it names a
 *  target that is no longer there, so it goes too. */
const LEADING_SEPARATOR = /^[·→:,]\s*/;

/** Remove opaque ids and tidy the separators they leave behind. */
export const scrubOpaqueIds = (text: string): string =>
	text
		.replace(OPAQUE_ID, "")
		.replace(RUNS_OF_SPACE, " ")
		.replace(ORPHAN_SEPARATOR, "$1")
		.replace(RUNS_OF_SPACE, " ")
		.trim()
		.replace(LEADING_SEPARATOR, "");

/**
 * `details.bridge_row`, narrowed — or `null` for a non-bridge row or a payload
 * this build cannot read. Read through an untyped record on purpose: the field
 * is newer than the hand-authored wire mirror (`types.gen.ts`), and the shape is
 * re-narrowed field by field here rather than asserted.
 */
export function bridgeRowOf(
	entry: Pick<TranscriptEntry, "tool_name" | "details">,
): BridgeRow | null {
	if (!isBridgeRow(entry)) return null;
	const details: unknown = entry.details;
	if (details === null || typeof details !== "object") return null;
	const raw = (details as Record<string, unknown>).bridge_row;
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		return null;
	const row = raw as Record<string, unknown>;
	const target =
		row.target !== null &&
		typeof row.target === "object" &&
		!Array.isArray(row.target)
			? (row.target as Record<string, unknown>)
			: {};
	const kind = typeof target.kind === "string" ? target.kind : "none";
	const label = stringOrNull(target.label);
	const scrubbedLabel =
		label === null ? null : stringOrNull(scrubOpaqueIds(label));
	const outcome =
		typeof row.outcome === "string" && OUTCOMES.has(row.outcome)
			? (row.outcome as BridgeOutcome)
			: null;
	return {
		op: stringOrNull(row.op),
		action: stringOrNull(row.action),
		targetKind: TARGET_KINDS.has(kind) ? (kind as BridgeTargetKind) : "none",
		targetLabel: scrubbedLabel,
		preview: stringOrNull(row.preview),
		count:
			typeof row.count === "number" && Number.isFinite(row.count)
				? row.count
				: null,
		emoji: stringOrNull(row.emoji),
		outcome,
		code: stringOrNull(row.code),
	};
}

/**
 * The relay's rendered WORDS for one bridge row — `details.bridge_copy`.
 *
 * The daemon renders these from the core's `wire.tool_rows.bridge.*`
 * catalogue in the reader's locale (local-operator #3205,
 * `local_operator/mobile/projection.py::_bridge_copy`), and this app paints
 * them VERBATIM. That is the whole point of the field: three surfaces, one
 * translation, so the phone mints no copy of its own for anything the relay
 * already decided. `outcome` is `""` for a plain landed call, and
 * `refused`/`failed` arrive with ` · <code>` already appended.
 *
 * A missing or malformed payload is `null`, and the row then shows **no
 * chip** — the relay's own rule ("if bridge_copy is missing, the relay shows
 * no chip; it never guesses English"), mirrored rather than second-guessed.
 */
export interface BridgeCopy {
	/** The chip's word; `""` when the call is unremarkable. */
	outcome: string;
	/** The expansion's headline (the relay's, with ids kept out by the core). */
	headline: string;
	/** The expanded card's sentence: what the outcome means, in words. */
	outcomeSentence: string;
}

export function bridgeCopyOf(
	entry: Pick<TranscriptEntry, "tool_name" | "details">,
): BridgeCopy | null {
	if (!isBridgeRow(entry)) return null;
	const details: unknown = entry.details;
	if (details === null || typeof details !== "object") return null;
	const raw = (details as Record<string, unknown>).bridge_copy;
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		return null;
	const copy = raw as Record<string, unknown>;
	return {
		outcome: typeof copy.outcome === "string" ? copy.outcome.trim() : "",
		headline:
			typeof copy.headline === "string" ? scrubOpaqueIds(copy.headline) : "",
		outcomeSentence:
			typeof copy.outcome_sentence === "string"
				? copy.outcome_sentence.trim()
				: "",
	};
}

/**
 * The one line the collapsed row and its spoken name lead with: the relay's
 * rendered headline (`bridge_copy.headline`), else its localized `summary` —
 * which is the same decision made for the older relay that sent no
 * `bridge_copy` — with opaque ids stripped. The tool's own name is the last
 * resort, so the line is never blank (a row still composing).
 */
export const bridgeHeadline = (
	entry: Pick<TranscriptEntry, "summary" | "tool_name">,
	copy: BridgeCopy | null = null,
): string => copy?.headline || scrubOpaqueIds(entry.summary) || entry.tool_name;

/** Which ink an outcome's chip takes, and which mark the row shows beside it. */
export type BridgeOutcomeTone = "warning" | "danger" | "muted";

/**
 * The mark for an outcome, where the desktop row paints one of its own
 * (local-operator-ui #1529): `MessageSquareOff` for a peer inbox and
 * `Hourglass` for a post nobody has accepted yet. The other three keep the
 * shared tool-state glyphs, and no mark is the only channel
 * (`components.md` § 2.6): each also carries the relay's word beside it.
 */
export type BridgeMark = "message-off" | "hourglass" | null;

export const bridgeMark = (row: BridgeRow | null): BridgeMark =>
	row?.outcome === "inbox_only"
		? "message-off"
		: row?.outcome === "awaiting_acceptance"
			? "hourglass"
			: null;

const OUTCOME_TONE: Readonly<Record<BridgeOutcome, BridgeOutcomeTone>> = {
	inbox_only: "warning",
	refused: "danger",
	failed: "danger",
	unconfirmed: "muted",
	awaiting_acceptance: "muted",
};

export interface BridgeOutcomeView {
	/** The relay's own word, printed as sent. */
	text: string;
	tone: BridgeOutcomeTone;
}

/**
 * The chip beside the row: the relay's `bridge_copy.outcome`, or `null` when
 * the relay sent no words (no chip, never a guess) or the outcome token is one
 * this build cannot name a tone for. The tone comes from the machine token
 * (`bridge_row.outcome`), never from the sentence — copy is not a data
 * channel, the same rule the send row's delivery states follow.
 */
export function bridgeOutcomeView(
	row: BridgeRow | null,
	copy: BridgeCopy | null,
): BridgeOutcomeView | null {
	if (row === null || row.outcome === null) return null;
	if (copy === null || copy.outcome === "") return null;
	return { text: copy.outcome, tone: OUTCOME_TONE[row.outcome] };
}

/**
 * The target's own name for the expansion (`#release`, a person), when the
 * relay sent one that is not an opaque id. There is no invented kind word any
 * more: the relay's `bridge_copy` says what happened in a sentence, and a
 * second, app-minted label would be copy the daemon never approved.
 */
export const bridgeTargetLabel = (row: BridgeRow | null): string | null =>
	row?.targetLabel ?? null;

/**
 * The message body the agent sent, for the expansion's markdown block: the
 * call's `body` (the tool's own argument) or `text`, as a string. The relay
 * keeps that argument's newlines so markdown renders (`projection.py`,
 * `_compact_multiline`). Anything else is `null`, and the row falls back to
 * its generic args block.
 */
export function bridgeBody(
	entry: Pick<TranscriptEntry, "tool_name" | "details">,
): string | null {
	if (!isBridgeRow(entry)) return null;
	const args = entry.details.args;
	if (args === null || typeof args !== "object") return null;
	return stringOrNull(args.body) ?? stringOrNull(args.text);
}
