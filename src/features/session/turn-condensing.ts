/**
 * Turn condensing: the transcript's depth control, as pure arithmetic over the
 * rows it is given.
 *
 * WHY THIS EXISTS. A long conversation is mostly work the reader is done with —
 * tool rows, narration between calls — and on a phone that work is the scroll.
 * Condensing a COMPLETED turn replaces its middle with one summary bar (the
 * disclosure discipline of `components.md` § 14/15), so a fifty-turn
 * conversation still reads as fifty turns; the reader opens the one they want.
 *
 * THE INVARIANT — "no un-condense jitter" — IS WHAT THIS MODULE IS BUILT
 * AROUND, and it is stated here so a future change has to argue with it rather
 * than quietly break it:
 *
 *   1. THE ACTIVE (LAST) TURN IS NEVER CONDENSED. It is the turn being read
 *      and the turn still being written; collapsing it would hide live content
 *      and move the reader's anchor at the moment they are waiting on it. A
 *      turn only becomes condensable once a NEWER turn exists, which is also
 *      what makes completion itself safe: a turn finishing changes nothing on
 *      screen (the requirement's "a turn being completed must not pop the
 *      scroll position").
 *   2. ONCE A TURN IS CONDENSED IT STAYS CONDENSED — and its render is a
 *      constant of the latch, not of the frame. The latch (`CondensePlan.latch`)
 *      records a turn the moment it first condenses, with the facts a later
 *      render must not re-decide: the bar's `steps`/`durationS`, and the span
 *      of rows the collapse stands for. Nothing but the reader's own expansion
 *      changes its rendering afterwards — not a later frame that regresses the
 *      turn's rows (the transport-cap caveat in `completion-visibility.ts`),
 *      and not the relay's capped tail window (`projection.py::_cap_tail`),
 *      where the span's rows — eventually the closing answer itself — leave the
 *      projection while the pinned turn stays: a row is hidden by this turn iff
 *      it is in the frozen span, so a window that has slid past the span
 *      entirely still shows the bar (its numbers state what the collapse stood
 *      for), and the frame can neither re-open it, re-attach it to other rows,
 *      nor change its height.
 *   3. THE BAR'S WORDS ARE DECIDED ONCE. `steps`/`durationS` freeze into the
 *      latch at the condense moment, so a frame that mutates an old row cannot
 *      change the bar's string — and therefore cannot change its height.
 *
 * Completion is NOT invented here: a turn may condense only when its closing
 * answer is `entryComplete` (final AND text_complete — see
 * `completion-visibility.ts`), so every bar this module emits states a fact the
 * ack gate already trusts, and an interrupted or capped turn simply stays open
 * rather than being summarised by a word that would be false about it. That is
 * also why every condensed turn can say `completed`: the eligibility IS the
 * completion.
 *
 * The unit is a TURN: the rows between `user` rows, with steers folded in. The
 * mobile wire marks a mid-turn instruction (`kind: "steer"`), so unlike the web
 * client's partition — which can only see structural closure and must read a
 * user row that arrives mid-stream as a steer — a `user` row here always opens
 * a new turn. Rows before the first user row are a head-cut segment and are
 * never condensed: a bar over a turn whose opening the wire did not send could
 * not say WHICH turn it summarises, and "cannot honestly summarise" resolves to
 * "leave it visible" — the same direction `anchorBottomVisible` takes for
 * unknown geometry.
 *
 * DELIVERY RECEIPTS ARE THEIR OWN FOLD (the quiet group, design §5).
 * Consecutive `peer_message` rows — the receipts a quiet turn leaves behind —
 * fold into one bar in ANY turn, including the ACTIVE one, because that is
 * where they accumulate and the active turn is exactly the turn condensing may
 * never touch. The fold is a separate pass (`groupPlan`) over the planned
 * items, so it composes with the turn collapse rather than sharing its gates:
 * rows a turn collapse hides are not the group pass's business (the rows a
 * reader opens behind a turn's bar are simply more visible rows, and fold like
 * any other), and a turn collapse that later subsumes a group's rows stands for
 * them itself. A closed group's facts freeze (the latch) — except the
 * DESCRIPTIVE sender/intent metadata, which follows a corrected same-ID
 * receipt so the bar cannot contradict the row behind it (native U1); the open
 * tail group grows while its bar stays a single line; a group's key is
 * `qg:<first row id>`. The derivation — the same one every client is pinned to by
 * `fixtures/quiet-groups.parity.json` — is `quietGroupsOf` /
 * `quietGroupOfSpan`, and `groupPlan` is the fold the list renders.
 */

import type { TranscriptEntry } from "@/contracts";
import { entryComplete } from "@/features/session/completion-visibility";
import {
	buildFoldRun,
	type FoldRun,
	isFoldableToolEntry,
	isFoldReceiptEntry,
	isToolActionFailed,
	latchFoldedIds,
	MEDIA_ARTIFACT_TOOLS,
} from "@/features/session/fold-model";
import {
	bridgeReceiptLabel,
	canonicalRowKey,
	hubLabel,
	isBridgeReceipt,
	isHubReceipt,
	peerLabel,
} from "@/features/session/projection";
import { t } from "@/i18n";
import { elapsedLabel } from "@/lib/format";
import { foldBarId, quietGroupId, turnBarId } from "@/ui/a11y";

/* -------------------------------------------------------------------- turns */

/** One turn of the transcript: the rows from a `user` row to the row before the
 *  next `user` row, both indices inclusive into the entries list. */
export interface TranscriptTurn {
	/** The opening row's id — stable for the life of the transcript (rows only
	 *  append), and the key the reader's expansion and the latch are held by. */
	key: string;
	/** False for the leading segment when the wire's tail starts mid-turn. */
	opensWithUserRow: boolean;
	start: number;
	end: number;
}

const HARNESS_PREAMBLE_TYPES: ReadonlySet<string> = new Set([
	"system_prefix",
	"selected_model",
	"session_mcp_unavailable",
]);

const isHarnessPreambleNotice = (entry: TranscriptEntry): boolean => {
	if (entry.kind !== "notice") return false;
	const customType = entry.custom_type || entry.details.custom_kind || "";
	return HARNESS_PREAMBLE_TYPES.has(customType);
};

const hasExplicitCallsTools = (entry: TranscriptEntry): boolean =>
	(entry as TranscriptEntry & { calls_tools?: boolean }).calls_tools === true;

const isExplicitTerminalNotice = (entry: TranscriptEntry): boolean => {
	if (entry.kind !== "notice") return false;
	if ((entry as TranscriptEntry & { terminal?: boolean }).terminal === true) {
		return true;
	}
	const customType = entry.custom_type || entry.details.custom_kind || "";
	return (
		customType === "session_incident" || entry.details.severity === "error"
	);
};

const isQuietCloseEntry = (entry: TranscriptEntry): boolean =>
	entry.kind === "tool" &&
	entry.tool_name.trim().toLowerCase() === "no_reply" &&
	entry.tool_state === "done" &&
	!entry.error;

/**
 * Split the transcript into turns.
 *
 * A `user` row opens a turn EXCEPT when a durable mid-turn steer arrives after
 * an assistant row that explicitly declared `calls_tools === true` and before
 * any terminal notice or quiet close settled that run (matching Relay `walkTurns`).
 * Harness preamble notices (`system_prefix`, `selected_model`,
 * `session_mcp_unavailable`) before any work has run never trap the first user
 * prompt inside a head-cut segment.
 */
export function transcriptTurns(
	entries: readonly TranscriptEntry[],
): TranscriptTurn[] {
	const turns: TranscriptTurn[] = [];
	let open: TranscriptTurn | null = null;
	let awaitingToolCall = false;

	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry === undefined) continue;
		if (entry.kind === "user") {
			if (open !== null && awaitingToolCall) {
				open.end = index;
				continue;
			}
			open = {
				key: entry.id,
				opensWithUserRow: true,
				start: index,
				end: index,
			};
			turns.push(open);
			awaitingToolCall = false;
			continue;
		}
		if (open === null) {
			open = {
				key: entry.id,
				opensWithUserRow: false,
				start: index,
				end: index,
			};
			turns.push(open);
		} else {
			open.end = index;
		}

		if (isHarnessPreambleNotice(entry)) continue;
		if (entry.kind === "assistant") {
			awaitingToolCall = hasExplicitCallsTools(entry);
		} else if (isExplicitTerminalNotice(entry) || isQuietCloseEntry(entry)) {
			awaitingToolCall = false;
		}
	}
	return turns;
}

