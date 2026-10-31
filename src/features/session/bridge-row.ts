/**
 * The `bridge` tool's row, as the phone reads it.
 *
 * WHY A FIRST-CLASS ROW. `bridge` is the agent's Team Bridge tool: it posts to a
 * channel, DMs a teammate, reacts, reads a directory. Rendered as a generic tool
 * row it showed the word `bridge`, a machine summary and — worst — a settled
 * tick on a message that never reached a conversation (the peer-inbox path),
 * which is exactly the "it went" reading that makes a person resend or assume a
 * colleague saw something they did not.
 *
 * THE CONTRACT IS THE RELAY'S, field for field (local-operator
 * `feat/mobile-relay-bridge-row`, `mobile/projection.py`):
 *
 *   details.bridge_row  = { op, action, target: { kind, label }, preview,
 *                           count, emoji, outcome, code }
 *   details.bridge_copy = { outcome, headline, outcome_sentence }
 *
 * `bridge_row` is the FACTS (which op, where, how it ended); `bridge_copy` is
 * the WORDS, rendered server-side from the core's `wire.tool_rows.bridge.*`
 * catalogue in the reader's locale. This app paints those words verbatim and
 * mints none of its own — a second translation of one decision is the drift
 * the shared copy exists to remove. No words means NO CHIP, never guessed
 * English.
 *
 * THE SPLIT BETWEEN THE ROW AND THE CARD is the relay SPA's (its
 * `bridgeSummary` / `BridgeExpansion`, `mobile/web/src/components/tool-row.tsx`):
 *
 *   - the ROW paints `entry.summary` — verb, target and the message PREVIEW,
 *     with the outcome TAIL stripped (the chip already says that) and every
 *     opaque id removed;
 *   - the CARD paints `bridge_copy.headline`, the daemon's rendered title.
 *
 * Painting the card's headline on the row instead (this module's first shape)
 * lost the preview and printed one string twice, which is what design round 1
 * measured as D1.
 *
 * This module is pure (no React), so `vitest` pins every arm in Node the way
 * `delivery.ts` pins the send row's states.
 *
 * THE RULES, each the contract's:
 *
 *   - **Parse defensively; unknown reads as absent.** A missing, non-object or
 *     malformed payload — an older relay, or a future field — yields `null`,
 *     and the row keeps the generic treatment. An outcome string this build
 *     does not know is `null` too: inventing a verdict for it would be this
 *     surface claiming something the relay did not say.
 *   - **No outcome is ever success ink.** `inbox_only` is a warning, the two
 *     pending outcomes are the app's `partial` amber (never the green tick: a
 *     write nobody confirmed must not scan as done), and a refusal is danger.
 *   - **No opaque ids on anything a reader scans.** The relay scrubs the copy
 *     on the wire; a mixed-build summary may still carry `bcv_`…, so the row
 *     scrubs again. The relay's own token set, matched the same way.
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

/**
 * The parsed tokens — only what this row READS. `preview`, `count` and `emoji`
 * are on the wire and are already in `entry.summary` (the relay renders them
 * into it); narrowing fields nothing paints was design round 1's N1.
 */
export interface BridgeRow {
	op: string | null;
	action: string | null;
	targetKind: BridgeTargetKind;
	/** The relay's human label for the target (a channel or person name), or
	 *  `null` when absent or when it is itself an opaque id. */
	targetLabel: string | null;
	/** `null` is the settled, unremarkable case: nothing to say beside the row. */
	outcome: BridgeOutcome | null;
	code: string | null;
}

/** Whether a row is a bridge row at all — the gate every reader goes through,
 *  so a lookalike payload on another tool never grows the treatment (the
 *  `sendDeliveryStateOf` lesson). Non-string `tool_name` (a malformed frame)
 *  reads as "not a bridge row" rather than throwing: this module's first rule
 *  is that unknown input falls back to the generic row. */
export const isBridgeRow = (
	entry: Pick<TranscriptEntry, "tool_name">,
): boolean =>
	typeof entry.tool_name === "string" &&
	entry.tool_name.toLowerCase() === BRIDGE_TOOL_NAME;

