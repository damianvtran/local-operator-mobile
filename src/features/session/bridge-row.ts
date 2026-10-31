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
 * mints none of its own — a second translation of one decision is the drift the
 * shared copy exists to remove. No words means NO CHIP, never guessed English.
 *
 * **BUT COPY IS NOT A DATA CHANNEL** (design round 2, R7). Ink, mark and the
 * spoken state all come from the machine token `bridge_row.outcome`, which a
 * relay sends whether or not it could render words. Reading them through the
 * copy let a copy-less peer-inbox row paint the success tick and a copy-less
 * refusal announce "bridge done".
 *
 * THE SPLIT BETWEEN THE ROW AND THE CARD is the relay SPA's (its
 * `bridgeSummary` / `BridgeExpansion`, `mobile/web/src/components/tool-row.tsx`):
 *
 *   - the ROW paints `entry.summary` — verb, target and the message PREVIEW,
 *     with the outcome TAIL stripped (the chip already says that) and every
 *     opaque id removed;
 *   - the CARD paints `bridge_copy.headline`, the daemon's rendered title.
 *
 * This module is pure (no React), so `vitest` pins every arm in Node the way
 * `delivery.ts` pins the send row's states.
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
 * are on the wire and are already inside `entry.summary` (the relay renders
 * them into it); narrowing fields nothing paints was design round 1's N1.
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
 *  so a lookalike `bridge_row` key on another tool never grows the treatment
 *  (the `sendDeliveryStateOf` lesson). Defensive about a missing name: an entry
 *  with no `tool_name` is "not a bridge row", never a throw (design round 1,
 *  N3). */
export const isBridgeRow = (entry: { tool_name?: unknown }): boolean =>
	typeof entry.tool_name === "string" &&
	entry.tool_name.toLowerCase() === BRIDGE_TOOL_NAME;

const stringOrNull = (value: unknown): string | null =>
	typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/**
 * Opaque Team Bridge ids: conversation (`bcv_`), message (`bcmsg_`), account
 * (`acc_`) and endpoint (`ep_`). The tail takes `_` and `-` too — real ids
 * include `acc_remote_9` and `ep_01J-ABC` — and the front boundary is a word
 * break, so an `ep_` inside a real word survives. Kept in step with the relay's
 * `_BRIDGE_ID_RE`.
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

/** A separator with nothing after it (`· …`, `· ·`, a trailing `·`) is an
 *  artefact of stripping an id or an outcome tail, so it goes: a line that ends
 *  on a dot reads as a defect even when every word in it is right (design round
 *  2, N1). */
const TRAILING_SEPARATOR = /\s*(?:·\s*)+(?:…)?\s*$/;
const tidyTail = (text: string): string =>
	text.replace(TRAILING_SEPARATOR, "").trim();

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
 * The daemon renders these from the core's `wire.tool_rows.bridge.*` catalogue
 * in the reader's locale (local-operator #3205,
 * `local_operator/mobile/projection.py::_bridge_copy`) and this app paints them
 * VERBATIM. `outcome` is `""` for a plain landed call, and `refused`/`failed`
 * arrive with ` · <code>` already appended.
 *
 * A missing or malformed payload is `null`, and the row then shows **no
 * chip** — the relay's own rule ("if bridge_copy is missing, the relay shows no
 * chip; it never guesses English"), mirrored rather than second-guessed. The
 * row's INK and MARK do not depend on this (see `bridgeToneOf`).
 */
export interface BridgeCopy {
	/** The chip's word; `""` when the call is unremarkable. */
	outcome: string;
	/** The card's title (the relay keeps ids out of it). */
	headline: string;
	/** The card's sentence: what the outcome means, in words. */
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
 * The chip's ink. Three tones, not four: the two PENDING outcomes share the
 * amber `warning` ink with `inbox_only` rather than a muted grey. A settled tick
 * beside "awaiting acceptance" reads as done, and the reader's next move (wait,
 * or check) depends on it not reading that way — the relay's own D1/D6 and the
 * app's `partial` send arm take the same view.
 */
export type BridgeOutcomeTone = "warning" | "danger" | "pending";

const OUTCOME_TONE: Readonly<Record<BridgeOutcome, BridgeOutcomeTone>> = {
	inbox_only: "warning",
	refused: "danger",
	failed: "danger",
	unconfirmed: "pending",
	awaiting_acceptance: "pending",
};

/** The outcome's ink, from the MACHINE TOKEN alone (design round 2, R7): a row
 *  whose words the relay withheld still carries `inbox_only` / `refused` here. */
