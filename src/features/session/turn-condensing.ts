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
 * them itself. A closed group's facts freeze (the latch); the open tail group
 * grows while its bar stays a single line; a group's key is `qg:<first row
 * id>`. The derivation — the same one every client is pinned to by
 * `fixtures/quiet-groups.parity.json` — is `quietGroupsOf` /
 * `quietGroupOfSpan`, and `groupPlan` is the fold the list renders.
 */

import type { TranscriptEntry } from "@/contracts";
import { entryComplete } from "@/features/session/completion-visibility";
import { peerLabel } from "@/features/session/projection";
import { countLabel, elapsedLabel } from "@/lib/format";
import { quietGroupId, turnBarId } from "@/ui/a11y";

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
 *  testID a flow selects are ONE string rather than three spellings of it. A
 *  group item's id is its builder's (`quiet-group-<key>`) for the same reason. */
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
 * deliveries — a wake arrives as a `notice` line, the rest never reach this
 * wire — so the native definition is the peer_message run (design §5's native
 * bullet) and every notice is a boundary rather than a trigger. The parity
 * suite pins every fixture case the wire can carry and NAMES the ones it
 * cannot.
 *
 * THE LATCH FREEZES A CLOSED GROUP (see `groupPlan`): a group closes the
 * moment any item follows it, and its count, summary and row list freeze
 * there, so no later frame — a tool inside flipping to failed, the relay's
 * capped window sliding rows away — can move its facts or re-attach it to
 * other rows. The OPEN tail group is the one that may grow: its facts
 * re-derive from the rows on hand while its bar stays a single line. The key
 * is `qg:<first row id>`, and a slid window still answers with it while any
 * member survives, so a group is never remounted under a new identity.
 */
export interface QuietGroup {
	/** `qg:<first row id>` — stable for the life of the transcript. */
	key: string;
	/** Receipts in the group (>= 2 by construction). */
	count: number;
	/** The receipt senders, by count: the top 2, then one `<N> more` entry
	 *  whose count sums the rest (ties resolve by first appearance). */
	senders: readonly QuietGroupSender[];
	/** Non-quiet tool rows in the group. */
	actions: number;
	/** Of `actions`, the rows that FAILED (`tool_state === \"failed\"`; an
	 *  interrupted call is not a failure — the contract the turn bar counts by). */
	failed: number;
	/** It reaches the end of the frame: no later visible row exists and it may
	 *  still grow. Frozen `false` on a latched group. */
	open: boolean;
	/** Every row the group stands for, in order. */
	rowIds: readonly string[];
}

/** The quiet-turn tool's name. The relay's fold already hides the quiet pair
 *  on this wire (local-operator S1), so a run should never carry one; the
 *  exclusion stays because the shared fixture pins it and because a
 *  mixed-build frame may still deliver the pair. */
const QUIET_TURN_TOOL_NAME = "no_reply";

const isQuietToolRow = (entry: TranscriptEntry): boolean =>
	entry.kind === "tool" && entry.tool_name === QUIET_TURN_TOOL_NAME;

/**
 * Does this row END a peer run? The design's §5 boundary vocabulary mapped
 * onto the mobile wire: everything that is not a tool row, a receipt, or a
 * textless (imageless) assistant row is a boundary.
 *
 * WHY NOTICE IS A BOUNDARY HERE, where the shared vocabulary can call a wake
 * receipt a group member: this wire flattens every notice class — the shared
 * vocabulary's completion markers, incidents, wake receipts, gate and job
 * notices — into ONE `notice` kind, and the native definition's trigger set
 * is the receipt kind itself (`peer_message`). Re-splitting the flattened
 * class would mean guessing from severity and sentence text, so the fold
 * takes the conservative direction instead: a notice never hides inside a bar
 * that does not mention it.
 */
const breaksPeerRun = (entry: TranscriptEntry): boolean => {
	if (entry.kind === "peer_message" || entry.kind === "tool") return false;
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
	const rowIds: string[] = [];
	for (let at = stretch.from; at <= stretch.to; at += 1) {
		const item = items[at];
		if (item === undefined || item.kind !== "entry") continue;
		const entry = item.entry;
		rowIds.push(entry.id);
		if (entry.kind === "peer_message") {
			count += 1;
			const label = peerLabel(entry.details.sender);
			senders.set(label, (senders.get(label) ?? 0) + 1);
			continue;
		}
		if (entry.kind === "tool" && !isQuietToolRow(entry)) {
			actions += 1;
			if (entry.tool_state === "failed") failed += 1;
		}
	}
	if (count < 2) return null;
	return {
		key: `qg:${first.id}`,
		count,
		senders: topSenders(senders),
		actions,
		failed,
		open,
		rowIds,
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

export interface GroupInput {
	items: readonly TranscriptItem[];
	/** Keys the reader has opened. The same set the turn bars read — the two
	 *  key spaces ("a user row id" and "qg:<first row id>") cannot collide. */
	expanded: ReadonlySet<string>;
	/** The group latch from the previous pass. */
	latch: ReadonlyMap<string, QuietGroup>;
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
	 *  recorded here keeps its facts for every later frame, short of the
	 *  reader's expansion. */
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
			emitted.push(item);
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
 * clause: the count of receipts is the fact the bar is about, and
 * `actions`/`failed` stay model facts (pinned by the parity suite) rather
 * than one more number in a line a phone reader scans.
 */
export function groupPhrases(group: QuietGroup): string[] {
	return ["Peer messages", String(group.count)];
}

/** The group bar's accessible name: what the fold is, and who it is from —
 *  the sender summary a one-line bar cannot show but a screen reader can
 *  hear. The open state rides `accessibilityState`, not this string. */
export function groupAccessibleName(group: QuietGroup): string {
	const base = `Peer messages: ${group.count}`;
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