/**
 * The row kinds that are STATEMENTS (or transient finished reasoning) rather
 * than work, for the closing-answer scan: a receipt or completed reasoning trace
 * after the answer does not un-close the turn, EXCEPT an unhandled error notice
 * (`severity === "error"` / `session_incident`), which keeps a failed turn open.
 */
const STATEMENT_KINDS: ReadonlySet<string> = new Set([
	"notice",
	"compaction",
	"parent_message",
	"subagent_message",
	"peer_message",
]);

function isUnhandledErrorNotice(entry: TranscriptEntry): boolean {
	if (entry.kind !== "notice") return false;
	const customType = entry.custom_type || entry.details.custom_kind || "";
	return (
		entry.details.severity === "error" || customType === "session_incident"
	);
}

/** Rows that own visible media artifacts or error notices stay on screen outside
 *  the collapsed span even when the surrounding turn condenses. */
export function staysVisibleOutsideTurnBar(entry: TranscriptEntry): boolean {
	if (isUnhandledErrorNotice(entry)) return true;
	if (entry.kind === "compaction") return true;
	if (entry.kind === "tool") {
		if (MEDIA_ARTIFACT_TOOLS.has(entry.tool_name.trim().toLowerCase())) {
			return true;
		}
		if (entry.images.length > 0 || (entry.videos?.length ?? 0) > 0) {
			return true;
		}
	}
	return false;
}

/**
 * The index of the turn's closing row, or `null` when the turn has none.
 *
 * Eligible closings:
 *  - a completed assistant message (`entryComplete`, non-empty text or images,
 *    and not declaring owed `calls_tools`);
 *  - a settled `no_reply` quiet-turn close (`isQuietCloseEntry`) when no
 *    unhandled error notice ended the turn.
 * Completed `reasoning` traces are skipped like statements; an active streaming
 * `reasoning` row (`final === false`) blocks condensing so a thinking turn stays open.
 */
function closingAnswerIndex(
	entries: readonly TranscriptEntry[],
	turn: TranscriptTurn,
): number | null {
	for (let index = turn.end; index > turn.start; index -= 1) {
		const entry = entries[index];
		if (entry === undefined) continue;
		if (isUnhandledErrorNotice(entry)) return null;
		if (entry.kind === "reasoning") {
			if (!entry.final) return null;
			continue;
		}
		if (STATEMENT_KINDS.has(entry.kind)) continue;
		if (isQuietCloseEntry(entry)) return index + 1;
		return entry.kind === "assistant" &&
			(entry.text.length > 0 || entry.images.length > 0) &&
			entryComplete(entry) &&
			!hasExplicitCallsTools(entry)
			? index
			: null;
	}
	return null;
}

/* --------------------------------------------------------------------- bars */

/**
 * What a condensed turn's bar says, frozen at the moment the turn condenses
 * (see the module's invariant note). `steps` and `durationS` count the HIDDEN
 * tool rows; `durationS` is the tools' own summed seconds, not wall clock —
 * the wire carries no timestamps on this route, and a number the rows cannot
 * state would be fabricated.
 */
export interface TurnBarFacts {
	/** Tool rows behind the bar; 0 renders no clause. */
	steps: number;
	/** Summed tool seconds behind the bar; under one second renders no clause
	 *  (the kit's "never a 0s claim" rule, `components.md` § 17). */
	durationS: number;
	/** Optional count of genuinely failed tool actions (`tool_state === "failed"`,
	 *  excluding partial `send` deliveries) so `TurnBar` surfaces `✗` + failure
	 *  count instead of painting a green `✓ completed` over failed actions. */
	failed?: number;
	/** Optional flag when the turn included a mid-turn `steer` or steered user row. */
	steered?: boolean;
}

/**
 * What the latch remembers about a turn: the facts the bar froze with, and the
 * span of rows the collapse stands for — the rows between the opening message
 * and the closing answer, AS THE FRAME THAT CONDENSED THE TURN carried them.
 *
 * The span is frozen rather than re-derived from each later frame, and that is
 * the whole fix for the relay's real frame shape (a capped tail window,
 * `projection.py::_cap_tail`): a later frame may present the closing answer as
 * a transport-cap prefix (which the live scan, rightly, stops calling an
 * answer), and the window slides, so the span's rows — eventually the closing
 * row itself — leave the projection while the pinned turn stays. Re-deriving
 * either is how a bar used to re-open (empty span) and then re-attach to a
 * different chunk of the window. A row is hidden by this turn iff it is in the
 * frozen span, so the latched turn's render cannot change for any subsequent
 * frame, including frames where its own rows are no longer in the projection.
 */
export interface LatchedTurn {
	facts: TurnBarFacts;
	hiddenIds: readonly string[];
	/**
	 * `canonicalRowKey` of every span row, recorded beside `hiddenIds` because a
	 * tool row's `id` changes at the stream-to-history handoff (`tc-<call>` →
	 * `<msg>:<call>`) while its canonical key does not. The continuation
	 * extension (`extendLatchedTurn`) matches rows by this list, so a row that
	 * only changed id is never counted twice. Optional: a latch built by an
	 * older caller (or a test) without it falls back to `hiddenIds`.
	 */
	canonicalIds?: readonly string[];
	/**
	 * `canonicalRowKey` of the last row BEFORE the closing answer when the latch
	 * froze. A continuation (a hub reply or wake that resumes the same turn with
	 * new work and a new answer, U1-1) is detected as "a later closing exists
	 * after this row"; without it (older latches) the span never extends.
	 */
	spanEndKey?: string;
}

/** One row of the rendered transcript list. A bar's id is the a11y builder's
 *  (`turn-bar-<key>`), so the list's key, the measured-height key and the
 *  testID a flow selects are ONE string rather than three spellings of it. A
 *  group item's id is its builder's (`quiet-group-<key>`) for the same reason. */
export type TranscriptItem =
	| {
			kind: "entry";
			id: string;
			entry: TranscriptEntry;
			/** True on an opening `user` row whose turn is currently condensed (`!expanded`),
			 *  clamping the prompt bubble to 1 headline line until the turn bar opens. */
			condensed?: boolean;
			/** True when this `user` row opens a new exchange turn (for `16 pt` turn spacing). */
			opensTurn?: boolean;
			/** True on a member row `groupPlan` emitted under an OPEN `QuietGroupBar`.
			 *  The reader's tap on the group bar already disclosed it, so `foldPlan`
			 *  must not fold it again behind a second bar over the same rows
			 *  (R1-3 / U1-2: three taps to read one peer cycle). */
			inOpenGroup?: boolean;
	  }
	| {
			kind: "bar";
			id: string;
			turnKey: string;
			facts: TurnBarFacts;
			/** The reader has this turn open: the bar renders its own open state
			 *  and the rows it hid are back in the list. */
			expanded: boolean;
			/** The opening user row's first line, for the bar's accessible name —
			 *  "which turn" must survive the collapse for a screen reader landing
			 *  on the bar directly. */
			headline: string;
	  }
	| {
			kind: "fold";
			id: string;
			foldKey: string;
			fold: FoldRun;
			expanded: boolean;
			/** True when this fold belongs to the currently active/live turn. */
			liveTurn: boolean;
	  }
	| {
			kind: "group";
			id: string;
			/** The group's `qg:<first row id>` — the key the latch and the reader's
			 *  expansion are held by (see `QuietGroup`). */
			groupKey: string;
			group: QuietGroup;
			/** The reader has this group open: the bar renders its own open state
			 *  and the member rows are back in the list. */
			expanded: boolean;
	  };