export const bridgeToneOf = (
	row: BridgeRow | null,
): BridgeOutcomeTone | null =>
	row === null || row.outcome === null ? null : OUTCOME_TONE[row.outcome];

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
 * The chip beside the row: the relay's words, split at the ` · ` it appended
 * itself, or `null` when the relay sent none (no chip, never a guess) or the
 * token is one this build cannot name a tone for.
 */
export function bridgeOutcomeView(
	row: BridgeRow | null,
	copy: BridgeCopy | null,
): BridgeOutcomeView | null {
	const tone = bridgeToneOf(row);
	if (tone === null) return null;
	if (copy === null || copy.outcome === "") return null;
	const text = scrubOpaqueIds(copy.outcome);
	if (text === "") return null;
	const separator = text.indexOf(" · ");
	return {
		text,
		word: separator > 0 ? text.slice(0, separator) : text,
		code: separator > 0 ? text.slice(separator) : "",
		tone,
	};
}

/**
 * The mark the identity column draws, where the desktop row paints one of its
 * own (local-operator-ui #1529): `MessageSquareOff` for a peer inbox and
 * `Hourglass` for a post nobody has accepted yet. Keyed on the token, like the
 * ink, so a copy-less row keeps its mark.
 */
export type BridgeMark = "message-off" | "hourglass" | null;

export const bridgeMark = (row: BridgeRow | null): BridgeMark =>
	row?.outcome === "inbox_only"
		? "message-off"
		: row?.outcome === "awaiting_acceptance"
			? "hourglass"
			: null;

/**
 * The row's leading GLYPH — ONE decision site (design round 1 R2, round 2
 * R7/R8). Keyed on `bridge_row.outcome`, never on `bridge_copy`: the state
 * column must not claim a delivery the relay has already qualified, and a row
 * whose words were withheld is exactly the case where a silent tick lies.
 *
 * `null` means "no override": the caller paints the tool state's own glyph,
 * which is the row every other tool draws.
 */
export interface BridgeGlyphOverride {
	glyph: "!" | "✗";
	/** Tailwind ink class, matching the tone. */
	inkClass: string;
	/** Only a running call pulses; an override is a settled fact. */
	pulsing: false;
}

export function bridgeGlyphFor(
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

/* --------------------------------------------------------------- the chip */

/**
 * How the chip is painted for a given row width — a decision, not a guess at
 * render time, because Q1 (design round 2) measured the WORD clipping
 * mid-phrase (`not posted to a con…` at 390, `delivery unconfi…` at 320). Server
 * copy is never re-worded here, so a phrase that does not fit is not shown at
 * all:
 *
 *   - `words`    — the word (and its code) fit the cap;
 *   - `mark`     — a marked outcome collapses to its identity mark (the relay
 *                  SPA's own `sr-only` arm); the word stays in the accessible
 *                  name;
 *   - `own-line` — an UNMARKED long word (no mark to fall back to) moves to its
 *                  own full-width line instead of truncating.
 *
 * The fit is ESTIMATED from the app's type scale — React Native offers no text
 * measurement seam here — so the estimate rounds its per-character width UP and
 * the frames at 320/360/390/150 % are what confirm it.
 */
export type BridgeChipLayout = "words" | "mark" | "own-line";

/** 24 rem and 18 rem, the relay's own thresholds, in points. */
export const BRIDGE_CHIP_FULL_MIN_PT = 384;

const CHIP_CHAR_PT = 6.5;

/** The slack a phrase must have before it is called fitting, in points. It buys
 *  the estimate its one-sided error: a phrase that is merely close goes to its
 *  own line rather than to an ellipsis (Q1). */
const CHIP_FIT_MARGIN_PT = 4;

const CHIP_WIDE_CAP = 0.55;
const CHIP_NARROW_CAP = 0.4;

/** Whether `word` fits the chip's share of a row `rowWidthPt` wide.
 *
 *  The base is `rowWidthPt × cap` — the exact box the chip's `maxWidth` style
 *  gives it. The earlier estimate subtracted the row's own padding and chrome
 *  again (both already gone from `rowWidthPt`) and so measured a 82 pt box where
 *  the render allows 137 pt (D10). */
export const bridgeChipFits = (
	rowWidthPt: number,
	word: string,
	scale = 1,
): boolean => {
	const cap =
		rowWidthPt >= BRIDGE_CHIP_FULL_MIN_PT ? CHIP_WIDE_CAP : CHIP_NARROW_CAP;
	const available = rowWidthPt * cap - CHIP_FIT_MARGIN_PT;
	return word.length * CHIP_CHAR_PT * scale <= available;
};

export const bridgeChipLayout = (
	rowWidthPt: number,
	word: string,
	hasMark: boolean,
	scale = 1,
): BridgeChipLayout => {
	if (word === "" || bridgeChipFits(rowWidthPt, word, scale)) return "words";
	if (hasMark) return "mark";
	/* Unmarked and too long for its cap: at the narrowest width even the cap is
	 * not the constraint, the row is — so the word takes its own line. Above
	 * that, `mark` is impossible without a mark, and a clipped phrase is the one
	 * thing Q1 rules out; the own-line arm is the only honest layout left. */
	return "own-line";
};

/** The code is dropped WHOLE below the widest bucket — never cut mid-token
 *  (relay D3/D9): a reader who sees `not_a_m` cannot search for it. */
export const bridgeChipShowsCode = (rowWidthPt: number): boolean =>
	rowWidthPt >= BRIDGE_CHIP_FULL_MIN_PT;

/* ------------------------------------------------------------ the row line */

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
	const text = tidyTail(scrubOpaqueIds(entry.summary) || entry.tool_name);
	const outcome = bridgeOutcomeView(row, copy);
	/* No words: the tail is still THERE, spelled with the machine tokens the
	 *  relay's `bridge_row_line` composes (` · refused · not_a_member`). Strip it
	 *  by token — the tokens are the wire's own spelling, not a translation — so
	 *  a copy-less row does not end on the separator its un-stripped tail left
	 *  behind (round 2, N1: `Couldn't post in #leadership · Heads-up ·…`). */
	if (outcome === null) {
		const tokens = outcomeTokenWords(row);
		if (tokens === "") return text;
		const spellings = [
			row?.code === null || row?.code === undefined
				? `${tokens}`
				: `${tokens} · ${row.code}`,
			tokens,
		];
		const stripped = spellings.find((tail) => text.endsWith(` · ${tail}`));
		return stripped === undefined
			? text
			: tidyTail(text.slice(0, -(stripped.length + 3)));
	}
	const full = ` · ${outcome.text}`;
	if (text.endsWith(full)) return tidyTail(text.slice(0, -full.length));
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
	return tidyTail(cut >= 0 ? text.slice(0, cut) : text);
}