const stringOrNull = (value: unknown): string | null =>
	typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/**
 * Opaque Team Bridge ids: conversation (`bcv_`), message (`bcmsg_`), account
 * (`acc_`) and endpoint (`ep_`). Word-bounded so a real word that merely
 * contains `ep_` mid-token is left alone; the tail is the id alphabet the core
 * mints (letters, digits, `-` and `_`) — the same token set the relay's
 * `_BRIDGE_ID_RE` uses, case-insensitively, because a real id can carry either
 * case and a tail with `-` (`ep_01J-ABC`) must not leave its second half.
 */
const OPAQUE_ID = /\b(?:bcv|bcmsg|acc|ep)_[A-Za-z0-9_-]+/gi;
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
		outcome,
		code: stringOrNull(row.code),
	};
}

/**
 * The relay's rendered WORDS for one bridge row — `details.bridge_copy`.
 *
 * Rendered by the daemon from the core's `wire.tool_rows.bridge.*` catalogue
 * (`harness/bridge_copy.py`), already id-free on the wire
 * (`projection.py::_bridge_copy` scrubs all three values). `outcome` is `""`
 * for a plain landed call, and `refused`/`failed` arrive with ` · <code>`
 * already appended. A missing or malformed payload is `null`, and the row then
 * shows no chip — the relay's own rule, mirrored rather than second-guessed.
 */