/** One turn, as the plan rendered it — the unit the jitter test compares. */
export interface TurnView {
	key: string;
	condensed: boolean;
	/** The bar's facts when condensed, else `null`. */
	bar: TurnBarFacts | null;
	/** The ids of every item this turn contributes, in order. */
	itemIds: string[];
	/** The row ids the collapse stands for — the rows between the opening message
	 *  and the closing answer, frozen at the condense moment so a later frame
	 *  cannot move them. Emitted into `itemIds` as well when the turn is open.
	 *  Deliberately not "what is on screen now": rows the frame no longer
	 *  carries stay in the list, and rows the collapse never covered never
	 *  enter it. */
	hiddenIds: readonly string[];
}

export interface CondenseInput {
	entries: readonly TranscriptEntry[];
	/** Turn keys the reader has opened — plus the capture hook's own keys (see
	 *  `parseExpandHook`). */
	expanded: ReadonlySet<string>;
	/** The latch from the previous pass; see the module's invariant note. */
	latch: ReadonlyMap<string, LatchedTurn>;
	/** Whether a turn is currently running (`projection !== null && turnRunning(projection)`).
	 *  When explicitly `false` (session idle), a finished last turn condenses just like
	 *  Relay web (`!live`) and latches into `latch` so starting a new turn never
	 *  un-condenses it. Defaults to `true` when omitted so pure callers without
	 *  session state preserve the conservative active-tail guard. */
	live?: boolean;
}

export interface CondensePlan {
	items: TranscriptItem[];
	turns: TurnView[];
	/** The latch, extended with every turn that condensed in THIS pass. The
	 *  caller keeps it (a ref is what the list uses) and hands it back next
	 *  frame; a turn recorded here is condensed forever, short of the reader's
	 *  expansion. */
	latch: ReadonlyMap<string, LatchedTurn>;
}

/**
 * Plan the transcript: turn segmentation, the condense decision, and the item
 * list the renderer consumes.
 *
 * A turn condenses when it opens with its own user row, a NEWER turn exists,
 * and its closing answer is complete — and, once condensed, it condenses
 * unconditionally (invariant 2). The bar replaces the rows between the opening
 * user row and the closing answer; the closing answer and everything after it
 * stay visible, because that is the row the reader is being handed and the row
 * the completion anchor lives on.
 */
export function condensePlan(input: CondenseInput): CondensePlan {
	const { entries } = input;
	const turns = transcriptTurns(entries);
	const latch = new Map(input.latch);
	const items: TranscriptItem[] = [];
	const views: TurnView[] = [];

	const live = input.live ?? true;

	turns.forEach((turn, index) => {
		const isNewestTurn = index === turns.length - 1;
		const isActive = isNewestTurn && live;
		let latchedTurn = latch.get(turn.key);
		/*
		 * CONTINUATION CYCLES EXTEND THE LATCH (U1-1). A turn that condensed at an
		 * idle moment can be resumed without a new user row: a child's hub reply
		 * or a wake starts another run (tools, a new answer) inside the SAME turn,
		 * and a one-frame `!live` dip at a tool boundary latches mid-turn the same
		 * way. Freezing the first idle snapshot left that later work raw under a
		 * bar whose count disagreed with a reload of the same transcript. So once
		 * the turn is settled again (`!isActive`) and its scan finds a closing
		 * answer strictly AFTER the latched one, the latch grows to cover the
		 * whole turn. This only ever ADDS rows (invariant 2 holds: a seen bar is
		 * never withdrawn) and requires the latched span's last row to still be
		 * in the frame, so a capped window or a transport-cap prefix — which can
		 * only make the scan find an EARLIER closing or none — never moves it.
		 * While the continuation is still running, the earlier span stays
		 * collapsed and the new rows stream visibly beneath it; the bar then says
		 * only what it hides (no painted "completed", U1-3).
		 */
		if (latchedTurn !== undefined && !isActive && turn.opensWithUserRow) {
			const extended = extendLatchedTurn(entries, turn, latchedTurn);
			if (extended !== null) {
				latch.set(turn.key, extended);
				latchedTurn = extended;
			}
		}
		/*
		 * THE LATCH OUTRANKS THE FRAME. A latched turn's render must be a pure
		 * function of the latch for ANY later frame — including the relay's real
		 * shape, where the projection is a capped tail window and the span's rows,
		 * eventually the closing row itself, leave it. So the scan and a fresh
		 * span are computed only while the turn has no latch to trust; a latched
		 * turn reads its frozen span and nothing else from this frame.
		 */
		const closing =
			latchedTurn === undefined ? closingAnswerIndex(entries, turn) : null;
		/*
		 * The span the collapse stands for: for a first condensation, the rows
		 * between the opening user row and the scanned closing in THIS frame (all
		 * a first frame can honestly freeze, minus pinned media/error rows); for a
		 * latched turn, the frozen list.
		 */
		const spanIds: readonly string[] =
			latchedTurn !== undefined
				? latchedTurn.hiddenIds
				: spanBetween(entries, turn, closing);
		/*
		 * Invariant 2 outranks the active-turn rule in the corner that should not
		 * occur (a replacement frame — not an append — that makes a latched turn
		 * last again): a bar the reader has already seen cannot be withdrawn by a
		 * frame, because the alternative reinstates exactly the jitter this module
		 * exists to prevent. When `live === false` (session idle), a completed
		 * newest turn also condenses and latches immediately.
		 */
		const condensed =
			latchedTurn !== undefined ||
			(turn.opensWithUserRow &&
				!isActive &&
				closing !== null &&
				spanIds.length > 0);
		if (latchedTurn === undefined && condensed && closing !== null) {
			latch.set(turn.key, latchedTurnFor(entries, turn, closing, spanIds));
		}
		const facts = latch.get(turn.key)?.facts ?? null;
		const open = input.expanded.has(turn.key);
		const isCollapsed = condensed && facts !== null && !open;

		const view: TurnView = {
			key: turn.key,
			condensed,
			bar: null,
			itemIds: [],
			hiddenIds: [],
		};

		const opening = entries[turn.start];
		if (opening !== undefined) {
			const entryItem: Extract<TranscriptItem, { kind: "entry" }> = {
				kind: "entry",
				id: opening.id,
				entry: opening,
				...(turn.opensWithUserRow && index > 0 ? { opensTurn: true } : {}),
				...(turn.opensWithUserRow && isCollapsed ? { condensed: true } : {}),
			};
			items.push(entryItem);
			view.itemIds.push(opening.id);
		}

		if (view.condensed && facts !== null) {
			view.bar = facts;
			view.hiddenIds = spanIds;
			const barId = turnBarId(turn.key);
			if (!open) {
				items.push({
					kind: "bar",
					id: barId,
					turnKey: turn.key,
					facts,
					expanded: false,
					headline: turnHeadline(opening?.text ?? ""),
				});
				view.itemIds.push(barId);
				const hidden = new Set([
					...spanIds,
					...(latch.get(turn.key)?.canonicalIds ?? []),
				]);
				for (let at = turn.start + 1; at <= turn.end; at += 1) {
					const row = entries[at];
					if (
						row === undefined ||
						hidden.has(row.id) ||
						hidden.has(canonicalRowKey(row))
					) {
						continue;
					}
					items.push({ kind: "entry", id: row.id, entry: row });
					view.itemIds.push(row.id);
				}
				views.push(view);
				return;
			}
			// Expanded: the bar still leads the rows it was hiding, so the
			// disclosure that opened them is where the reader left it.
			items.push({
				kind: "bar",
				id: barId,
				turnKey: turn.key,
				facts,
				expanded: true,
				headline: turnHeadline(opening?.text ?? ""),
			});
			view.itemIds.push(barId);
		}
		for (let at = turn.start + 1; at <= turn.end; at += 1) {
			const row = entries[at];
			if (row === undefined) continue;
			items.push({ kind: "entry", id: row.id, entry: row });
			view.itemIds.push(row.id);
		}
		views.push(view);
	});

	return { items, turns: views, latch };
}