/**
 * Whether a card's raw output is a LONE RECEIPT — one lowercase word, no spaces
 * (`ok`, `sent`). A bridge card states its outcome in the daemon's sentence, so
 * a one-word receipt in a sunken well is furniture that outweighs the sentence
 * and says nothing (QA round 2, Q2). Anything longer is real text and stays.
 */
export const isLoneReceiptLine = (lines: readonly string[]): boolean =>
	lines.length === 1 && /^[a-z]{1,8}$/.test((lines[0] ?? "").trim());

/** The card's title: the daemon's rendered headline, or `""` when it sent none
 *  (the card then opens on its sentence and body rather than inventing one). */
export const bridgeCardHeadline = (copy: BridgeCopy | null): string =>
	copy?.headline ?? "";

/* -------------------------------------------------------- the spoken name */

/** The wire's outcome token, read as words: `inbox_only` → `inbox only`. The
 *  token is a machine identifier whose spelling is stable and English, so it can
 *  be spoken where the relay sent no sentence — it is NOT a translation of the
 *  daemon's copy, which is exactly why it is used only when copy is absent. */
const outcomeTokenWords = (row: BridgeRow | null): string =>
	row?.outcome === null || row?.outcome === undefined
		? ""
		: row.outcome.replace(/_/g, " ");

/**
 * The accessible name for a bridge row (design round 1 R1, round 2 R7).
 *
 * `bridge <state>[, <the relay's chip or the token's own words>], <row line>`:
 *
 *   - the STATE is the outcome's when the outcome qualifies it — a refusal is a
 *     failed call whatever the tool reported, and "bridge done" spoken for one
 *     is the misreport this row exists to prevent;
 *   - the middle part is the relay's rendered word, or the token's words when
 *     the relay sent none, so a copy-less row is never just a headline;
 *   - the noun keeps "which tool was this" answerable, because the visible name
 *     on a bridge row is an icon.
 */
export function bridgeAccessibleName(
	entry: Pick<TranscriptEntry, "tool_name" | "tool_state" | "summary">,
	row: BridgeRow | null,
	copy: BridgeCopy | null,
): string {
	const line = bridgeRowSummary(entry, copy, row);
	const chip = bridgeOutcomeView(row, copy)?.text ?? "";
	const state = bridgeToneOf(row) === "danger" ? "failed" : entry.tool_state;
	const spoken = chip !== "" ? chip : outcomeTokenWords(row);
	/* `bridge failed, <words>, <line>` — the noun and the state are one phrase
	 * ("bridge failed"), the rest are clauses. */
	const rest = [spoken, line === BRIDGE_TOOL_NAME ? "" : line].filter(
		(part) => part !== "",
	);
	return [`${BRIDGE_TOOL_NAME} ${state}`, ...rest].join(", ");
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
