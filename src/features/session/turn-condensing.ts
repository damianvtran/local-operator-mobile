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
 */

import type { TranscriptEntry } from "@/contracts";
import { entryComplete } from "@/features/session/completion-visibility";
import { countLabel, elapsedLabel } from "@/lib/format";
import { turnBarId } from "@/ui/a11y";

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

/**
 * Split the transcript into turns. A `user` row opens a turn; every other row —
 * steer, assistant, tool, receipt, statement — belongs to the open turn. Rows
 * before the first user row form one head-cut segment.
 */
export function transcriptTurns(
	entries: readonly TranscriptEntry[],
): TranscriptTurn[] {
	const turns: TranscriptTurn[] = [];
	let open: TranscriptTurn | null = null;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry === undefined) continue;
		if (entry.kind === "user") {
			open = {
				key: entry.id,
				opensWithUserRow: true,
				start: index,
				end: index,
			};
			turns.push(open);
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
			continue;
		}
		open.end = index;
	}
	return turns;
}

/**
 * The row kinds that are STATEMENTS rather than work, for the closing-answer
 * scan: a receipt that arrives after the answer does not un-close the turn, so
 * the scan looks past these to the last row that actually did something. The
 * web client's `isStatementRow` is the same rule against its own kinds; this is
 * that list mapped onto the mobile wire's names.
 */
const STATEMENT_KINDS: ReadonlySet<string> = new Set([
	"notice",
	"compaction",
	"parent_message",
	"subagent_message",
	"peer_message",
]);

/**
 * The index of the turn's closing answer, or `null` when the turn has none.
 *
 * The closing answer is the last row that paints something the turn did, and it
 * counts only when it is a COMPLETED assistant message with text: an unfinished
 * answer closes no turn (the web's "unfinished answer closes a turn without
 * being an answer"), and an empty one paints nothing. This is the eligibility
 * gate for condensing, so it failing — interrupted, capped, still streaming —
 * resolves to "stays open", never to a bar that would misreport the turn.
 */
function closingAnswerIndex(
	entries: readonly TranscriptEntry[],
	turn: TranscriptTurn,
): number | null {
	for (let index = turn.end; index > turn.start; index -= 1) {
		const entry = entries[index];
		if (entry === undefined) continue;
		if (STATEMENT_KINDS.has(entry.kind)) continue;
		return entry.kind === "assistant" &&
			entry.text.length > 0 &&
			entryComplete(entry)
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
}

/** One row of the rendered transcript list. A bar's id is the a11y builder's
 *  (`turn-bar-<key>`), so the list's key, the measured-height key and the
 *  testID a flow selects are ONE string rather than three spellings of it. */
export type TranscriptItem =
	| { kind: "entry"; id: string; entry: TranscriptEntry }
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

	turns.forEach((turn, index) => {
		const isActive = index === turns.length - 1;
		const latchedTurn = latch.get(turn.key);
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
		 * a first frame can honestly freeze); for a latched turn, the frozen list.
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
		 * exists to prevent. Appends never produce this: a turn that was not last
		 * stays not last while rows only arrive.
		 */
		const condensed =
			latchedTurn !== undefined ||
			(turn.opensWithUserRow &&
				!isActive &&
				closing !== null &&
				spanIds.length > 0);
		if (latchedTurn === undefined && condensed && closing !== null) {
			latch.set(turn.key, {
				facts: barFactsFor(entries, turn, closing),
				hiddenIds: spanIds,
			});
		}
		const facts = latch.get(turn.key)?.facts ?? null;

		const view: TurnView = {
			key: turn.key,
			condensed,
			bar: null,
			itemIds: [],
			hiddenIds: [],
		};

		const opening = entries[turn.start];
		if (opening !== undefined) {
			items.push({ kind: "entry", id: opening.id, entry: opening });
			view.itemIds.push(opening.id);
		}

		const open = input.expanded.has(turn.key);
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
				/*
				 * The collapse hides exactly its own frozen span; nothing else is
				 * ever hidden by this turn. The closing-absent frame — the window
				 * has slid past the span — needs no boundary: the intersection is
				 * simply empty, the bar stays (its numbers state what the collapse
				 * stood for), and every row the frame still carries renders. This
				 * is the whole point: the frame cannot re-decide the collapse.
				 */
				const hidden = new Set(spanIds);
				for (let at = turn.start + 1; at <= turn.end; at += 1) {
					const row = entries[at];
					if (row === undefined || hidden.has(row.id)) continue;
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
	for (let at = turn.start + 1; at < closing; at += 1) {
		const row = entries[at];
		if (row !== undefined) ids.push(row.id);
	}
	return ids;
}

/** The bar's facts for one turn: the tool rows the collapse hides — those
 *  strictly inside the span (rows after the closing answer are statements that
 *  stay visible, so a collapsed turn never has tools there).
 *
 *  `steps` counts TOOL rows; the span itself may also hide non-tool rows (a
 *  steer, a notice), so "N steps" and "the span is N rows long" are two
 *  different quantities by design — the bar states the former, the collapse
 *  hides the latter. */
function barFactsFor(
	entries: readonly TranscriptEntry[],
	turn: TranscriptTurn,
	closing: number,
): TurnBarFacts {
	let steps = 0;
	let durationS = 0;
	for (let at = turn.start + 1; at < closing; at += 1) {
		const entry = entries[at];
		if (entry?.kind !== "tool") continue;
		steps += 1;
		durationS += Math.max(0, entry.elapsed_s);
	}
	return { steps, durationS };
}

/* --------------------------------------------------------------------- copy */

/**
 * The bar's visible sentence, as phrases the renderer joins with `·`:
 * `completed · 38 steps · 42s`.
 *
 * `completed` is unconditional because a condensed turn is, by construction, a
 * completed one (see the module note) — the clause the requirement names
 * ("turn completion always visible") is answered by the eligibility gate and
 * stated here, not inferred at the render site.
 */
export function barPhrases(facts: TurnBarFacts): string[] {
	const phrases = ["completed"];
	if (facts.steps > 0) phrases.push(countLabel(facts.steps, "step"));
	const seconds = Math.floor(facts.durationS);
	if (seconds >= 1) phrases.push(elapsedLabel(seconds));
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

/** The bar's accessible name: which turn, and the completion the collapse must
 *  not hide. The open state rides `accessibilityState`, not this string. */
export function barAccessibleName(
	facts: TurnBarFacts,
	headline: string,
): string {
	const subject = headline.length > 0 ? `Turn "${headline}"` : "Turn";
	return `${subject}: ${barPhrases(facts).join(", ")}`;
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