/** The rows between the opening user row and the closing answer, as one frame
 *  carries them: a first condensation can only freeze what it can see (a window
 *  that has already slid may have lost the span's oldest rows — nothing can
 *  re-hide rows the wire no longer sends; see the module note). */
function spanBetween(
	entries: readonly TranscriptEntry[],
	turn: TranscriptTurn,
	closing: number | null,
): readonly string[] {
	if (closing === null || closing <= turn.start + 1) return [];
	const ids: string[] = [];
	const limit = Math.min(closing, turn.end + 1);
	for (let at = turn.start + 1; at < limit; at += 1) {
		const row = entries[at];
		if (row === undefined || staysVisibleOutsideTurnBar(row)) continue;
		ids.push(row.id);
	}
	return ids;
}

/** The latch record for a span the frame can see: facts, ids, and the
 *  canonical keys the continuation extension matches by. */
function latchedTurnFor(
	entries: readonly TranscriptEntry[],
	turn: TranscriptTurn,
	closing: number,
	spanIds: readonly string[],
): LatchedTurn {
	const spanRows = rowsBetween(entries, turn, closing);
	const last = entries[Math.min(closing, turn.end + 1) - 1];
	return {
		facts: factsOverRows(spanRows),
		hiddenIds: spanIds,
		canonicalIds: spanRows.map(canonicalRowKey),
		...(last !== undefined ? { spanEndKey: canonicalRowKey(last) } : {}),
	};
}

/**
 * The latch grown over a continuation cycle, or `null` when the turn has none
 * (see the U1-1 note in `condensePlan`). Facts are recomputed over the whole
 * span when every row the latch froze is still in the frame — exactly what a
 * reload computes; otherwise (the capped window slid past old rows) the new
 * rows' facts are ADDED to the frozen ones, which is the same sum without
 * needing rows the wire no longer sends.
 */
function extendLatchedTurn(
	entries: readonly TranscriptEntry[],
	turn: TranscriptTurn,
	latched: LatchedTurn,
): LatchedTurn | null {
	const endKey = latched.spanEndKey;
	if (endKey === undefined) return null;
	let latchedEnd = -1;
	for (let at = turn.end; at >= turn.start; at -= 1) {
		const row = entries[at];
		if (row !== undefined && canonicalRowKey(row) === endKey) {
			latchedEnd = at;
			break;
		}
	}
	// The latched closing is `latchedEnd + 1`; nothing after it → no continuation.
	if (latchedEnd < 0 || latchedEnd + 1 >= turn.end) return null;
	const closing = closingAnswerIndex(entries, turn);
	if (closing === null || closing <= latchedEnd + 1) return null;

	const known = new Set(latched.canonicalIds ?? latched.hiddenIds);
	const isKnown = (row: TranscriptEntry): boolean =>
		known.has(canonicalRowKey(row)) || latched.hiddenIds.includes(row.id);
	const spanRows = rowsBetween(entries, turn, closing);
	const added = spanRows.filter((row) => !isKnown(row));
	if (added.length === 0) return null;
	const presentCount = spanRows.length - added.length;
	const fullyPresent = presentCount >= known.size;
	const facts = fullyPresent
		? factsOverRows(spanRows)
		: addFacts(latched.facts, factsOverRows(added));
	const hiddenIds = [...latched.hiddenIds, ...added.map((row) => row.id)];
	const canonicalIds = [
		...(latched.canonicalIds ?? latched.hiddenIds),
		...added.map(canonicalRowKey),
	];
	const last = entries[Math.min(closing, turn.end + 1) - 1];
	return {
		facts,
		hiddenIds,
		canonicalIds,
		...(last !== undefined ? { spanEndKey: canonicalRowKey(last) } : {}),
	};
}

function addFacts(a: TurnBarFacts, b: TurnBarFacts): TurnBarFacts {
	const failed = (a.failed ?? 0) + (b.failed ?? 0);
	return {
		steps: a.steps + b.steps,
		durationS: a.durationS + b.durationS,
		...(failed > 0 ? { failed } : {}),
		...(a.steered || b.steered ? { steered: true } : {}),
	};
}

/** The span's rows (not ids) — `spanBetween`'s rule, for facts and keys. */
function rowsBetween(
	entries: readonly TranscriptEntry[],
	turn: TranscriptTurn,
	closing: number,
): TranscriptEntry[] {
	const rows: TranscriptEntry[] = [];
	const limit = Math.min(closing, turn.end + 1);
	for (let at = turn.start + 1; at < limit; at += 1) {
		const row = entries[at];
		if (row === undefined || staysVisibleOutsideTurnBar(row)) continue;
		rows.push(row);
	}
	return rows;
}

function factsOverRows(rows: readonly TranscriptEntry[]): TurnBarFacts {
	let steps = 0;
	let durationS = 0;
	let failed = 0;
	let steered = false;
	for (const entry of rows) {
		if (entry.kind === "steer" || entry.kind === "user") {
			steered = true;
			continue;
		}
		if (entry.kind !== "tool" || isQuietCloseEntry(entry)) continue;
		steps += 1;
		durationS += Math.max(0, entry.elapsed_s);
		if (isToolActionFailed(entry)) failed += 1;
	}
	return {
		steps,
		durationS,
		...(failed > 0 ? { failed } : {}),
		...(steered ? { steered: true } : {}),
	};
}

/* --------------------------------------------------------------------- copy */

/**
 * The bar's visible localized phrases (`relay.transcript.turn.*`), joined with
 * `·`: an optional steered label, the `took` clause (its shape is the locale's
 * — English reads `Took 42s`, some locales render the duration alone) and the
 * action count; `Turn condensed` when neither number exists.
 *
 * The outcome word `completed` is deliberately NOT painted (U1-3): beside a
 * red `✗` failure glyph it read as a contradiction, and Relay's `TurnBar`
 * (`condense-rows.tsx`) paints only the numbers too. Screen readers still hear
 * it — `barAccessibleName` keeps `completed`, as Relay's `sr-only` span does.
 */
export function barPhrases(facts: TurnBarFacts): string[] {
	const phrases: string[] = [];
	if (facts.steered) {
		phrases.push(t("relay.transcript.label.steered"));
	}
	const seconds = Math.floor(facts.durationS);
	if (seconds >= 1) {
		phrases.push(
			t("relay.transcript.turn.took", { duration: elapsedLabel(seconds) }),
		);
	}
	if (facts.steps > 0) {
		phrases.push(
			t("relay.transcript.turn.actions", {
				count: facts.steps,
				label: String(facts.steps),
			}),
		);
	}
	if (phrases.length === 0) {
		phrases.push(t("relay.transcript.turn.condensed"));
	}
	return phrases;
}

/** How many characters of the opening message the bar's accessible name keeps:
 *  it is for a reader landing on the bar directly; the full bubble is read a
 *  moment earlier in the list, so a one-glance cap is the right size. */
export const HEADLINE_MAX_CHARS = 48;

/** The opening user row's first non-empty line, trimmed and capped. */
export function turnHeadline(text: string): string {
	const line =
		text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
	const trimmed = line.trim();
	return trimmed.length > HEADLINE_MAX_CHARS
		? `${trimmed.slice(0, HEADLINE_MAX_CHARS - 1)}…`
		: trimmed;
}

/** The bar's accessible name: which turn, completion/duration/action phrases,
 *  and localized failure warning (`Includes a failed action`) when `facts.failed > 0`. */
export function barAccessibleName(
	facts: TurnBarFacts,
	headline: string,
): string {
	const subject = headline.length > 0 ? `Turn "${headline}"` : "Turn";
	/* `completed` leads the spoken name (the eligibility IS the completion, see
	 * the module note) even though the bar no longer paints it (U1-3); the
	 * painted `Turn condensed` fallback is redundant once it is there. */
	const painted = barPhrases(facts);
	const clauses = facts.steered
		? painted
		: [
				t("relay.transcript.turn.completed"),
				...painted.filter(
					(phrase) => phrase !== t("relay.transcript.turn.condensed"),
				),
			];
	if ((facts.failed ?? 0) > 0) {
		clauses.push(t("relay.transcript.fold.failed_label"));
	}
	return `${subject}: ${clauses.join(", ")}`;
}