export interface BridgeCopy {
	/** The chip's whole text: the word, plus ` · <code>` for a refusal. */
	outcome: string;
	/** The daemon's title for the expanded card. */
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

/** The chip split into its word and its code — see `bridgeOutcomeView`. */
export interface BridgeOutcomeView {
	/** The whole relay text, for the accessible name and the full width. */
	text: string;
	/** The word alone (`refused`, `not posted to a conversation`). */
	word: string;
	/** ` · <code>` as the relay appended it, or `""`. */
	code: string;
	tone: BridgeOutcomeTone;
}

/**
 * The chip's ink. Three tones, not four: the two PENDING outcomes share the
 * amber `warning` ink with `inbox_only` rather than a muted grey. A settled
 * tick beside "awaiting acceptance" reads as done, and the reader's next move
 * (wait, or check) depends on it not reading that way — the relay's own D1/D6
 * and the app's `partial` send arm take the same view.
 */
export type BridgeOutcomeTone = "warning" | "danger" | "pending";

const OUTCOME_TONE: Readonly<Record<BridgeOutcome, BridgeOutcomeTone>> = {
	inbox_only: "warning",
	refused: "danger",
	failed: "danger",
	unconfirmed: "pending",
	awaiting_acceptance: "pending",
};

/**
 * The chip beside the row: the relay's words, split at the ` · ` it appended
 * itself, or `null` when the relay sent none (no chip, never a guess) or the
 * token is one this build cannot name a tone for. The tone comes from the
 * machine token, never from the sentence — copy is not a data channel.
 */
export function bridgeOutcomeView(
	row: BridgeRow | null,
	copy: BridgeCopy | null,
): BridgeOutcomeView | null {
	if (row === null || row.outcome === null) return null;
	if (copy === null || copy.outcome === "") return null;
	const text = scrubOpaqueIds(copy.outcome);
	if (text === "") return null;
	const separator = text.indexOf(" · ");
	return {
		text,
		word: separator > 0 ? text.slice(0, separator) : text,
		code: separator > 0 ? text.slice(separator) : "",
		tone: OUTCOME_TONE[row.outcome],
	};
}

/**
 * The row's leading GLYPH, as a decision rather than a render (design round 1,
 * R2): `bridgeGlyphFor` had grown inside the component, where no Node test can
 * reach it, and it is the one place the "never a success tick for an unconfirmed
 * write" rule lives.
 *
 * The three tones map to the app's existing vocabulary:
 *   - `warning` / `pending` take the `!` partial mark in amber — the same arm the
 *     send row uses for a wake-unconfirmed delivery, so one scan of the glyph
 *     column never says "done" for a write nobody confirmed;
 *   - `danger` takes `✗` in danger ink;
 *   - no chip, or a relay that sent no words, keeps the tool state's own glyph
 *     (`toolGlyph`), which is the row every other tool paints.
 */
export type BridgeGlyphDecision =
	| { kind: "partial" }
	| { kind: "failed" }
	| { kind: "state" };

export const bridgeGlyphFor = (
	row: BridgeRow | null,
	copy: BridgeCopy | null,
): BridgeGlyphDecision => {
	const tone = bridgeOutcomeView(row, copy)?.tone;
	if (tone === "danger") return { kind: "failed" };
	/* A refusal whose words the relay withheld has no tone to read, but it is
	 * still a failed call: the tool state carries it, and the state glyph is ✗. */
	if (tone === undefined) return { kind: "state" };
	if (tone === "pending" || tone === "warning") return { kind: "partial" };
	return { kind: "state" };
};

/**
 * The mark the identity column draws, where the desktop row paints one of its
 * own (local-operator-ui #1529): `MessageSquareOff` for a peer inbox and
 * `Hourglass` for a post nobody has accepted yet.
 */
export type BridgeMark = "message-off" | "hourglass" | null;

export const bridgeMark = (row: BridgeRow | null): BridgeMark =>
	row?.outcome === "inbox_only"
		? "message-off"
		: row?.outcome === "awaiting_acceptance"
			? "hourglass"
			: null;

/**
 * What the STATE column shows, as a decision rather than a render.
 *
 * Extracted from the component so every arm is testable in Node (design round
 * 1, D2 measured a green tick on "awaiting acceptance", which no test could
 * have caught while the mapping lived in a closure):
 *
 *   - `inbox_only` and the two PENDING outcomes take the app's `partial` arm —
 *     `!` in warning ink, the same treatment a wake-unconfirmed `send` gets;
 *   - `refused`/`failed` take the failure mark in danger ink;
 *   - everything else (including a row with no readable outcome) keeps the
 *     tool state's own glyph and ink.
 *
 * Never the only channel: each of these also carries the chip's word
 * (`components.md` § 2.6).
 */
export interface BridgeGlyphOverride {
	glyph: "!" | "✗";
	/** Tailwind ink class, matching the tone. */
	inkClass: string;
	/** Only a running call pulses; an override is a settled fact. */
	pulsing: false;
}

export function bridgeGlyphOverride(
	row: BridgeRow | null,
): BridgeGlyphOverride | null {
	if (row === null || row.outcome === null) return null;
	switch (row.outcome) {
		case "inbox_only":
		case "unconfirmed":
		case "awaiting_acceptance":
			return { glyph: "!", inkClass: "text-warning", pulsing: false };
		case "refused":
		case "failed":
			return { glyph: "✗", inkClass: "text-danger", pulsing: false };
	}
}

/**
 * The row's one line: the relay's summary, id-free, with the outcome tail the
 * chip already shows REMOVED.
 *
 * The daemon's summary (`bridge_row_line`) ends ` · <outcome>` because a
 * single-cell surface has no status cap of its own; this row has the chip, so
 * leaving the tail would print the caveat twice. The strip order is the relay
 * SPA's `bridgeSummary`, which needed three rounds to get right and is copied
 * here rather than re-derived:
 *
 *   1. the FULL outcome, matched by TEXT (a refusal's outcome is itself two
 *      segments — `refused · not_a_member` — so splitting on the last ` · `
 *      would compare only `not_a_member` and miss);
 *   2. a CAP of it: the projection compacts from the right, so the tail may
 *      arrive cut anywhere, including inside the separator (`· refus…`,
 *      `· refused · not_a…`, `· …`). Walk the separators from the end and keep
 *      the outermost whose stub is empty or a prefix of the outcome.
 */
export function bridgeRowSummary(
	entry: Pick<TranscriptEntry, "summary" | "tool_name">,
	copy: BridgeCopy | null,
	row: BridgeRow | null,
): string {
	const text = scrubOpaqueIds(entry.summary) || entry.tool_name;
	const outcome = bridgeOutcomeView(row, copy);
	if (outcome === null) return text;
	const full = ` · ${outcome.text}`;
	if (text.endsWith(full)) return text.slice(0, -full.length);
	if (!text.endsWith("…")) return text;
	let capped = text.slice(0, -1);
	if (capped.endsWith(" ·")) capped += " ";
	let cut = -1;
	for (
		let separator = capped.lastIndexOf(" · ");
		separator >= 0;
		separator = capped.lastIndexOf(" · ", separator - 1)
	) {
		const tail = capped.slice(separator + 3).trimEnd();
		if (tail.length > outcome.text.length) break;
		if (tail === "" || outcome.text.startsWith(tail)) cut = separator;
	}
	return cut >= 0 ? text.slice(0, cut) : text;
}

/** The card's title: the daemon's rendered headline, or `""` when it sent none
 *  (the card then opens on its sentence and body rather than inventing one). */
export const bridgeCardHeadline = (copy: BridgeCopy | null): string =>
	copy?.headline ?? "";

/**
 * The accessible name for a bridge row (design round 1, R1).
 *
 * Three parts, in the order a screen reader should hear them: the stable
 * IDENTITY noun, the TOOL STATE, then the relay's chip word when there is one,
 * then the row line. The state is what keeps a row readable when the relay sent
 * no words — `bridge-nocopy`'s refused call must not announce a bare headline —
 * and the noun keeps "which tool was this" answerable, because the visible name
 * on a bridge row is an icon.
 *
 * Deliberately NOT invented here: an English word for the outcome token. With
 * no `bridge_copy` the relay has said nothing to print, and "refused" would be
 * this app minting copy the daemon owns (see the module header).
 */
export function bridgeAccessibleName(
	entry: Pick<TranscriptEntry, "tool_name" | "tool_state" | "summary">,
	row: BridgeRow | null,
	copy: BridgeCopy | null,
): string {
	const line = bridgeRowSummary(entry, copy, row);
	const chip = bridgeOutcomeView(row, copy)?.text ?? "";
	/* `bridge <state>[, <chip>][, <line>]` — the state never dropped: a refusal
	 * whose words the relay withheld must still announce that it failed. */
	const head = `${BRIDGE_TOOL_NAME} ${entry.tool_state}`;
	return [head, chip, line === BRIDGE_TOOL_NAME ? "" : line]
		.filter((part) => part !== "")
		.join(", ");
}

/**
 * The message body the agent sent, for the card's markdown block: the call's
 * `body` (the tool's own argument) or `text`. The relay keeps that argument's
 * newlines so markdown renders (`projection.py`, `_compact_multiline`).
 */
export function bridgeBody(
	entry: Pick<TranscriptEntry, "tool_name" | "details">,
): string | null {
	if (!isBridgeRow(entry)) return null;
	const args = entry.details.args;
	if (args === null || typeof args !== "object") return null;
	return stringOrNull(args.body) ?? stringOrNull(args.text);
}

/**
 * How much of the chip a row can show, from the row's own width.
 *
 * The relay SPA decides this with container queries (`@max-[24rem]`,
 * `@max-[18rem]`); React Native has none, so the same two thresholds are
 * applied to the measured row width instead. Measured on the shipped frames
 * (design round 1, D3): at 390 pt both the line and the chip truncated and the
 * chip had 13 pt MORE than the line, because the line had no floor and the chip
 * had only a cap.
 *
 *   - `full`      — the word and the code (a refusal keeps its code);
 *   - `capped`    — the word, the code dropped WHOLE (never cut mid-token);
 *   - `mark-only` — a marked chip collapses to its mark; its word stays in the
 *                   accessible name, which is this platform's equivalent of the
 *                   SPA's `sr-only` (RN has no such utility, and a zero-size
 *                   text node would be a lie about the layout).
 */
export type BridgeChipBucket = "full" | "capped" | "mark-only";

/** 24 rem and 18 rem, the relay's own thresholds, in points. */
export const BRIDGE_CHIP_FULL_MIN_PT = 384;
export const BRIDGE_CHIP_WORD_MIN_PT = 288;

export const bridgeChipBucket = (rowWidthPt: number): BridgeChipBucket =>
	rowWidthPt >= BRIDGE_CHIP_FULL_MIN_PT
		? "full"
		: rowWidthPt >= BRIDGE_CHIP_WORD_MIN_PT
			? "capped"
			: "mark-only";