/* ------------------------------------------------------------ quiet groups */

/** One sender's line in a group's summary. */
export interface QuietGroupSender {
	/** The label the receipt's own row paints (`peerLabel` in `projection.ts`):
	 *  the sender's conversation name, its session id, or "another session". */
	label: string;
	/** Receipts this sender contributed to the group. */
	count: number;
}

/**
 * ONE QUIET GROUP (design §5, rev 2): a client-derived fold over consecutive
 * `peer_message` receipts. No wire kind and no capability flag — it is a pure
 * function of the rows on hand, and the shared parity fixture
 * (`fixtures/quiet-groups.parity.json`) is what keeps the surfaces from
 * drifting apart in silence.
 *
 * WHAT IT IS. A maximal run of >= 2 receipts with nothing visible between
 * them: a `user` or `steer` row, a notice, a compaction statement, any other
 * delivery the reader can see is a boundary (`breaksPeerRun`). Tool rows and
 * textless (imageless) assistant rows sit inside. ONE receipt is not a group:
 * it keeps its ordinary row.
 *
 * WHY IT IS INDEPENDENT OF TURN CONDENSING. The receipts pile up in the
 * ACTIVE turn — the last user row is old while the traffic is new — and the
 * active turn is exactly the one turn condensing may never fold. So the group
 * is its own pass (`groupPlan`) over the planned items and folds wherever the
 * receipts are visible, including the active turn and the rows under an older
 * turn's bar.
 *
 * WHAT THE MOBILE WIRE DOES NOT BRING. No timestamps on this route, so the
 * shared shape's time span is not a fact this client can state and has no
 * field here. And no distinct receipt kinds for wake / monitor / job
 * deliveries — all three arrive as the one `notice` kind here — so the native
 * definition is the peer_message run (design §5's native bullet) and every
 * notice is a boundary rather than a trigger. The parity
 * suite pins every fixture case the wire can carry and NAMES the ones it
 * cannot.
 *
 * THE LATCH FREEZES A CLOSED GROUP (see `groupPlan`): a group closes the
 * moment any item follows it, and its membership, count and row list freeze
 * there, so no later frame — a tool inside flipping to failed, the relay's
 * capped window sliding rows away — can move its arithmetic or re-attach it
 * to other rows. ONE THING still follows the frame: the descriptive sender
 * and reply/steer intent metadata re-derives from the member rows on hand,
 * because a same-ID receipt CORRECTION ("Check again" rewriting a delivery's
 * facts) must move the bar's words with the row it stands for (native U1).
 * See `refreshedGroupFacts`; the arithmetic and a slid frame stay frozen.
 * The OPEN tail group is the one that may grow: its facts re-derive from the
 * rows on hand while its bar stays a single line. The key is `qg:<first row
 * id>`, and a slid window still answers with it while any member survives, so
 * a group is never remounted under a new identity.
 */
export type QuietGroupFamily = "peer" | "wake" | "mixed";

export interface QuietGroup {
	/** `qg:<first row id>` — stable for the life of the transcript. */
	key: string;
	/** Optional receipt family when wake triggers participate (`wake` | `mixed`);
	 *  omitted on pure peer/hub groups to preserve existing snapshot shapes. */
	family?: QuietGroupFamily;
	/** Internal receipts; one needs at least three actual non-quiet calls. */
	count: number;
	/** The receipt senders, by count: the top 2, then one `<N> more` entry
	 *  whose count sums the rest (ties resolve by first appearance). */
	senders: readonly QuietGroupSender[];
	/** Non-quiet tool rows in the group. */
	actions: number;
	/** Of `actions`, the rows that FAILED (`tool_state === "failed"`; an
	 *  interrupted call is not a failure — the contract the turn bar counts by). */
	failed: number;
	/** It reaches the end of the frame: no later visible row exists and it may
	 *  still grow. Frozen `false` on a latched group. */
	open: boolean;
	/** Every row the group stands for, in order. */
	rowIds: readonly string[];
	/** Optional facts keep the older peer-only parity shape unchanged. */
	hubCount?: number;
	mixedActions?: boolean;
	replyRequested?: number;
	steered?: number;
}

/** The quiet-turn tool's name. The relay's fold already hides the quiet pair
 *  on this wire (local-operator S1), so a run should never carry one; the
 *  exclusion stays because the shared fixture pins it and because a
 *  mixed-build frame may still deliver the pair. */
const QUIET_TURN_TOOL_NAME = "no_reply";

const isQuietToolRow = (entry: TranscriptEntry): boolean =>
	entry.kind === "tool" && entry.tool_name === QUIET_TURN_TOOL_NAME;

const isWakeReceiptEntry = (entry: TranscriptEntry): boolean =>
	entry.kind === "notice" &&
	entry.details.severity !== "error" &&
	entry.details.severity !== "warning" &&
	(entry.details.notice_kind === "wake" ||
		entry.custom_type === "wake_prompt" ||
		entry.details.custom_kind === "wake_prompt");

const quietTriggerFamilyOf = (
	entry: TranscriptEntry,
): "peer" | "wake" | null => {
	if (
		entry.kind === "peer_message" ||
		isHubReceipt(entry) ||
		isBridgeReceipt(entry)
	) {
		return "peer";
	}
	if (isWakeReceiptEntry(entry)) return "wake";
	return null;
};

const breaksPeerRun = (entry: TranscriptEntry): boolean => {
	// Material stays on its source row; a receipt's attachment COUNT is not
	// an admitted image, and no envelope grants ownership of another row's media.
	if (entry.images.length > 0 || (entry.videos?.length ?? 0) > 0) return true;
	if (
		quietTriggerFamilyOf(entry) !== null ||
		(entry.kind === "tool" &&
			!MEDIA_ARTIFACT_TOOLS.has(entry.tool_name.trim().toLowerCase()))
	) {
		return false;
	}
	if (entry.kind === "assistant") {
		return entry.text.length > 0 || entry.images.length > 0;
	}
	return true;
};

/** Items that break a run: a boundary row, or any non-entry item — a turn's
 *  bar owns the rows it stands for, and a run never folds across one. */
const breaksRun = (item: TranscriptItem): boolean =>
	item.kind !== "entry" || breaksPeerRun(item.entry);

/** A maximal stretch of consecutive item indexes a run may span (from and
 *  `to` inclusive). */
export interface ItemSpan {
	from: number;
	to: number;
}

/** The stretches where `isRunItem` holds, in order. */
function stretchesOf(
	length: number,
	isRunItem: (at: number) => boolean,
): ItemSpan[] {
	const stretches: ItemSpan[] = [];
	let from: number | null = null;
	for (let at = 0; at < length; at += 1) {
		if (!isRunItem(at)) {
			if (from !== null) stretches.push({ from, to: at - 1 });
			from = null;
			continue;
		}
		if (from === null) from = at;
	}
	if (from !== null) stretches.push({ from, to: length - 1 });
	return stretches;
}

/** The sender summary: the top 2 by count, ties by first appearance, then one
 *  aggregate `<N> more` entry whose count sums the rest. */
function topSenders(counts: ReadonlyMap<string, number>): QuietGroupSender[] {
	const entries = [...counts.entries()].map(([label, count]) => ({
		label,
		count,
	}));
	const order = new Map(entries.map((entry, index) => [entry.label, index]));
	entries.sort(
		(a, b) =>
			b.count - a.count ||
			(order.get(a.label) ?? 0) - (order.get(b.label) ?? 0),
	);
	const top = entries.slice(0, 2);
	if (entries.length > 2) {
		let rest = 0;
		for (const entry of entries.slice(2)) rest += entry.count;
		top.push({ label: `${entries.length - 2} more`, count: rest });
	}
	return top;
}

/** The group one stretch IS, or null when it holds fewer than two receipts.
 *  `open` is the caller's fact: a closed group's `rowIds` are what the latch
 *  freezes, and an open one re-derives every pass. */
function groupFactsOf(
	items: readonly TranscriptItem[],
	stretch: ItemSpan,
	open: boolean,
): QuietGroup | null {
	const first = items[stretch.from];
	if (first === undefined || first.kind !== "entry") return null;
	const senders = new Map<string, number>();
	let count = 0;
	let actions = 0;
	let failed = 0;
	let hubCount = 0;
	let replyRequested = 0;
	let steered = 0;
	let sawPeer = false;
	let sawWake = false;
	const rowIds: string[] = [];
	for (let at = stretch.from; at <= stretch.to; at += 1) {
		const item = items[at];
		if (item === undefined || item.kind !== "entry") continue;
		const entry = item.entry;
		rowIds.push(entry.id);
		const trig = quietTriggerFamilyOf(entry);
		if (trig === "wake") {
			count += 1;
			sawWake = true;
			continue;
		}
		if (trig === "peer") {
			count += 1;
			sawPeer = true;
			const hub = isHubReceipt(entry);
			if (hub) {
				hubCount += 1;
				if (entry.details.expects_reply === true) replyRequested += 1;
				if (entry.details.steer === true) steered += 1;
			}
			const label = isBridgeReceipt(entry)
				? bridgeReceiptLabel(entry)
				: hub
					? hubLabel(entry)
					: peerLabel(entry.details.sender);
			senders.set(label, (senders.get(label) ?? 0) + 1);
			continue;
		}
		if (entry.kind === "tool" && !isQuietToolRow(entry)) {
			actions += 1;
			if (entry.tool_state === "failed") failed += 1;
		}
	}
	// One receipt can bridge three actual calls; receipt-only still needs two.
	// This is the existing scanner/latch, not a new coordinator or row order.
	if (count < 2 && !(count > 0 && actions >= 3)) return null;
	const family: QuietGroupFamily | undefined = sawWake
		? sawPeer
			? "mixed"
			: "wake"
		: undefined;
	return {
		key: `qg:${first.id}`,
		...(family !== undefined ? { family } : {}),
		count,
		// Sender summary is peer-only (`quiet-groups.parity.json` case 5: mixed carries `[]`).
		senders: family === undefined ? topSenders(senders) : [],
		actions,
		failed,
		open,
		rowIds,
		...(hubCount > 0 ? { hubCount } : {}),
		...(actions >= 3 && (hubCount > 0 || count < 2)
			? { mixedActions: true }
			: {}),
		...(replyRequested > 0 ? { replyRequested } : {}),
		...(steered > 0 ? { steered } : {}),
	};
}

/**
 * The DESCRIPTIVE half of a latched group, re-derived from the member rows on
 * hand (native U1).
 *
 * A same-ID receipt CORRECTION — the "Check again" refetch rewriting a
 * delivery's label or intent — updates the member row in place, and the bar
 * standing over it must state the corrected facts rather than contradict the
 * row it stands for. So sender labels and the reply/steer intent counts
 * re-derive from the CURRENT member entries; membership (key, rowIds, count),
 * the tool-side arithmetic (actions, failed, mixedActions) and `open` keep the
 * latch's freeze — which is what the transport-cap class needs: a tool flipping
 * failed inside a group the reader already saw still cannot move a closed
 * group's numbers.
 *
 * A frame that does not carry every member (the sliding window) keeps the
 * frozen facts WHOLESALE — a partial walk cannot state senders over rows it
 * cannot see — so the slid-window identity rule is unchanged.
 */
function refreshedGroupFacts(
	group: QuietGroup,
	items: readonly TranscriptItem[],
): QuietGroup {
	const byId = new Map<string, TranscriptEntry>();
	for (const item of items) {
		if (item.kind === "entry") byId.set(item.id, item.entry);
	}
	const members: TranscriptEntry[] = [];
	for (const id of group.rowIds) {
		const entry = byId.get(id);
		if (entry === undefined) return group;
		members.push(entry);
	}
	const senders = new Map<string, number>();
	let replyRequested = 0;
	let steered = 0;
	for (const entry of members) {
		if (entry.kind === "peer_message") {
			const label = peerLabel(entry.details.sender);
			senders.set(label, (senders.get(label) ?? 0) + 1);
			continue;
		}
		if (!isHubReceipt(entry)) continue;
		if (entry.details.expects_reply === true) replyRequested += 1;
		if (entry.details.steer === true) steered += 1;
		const label = hubLabel(entry);
		senders.set(label, (senders.get(label) ?? 0) + 1);
	}
	// Rebuilt explicitly, NOT spread-and-override: a stale `replyRequested` or
	// `steered` key must be able to DISAPPEAR when the correction clears it,
	// and a spread would keep it.
	return {
		key: group.key,
		...(group.family !== undefined ? { family: group.family } : {}),
		count: group.count,
		senders: group.family === undefined ? topSenders(senders) : [],
		actions: group.actions,
		failed: group.failed,
		open: group.open,
		rowIds: group.rowIds,
		...(group.hubCount !== undefined ? { hubCount: group.hubCount } : {}),
		...(group.mixedActions ? { mixedActions: true } : {}),
		...(replyRequested > 0 ? { replyRequested } : {}),
		...(steered > 0 ? { steered } : {}),
	};
}

/**
 * The quiet group a single span IS, or null when the span is not one.
 *
 * THE SPAN MUST BE THE WHOLE GROUP (the shared definition): no boundary may
 * sit inside it, and both neighbours must be boundaries or the list's edges.
 * A span that merely OVERLAPS a group — a caller slicing inside one, e.g. a
 * window starting mid-run — refuses here rather than stating a count over
 * part of something; the bars then degrade to their ordinary rows, which is
 * the safe direction. `open` defaults to "the span reaches the list's end".
 */
export function quietGroupOfSpan(
	items: readonly TranscriptItem[],
	span: ItemSpan,
	options: { open?: boolean } = {},
): QuietGroup | null {
	if (span.from < 0 || span.to < span.from || span.to >= items.length) {
		return null;
	}
	for (let at = span.from; at <= span.to; at += 1) {
		const item = items[at];
		if (item === undefined || breaksRun(item)) return null;
	}
	if (span.from > 0) {
		const before = items[span.from - 1];
		if (before === undefined || !breaksRun(before)) return null;
	}
	if (span.to + 1 < items.length) {
		const after = items[span.to + 1];
		if (after === undefined || !breaksRun(after)) return null;
	}
	return groupFactsOf(
		items,
		span,
		options.open ?? span.to === items.length - 1,
	);
}

/**
 * Every quiet group in a list, in order: the stretches between boundaries,
 * each scored by `quietGroupOfSpan` (so a stretch with fewer than two receipts
 * yields none). This is the DEFINITION-level entry the shared parity fixture
 * drives; the list asks `groupPlan`, where the latch and the open fact live.
 */
export function quietGroupsOf(items: readonly TranscriptItem[]): QuietGroup[] {
	const groups: QuietGroup[] = [];
	for (const stretch of stretchesOf(items.length, (at) => {
		const item = items[at];
		return item !== undefined && !breaksRun(item);
	})) {
		const group = quietGroupOfSpan(items, stretch);
		if (group !== null) groups.push(group);
	}
	return groups;
}

/* ------------------------------------------------------- the group fold plan */

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Certified single-peer quiet cycles (`details.peer_cycle`, matching Relay
 * `contextualQuietGroupsOf` in `peer-cycles.ts`): when `sessionId` is supplied
 * and matches `stamp.session_id`, a 1-peer + `send`/`eval` cycle certified by
 * the daemon folds into a `QuietGroup`.
 */
export function certifiedPeerCycleGroups(
	items: readonly TranscriptItem[],
	sessionId?: string,
): QuietGroup[] {
	if (!sessionId) return [];
	const claimed = new Set<string>();
	const certified: QuietGroup[] = [];
	const idOccurrences = new Map<string, number>();
	for (const item of items) {
		if (item.kind === "entry") {
			idOccurrences.set(item.id, (idOccurrences.get(item.id) ?? 0) + 1);
		}
	}

	for (let start = 0; start < items.length; start += 1) {
		const firstItem = items[start];
		if (firstItem === undefined || firstItem.kind !== "entry") continue;
		const first = firstItem.entry;
		const stamp: unknown = (
			first.details as Record<string, unknown> | undefined
		)?.peer_cycle;
		if (
			!isObjectRecord(stamp) ||
			stamp.version !== 1 ||
			stamp.session_id !== sessionId ||
			first.kind !== "peer_message" ||
			stamp.first_id !== first.id ||
			typeof stamp.quiet_call_id !== "string" ||
			!stamp.quiet_call_id ||
			!Array.isArray(stamp.member_ids) ||
			stamp.member_ids.length < 2 ||
			stamp.member_ids.length > 4096 ||
			!stamp.member_ids.every(
				(id: unknown): id is string => typeof id === "string" && id.length > 0,
			)
		) {
			continue;
		}
		const ids: string[] = stamp.member_ids;
		if (
			new Set(ids).size !== ids.length ||
			stamp.last_id !== ids[ids.length - 1] ||
			ids.some((id) => claimed.has(id)) ||
			start + ids.length > items.length
		) {
			continue;
		}
		const slice = items.slice(start, start + ids.length);
		if (
			slice.some((item, index) => {
				if (item.kind !== "entry") return true;
				const row = item.entry;
				return (
					row.id !== ids[index] ||
					row.text_complete === false ||
					row.images.length > 0 ||
					(row.videos?.length ?? 0) > 0 ||
					Boolean(row.error) ||
					(row.details as Record<string, unknown>).held === true ||
					row.details.steer === true ||
					row.details.severity === "error" ||
					row.details.severity === "warning" ||
					(index > 0 &&
						(row.kind !== "tool" ||
							row.tool_state !== "done" ||
							(row.tool_name !== "send" && row.tool_name !== "eval")))
				);
			})
		) {
			continue;
		}
		const memberEntries = slice.map(
			(item) => (item as Extract<TranscriptItem, { kind: "entry" }>).entry,
		);
		const calls = memberEntries.slice(1).map((row) => row.tool_call_id);
		if (
			calls.some((id) => !id) ||
			new Set(calls).size !== calls.length ||
			ids.some((id) => (idOccurrences.get(id) ?? 0) !== 1)
		) {
			continue;
		}
		const label = peerLabel(first.details.sender);
		certified.push({
			key: `qg:${first.id}`,
			count: 1,
			senders: [{ label, count: 1 }],
			// Eval carriers are physical disclosure rows, not additional sends.
			actions: memberEntries.filter(
				(row) => row.kind === "tool" && row.tool_name === "send",
			).length,
			failed: 0,
			open: false,
			rowIds: ids,
		});
		for (const id of ids) claimed.add(id);
	}
	return certified;
}

export interface GroupInput {
	items: readonly TranscriptItem[];
	/** Keys the reader has opened. The same set the turn bars read — the two
	 *  key spaces ("a user row id" and "qg:<first row id>") cannot collide. */
	expanded: ReadonlySet<string>;
	/** The group latch from the previous pass. */
	latch: ReadonlyMap<string, QuietGroup>;
	/** Optional session ID to enable owner-certified `details.peer_cycle` groups. */
	sessionId?: string;
}

/** One group, as THIS plan rendered it — the unit the jitter test compares.
 *  Mirrors `TurnView`: `hiddenIds` is the group's frozen-or-live row list,
 *  NOT "what this frame carries" — rows a slid window has dropped stay in it,
 *  and rows the group never covered never enter it. */
export interface GroupView {
	key: string;
	/** The frozen (closed) or live (open) facts. */
	group: QuietGroup;
	/** The ids of every item this group contributes, in order — the bar, and
	 *  the member rows as well when the reader has it open. */
	itemIds: string[];
	/** The rows the group stands for; identical to `group.rowIds`. */
	hiddenIds: readonly string[];
}

export interface GroupPlan {
	items: TranscriptItem[];
	groups: GroupView[];
	/** The latch, extended with every group that CLOSED in this pass. A group
	 *  recorded here keeps its MEMBERSHIP and arithmetic for every later
	 *  frame, short of the reader's expansion; its DESCRIPTIVE words (senders,
	 *  requested intent) re-derive on every pass whose frame carries every
	 *  member, and the refreshed value is what the next frame receives
	 *  (review round 4, U1). */
	latch: ReadonlyMap<string, QuietGroup>;
}

/**
 * Fold the planned items: each quiet group becomes one `group` item standing
 * for its rows, and every latched group keeps the facts it froze with.
 *
 * The passes, in order:
 *
 *  1. A latched group's rows are claimed. They render as their ONE bar (at
 *     the first surviving member) whatever the frame now shows: the freeze is
 *     what stops a tool inside flipping its failure count, a slid window
 *     minting a second bar for a fragment, or a re-attached span from moving
 *     the collapse the reader already saw.
 *  2. The remaining items are scanned for stretches — the claims and the
 *     boundary rows are the breaks. A stretch with >= 2 receipts is a group;
 *     when it does NOT reach the frame's end this is its close, the one
 *     moment its facts are decided, and they freeze into the returned latch.
 *     The open tail stretch re-derives on every pass and is never latched.
 *  3. The output walks the items in order: a collapsed group emits its bar;
 *     an open one emits the bar and then the member rows (the disclosure that
 *     opened them does not move — the turn bar's own rule).
 */
export function groupPlan(input: GroupInput): GroupPlan {
	const { items } = input;
	const latch = new Map(input.latch);

	/* (1) The claims: only for ids this frame carries. */
	const present = new Set<string>();
	for (const item of items) present.add(item.id);
	const claimed = new Map<string, string>();
	for (const [key, group] of latch) {
		for (const id of group.rowIds) {
			if (present.has(id)) claimed.set(id, key);
		}
	}
	/* The descriptive refresh (native U1): every latched group states its
	 * sender/intent facts from the member rows ON HAND, so a corrected same-ID
	 * receipt moves the bar's words with the row behind it. The refreshed
	 * value is written back into THIS pass's latch — the returned latch is the
	 * next frame's authority, so a slid frame that cannot re-derive the
	 * descriptors must inherit the corrected ones instead of resurrecting the
	 * stale copy it was fed (review round 4, U1). Membership, the arithmetic
	 * and a partial (slid) frame stay frozen — `refreshedGroupFacts` refuses
	 * an incomplete membership by returning the group unchanged, so the last
	 * COMPLETE frame's descriptors persist. `input.latch` itself is never
	 * mutated: `latch` is its copy. */
	for (const [key, group] of latch) {
		latch.set(key, refreshedGroupFacts(group, items));
	}

	/* (1b) Certified `peer_cycle` single-receipt spans when `sessionId` matches. */
	for (const cert of certifiedPeerCycleGroups(items, input.sessionId)) {
		if (cert.rowIds.some((id) => claimed.has(id))) continue;
		if (!latch.has(cert.key)) latch.set(cert.key, cert);
		for (const id of cert.rowIds) {
			if (present.has(id)) claimed.set(id, cert.key);
		}
	}

	/* (2) Fresh stretches and their groups. */
	const fresh = new Map<number, QuietGroup>();
	for (const stretch of stretchesOf(items.length, (at) => {
		const item = items[at];
		return item !== undefined && !claimed.has(item.id) && !breaksRun(item);
	})) {
		const group = groupFactsOf(items, stretch, stretch.to === items.length - 1);
		if (group === null) continue;
		if (!group.open && !latch.has(group.key)) latch.set(group.key, group);
		const settled = group.open ? group : (latch.get(group.key) ?? group);
		for (let at = stretch.from; at <= stretch.to; at += 1) {
			fresh.set(at, settled);
		}
	}

	/* (3) The output walk. */
	const emitted: TranscriptItem[] = [];
	const groups: GroupView[] = [];
	const views = new Map<string, GroupView>();
	for (let at = 0; at < items.length; at += 1) {
		const item = items[at];
		if (item === undefined) continue;
		const claim = claimed.get(item.id);
		// Every latched key has a refreshed entry (write-back above), so a
		// claim always resolves through the latch itself.
		const group = claim !== undefined ? latch.get(claim) : fresh.get(at);
		if (group === undefined) {
			emitted.push(item);
			continue;
		}
		const open = input.expanded.has(group.key);
		let view = views.get(group.key);
		if (view === undefined) {
			const barId = quietGroupId(group.key);
			emitted.push({
				kind: "group",
				id: barId,
				groupKey: group.key,
				group,
				expanded: open,
			});
			view = {
				key: group.key,
				group,
				itemIds: [barId],
				hiddenIds: group.rowIds,
			};
			views.set(group.key, view);
			groups.push(view);
		}
		if (open) {
			emitted.push(
				item.kind === "entry" ? { ...item, inOpenGroup: true } : item,
			);
			view.itemIds.push(item.id);
		}
	}

	return { items: emitted, groups, latch };
}

/* ------------------------------------------------------------- the group copy */

/**
 * The group bar's visible sentence, as phrases the renderer joins with `·`:
 * `Peer messages · 12`.
 *
 * No time clause: the wire carries no timestamps, so the span the shared
 * shape states on surfaces that have them cannot be stated here. No action
 * clause for the older peer-only groups: their action/failure arithmetic stays
 * model facts. Newly mixed hub/action groups state actual calls separately,
 * and requested intent is historical metadata, never current operator attention.
 */
export function groupPhrases(group: QuietGroup): string[] {
	const what =
		group.family === "wake"
			? "Wake messages"
			: group.family === "mixed"
				? t("relay.transcript.label.messages")
				: group.hubCount
					? group.hubCount === group.count
						? "Hub messages"
						: "Incoming messages"
					: "Peer messages";
	const phrases = [what, String(group.count)];
	// Nonzero actions are ALWAYS stated (matching Relay `quietGroupClauseFacts`:
	// `if (group.actions) facts.push(...)`, never gated behind >= 3).
	if (group.actions > 0) {
		phrases.push(
			t("relay.transcript.turn.actions", {
				count: group.actions,
				label: String(group.actions),
			}),
		);
	}
	if (group.replyRequested)
		phrases.push(`${group.replyRequested} reply requested`);
	if (group.steered) phrases.push(`${group.steered} steered`);
	return phrases;
}

/* ----------------------------------------------------- Tier A fold run plan */

export interface FoldView {
	key: string;
	fold: FoldRun;
	itemIds: string[];
	hiddenIds: readonly string[];
	canonicalIds: readonly string[];
}

export interface FoldPlanInput {
	items: readonly TranscriptItem[];
	expanded: ReadonlySet<string>;
	/** Whether the newest turn is currently live. */
	live?: boolean;
	/** Canonical ids previously painted inside a `FoldBar` in the active turn. */
	latchedFoldIds?: ReadonlySet<string>;
}

export interface FoldPlan {
	items: TranscriptItem[];
	folds: FoldView[];
	latchedFoldIds: Set<string>;
}

/**
 * Tier A — Fold consecutive runs of `>= 3` foldable tool actions (or `>= 2`
 * trailing internal receipts) into `FoldBar` items (`fold-bar-fold:<key>`),
 * both in the active turn AND inside an expanded completed turn.
 *
 * Rows already claimed by a closed `TurnBar` or `QuietGroupBar` are no longer
 * in `items` as `"entry"`, and any non-foldable row (`user`, `assistant`,
 * `ImageGenCard`, error `notice`, `bar`, `group`) breaks a run so chronology
 * is preserved cleanly.
 */
export function foldPlan(input: FoldPlanInput): FoldPlan {
	const { items, expanded } = input;
	const live = input.live ?? false;

	// Locate the start of the newest turn so `liveTurn` applies only to the active turn.
	let lastTurnStartAt = 0;
	for (let i = items.length - 1; i >= 0; i -= 1) {
		const candidate = items[i];
		if (
			candidate?.kind === "entry" &&
			(candidate.opensTurn === true ||
				(i === 0 && candidate.entry.kind === "user"))
		) {
			lastTurnStartAt = i;
			break;
		}
	}

	const heldCanonical = new Set<string>();
	for (const item of items) {
		if (item.kind === "entry") {
			heldCanonical.add(canonicalRowKey(item.entry));
		}
	}

	const emitted: TranscriptItem[] = [];
	const folds: FoldView[] = [];
	const createdRuns: FoldRun[] = [];

	let runItems: Array<Extract<TranscriptItem, { kind: "entry" }>> = [];
	let runStartAt = 0;

	const flush = () => {
		if (runItems.length === 0) return;
		const inLiveTurn = live && runStartAt >= lastTurnStartAt;
		const runEntries = runItems.map((it) => it.entry);
		const run = buildFoldRun(runEntries, {
			liveTurn: inLiveTurn,
			latchedFoldIds: inLiveTurn ? input.latchedFoldIds : undefined,
		});
		if (run === null) {
			for (const it of runItems) emitted.push(it);
			runItems = [];
			return;
		}
		if (inLiveTurn) createdRuns.push(run);
		const open = expanded.has(run.key);
		const barId = foldBarId(run.key);
		const view: FoldView = {
			key: run.key,
			fold: run,
			itemIds: [barId],
			hiddenIds: run.rowIds,
			canonicalIds: run.canonicalIds,
		};
		emitted.push({
			kind: "fold",
			id: barId,
			foldKey: run.key,
			fold: run,
			expanded: open,
			liveTurn: inLiveTurn,
		});
		if (open) {
			for (const it of runItems) {
				emitted.push(it);
				view.itemIds.push(it.id);
			}
		}
		folds.push(view);
		runItems = [];
	};

	for (let at = 0; at < items.length; at += 1) {
		const item = items[at];
		if (item === undefined) continue;
		if (
			item.kind === "entry" &&
			item.opensTurn !== true &&
			item.inOpenGroup !== true &&
			(isFoldableToolEntry(item.entry) || isFoldReceiptEntry(item.entry))
		) {
			if (runItems.length === 0) runStartAt = at;
			runItems.push(item);
			continue;
		}
		flush();
		emitted.push(item);
	}
	flush();

	/* The latch survives a `!live` frame (R1-4): the stream dips at tool-segment
	 * boundaries (the relay's "THE SETTLE LATCH" note in `condense-plan.ts`),
	 * and wiping it there dissolved a fold only the latch kept alive, for good.
	 * Pruning to the canonical ids this frame still holds is the reset: rows
	 * that left (a session switch re-keys the list's ref anyway) drop out. */
	const latchedFoldIds = latchFoldedIds(
		input.latchedFoldIds ?? new Set(),
		heldCanonical,
		createdRuns,
	);

	return { items: emitted, folds, latchedFoldIds };
}

/** The group bar's accessible name: what the fold is, and who it is from —
 *  the sender summary a one-line bar cannot show but a screen reader can
 *  hear. The open state rides `accessibilityState`, not this string. */
export function groupAccessibleName(group: QuietGroup): string {
	const [what, count, ...facts] = groupPhrases(group);
	const base = `${what}: ${count}${facts.length ? `, ${facts.join(", ")}` : ""}`;
	if (group.senders.length === 0) return base;
	const senders = group.senders.map((sender) => sender.label).join(", ");
	return `${base}, from ${senders}`;
}

/* --------------------------------------------------------------- the hook */

/**
 * The capture-only hook's parser: comma-separated turn keys to render expanded
 * on a harness page (`lo-expand`), mirroring the `lo-recorder` read-once
 * pattern (`src/stt/recorder.ts`) — a statement about the PAGE, inert on every
 * page that does not carry it, and the only way a still frame can show what a
 * reader sees after opening a bar (the audit harness deliberately drives no
 * taps). Pure, so the parse is testable without a DOM; the list hands it
 * `location.search` when there is one.
 */
export function parseExpandHook(value: string | null): Set<string> {
	if (value === null) return new Set();
	const keys = value
		.split(",")
		.map((key) => key.trim())
		.filter((key) => key.length > 0);
	return new Set(keys);
}
