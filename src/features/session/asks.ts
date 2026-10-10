/**
 * The queued-ask vocabulary — the phone's half of the shared copy contract.
 *
 * WHY ONE MODULE. Every ask state (open / answered / timed out / late /
 * declined / dismissed / withdrawn / expired) is spelled in exactly one string
 * per state, and four surfaces need to say it: the minimized bar above the
 * composer, an ask's row and detail in the sheet, a session row's outstanding
 * count, and the response card in the transcript. Four call sites each composing
 * its own sentence is how one state grows two wordings — and the wording is the
 * whole feature here, because the reader's next action depends on whether an
 * ask is still waiting, already answered, or past its deadline.
 *
 * THE WORDS COME FROM `docs/design/ask-nonblocking.md` §5, verbatim, and that
 * is deliberate rather than lazy: the TUI, the desktop card and the phone all
 * show the same states, and a reader moving between surfaces must not have to
 * work out whether "delivering" and "sent" mean the same thing. This file is
 * this surface's copy of that one table.
 *
 * TWO RULES THE STRINGS ENFORCE, both from §5:
 *
 *  * **No surface may claim a notification that did not happen.** `delivered`
 *    is the runtime's statement that the response rows reached the transcript —
 *    not that a human read anything — so an answered-but-undelivered ask says
 *    "delivering", and only a `delivered` row says "the agent was told".
 *  * **An expiry is not a failure.** The expired line names the remedy ("ask
 *    the agent again") and the sheet disables its controls with no error
 *    register.
 *
 * `open` is not "waiting for you": the agent keeps working while an ask is
 * queued, so the open line says so in as many words ("the agent is
 * continuing"). Nothing here says "notified".
 *
 * THIS MODULE IS LIST-SHAPED and lives BESIDE `pending.ts`, not inside it: an
 * approval is one blocking slot the agent is held by, an ask is a queue the
 * agent works past — the two share a wire family and nothing else. `pending.ts`
 * keeps its job for approvals unchanged.
 *
 * No React, no React Native: every function here is a pure reading of the wire.
 */

import type { AskQuestion, PendingAsk, SessionSummary } from "@/contracts";
import { isRelayError, isRelayMissing, TRANSPORT_SENTENCE } from "@/relay";

/** The statuses the wire carries (design §4's frozen `PendingAsk.status`; a
 *  newer runtime may add one, so callers must keep the unknown arm). */
export type AskStatus =
	| "open"
	| "answered"
	| "declined"
	| "timed_out"
	| "late"
	| "dismissed"
	/* The agent retracted the question (design §12): settled, never outstanding. */
	| "withdrawn"
	| "expired";

/** The ink a state line is drawn in. Four tones, five readings: `wait` covers
 *  both "the agent is continuing" and the honest intermediate where the
 *  deadline has passed on the CLIENT clock but the runtime still reports
 *  `open` — that one is drawn in `attention`, never as settled. */
export type AskTone = "wait" | "attention" | "settled" | "gone";

/** The tone's ink, declared once so the bar, the sheet and the response cards
 *  cannot disagree about what "gone" looks like. `attention` is warning, not
 *  danger: a passed deadline is information, not an error (design §5). */
export const askToneInk = (tone: AskTone): string => {
	switch (tone) {
		case "attention":
			return "text-warning";
		case "settled":
			return "text-success";
		case "gone":
			return "text-ink-dim";
		default:
			return "text-ink-muted";
	}
};

/** Whether an ask still offers answer controls.
 *
 *  `timed_out` IS answerable and that is the point of the state: the agent
 *  moved on, but the reader's answer still reaches it as a `late` response.
 *  Everything already settled (answered/late/declined/dismissed/withdrawn) and
 *  everything too old to carry (expired) is not. This is the ONLY answerability
 *  predicate:
 *  no caller may add an "elapsed time" second opinion (design §6.5 of the E2
 *  spec). */
export function isAnswerable(status: string): boolean {
	return status === "open" || status === "timed_out";
}

/** Whether an ask belongs in the "outstanding" surfaces — the minimized bar
 *  and the session row's count. Same set as answerability, to the letter: the
 *  tally the wire publishes (`asks_open`, open + timed-out-and-answerable) is
 *  the runtime's `OUTSTANDING_STATUSES`, and a client that filtered differently
 *  would draw a chip its own tally disagrees with. Answered/declined leave at
 *  once: their work is done, and keeping them would make the chip a log. */
export function isOutstanding(status: string): boolean {
	return isAnswerable(status);
}

/** The fields `askStateLine` and `remainingMs` read. A NARROWER input than
 *  `PendingAsk` on purpose: a transcript response card carries the same
 *  status/`delivered` facts without a wire row, and re-minting a fake
 *  `PendingAsk` to say one sentence would be a lie dressed as a type. */
export interface AskStateInput {
	status?: string;
	delivered?: boolean;
	created_at?: number;
	expires_at?: number;
}

/** How long until this ask's deadline, in milliseconds — negative once past.
 *  Epoch MILLISECONDS on both sides (`created_at`/`expires_at` are `now_ms()`),
 *  unlike the seconds-based session clocks the panels use. */
export function remainingMs(row: AskStateInput, nowMs: number): number {
	const expires = Number(row.expires_at) || 0;
	return expires - nowMs;
}

/** A deadline as a short span: `<1 m`, `42 m`, `3 h`, `2 d`.
 *
 *  Spaced units, matching §5's own spelling ("expires in 42 m"). The
 *  boundaries are chosen so the number never reads as more precise than it is —
 *  minutes under 90, hours under 48, days after that — and a deadline inside
 *  the next second floors to `<1 m` rather than an empty string or a claimed
 *  minute: a sentence whose whole point is the number must never render with a
 *  hole in it.
 *
 *  A deadline already past is the CALLER's branch (the "deadline passed"
 *  line), never a negative countdown. */
export function durationLabel(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (ms <= 0) return "";
	if (seconds < 60) return "<1 m";
	if (seconds < 90 * 60) return `${Math.floor(seconds / 60)} m`;
	const hours = seconds / 3600;
	if (hours < 48) return `${Math.floor(hours)} h`;
	return `${Math.floor(hours / 24)} d`;
}

/** The one line a queued ask's own state is stated in (§5's shared copy).
 *
 *  `nowMs` is the CLIENT's clock and the countdown is rendered from it, per §5:
 *  the phone may be minutes away from the runtime's clock, and a countdown the
 *  server computed at push time would freeze at whatever it said then. */
export function askStateLine(
	row: AskStateInput,
	nowMs: number,
): { text: string; tone: AskTone } {
	const status = String(row.status || "open");
	const left = remainingMs(row, nowMs);
	switch (status) {
		case "open": {
			if (left <= 0) {
				/* The runtime has not folded the deadline yet (it folds on its own
				   ≤60 s tick), so this is a race window measured in seconds — but it
				   is also the reader's real situation, and claiming "expires in 0 m"
				   or silently showing the pre-deadline line would both be untrue.
				   The ask is still answerable either way, so the remedy is the same
				   answer the timed-out line gives. */
				return {
					text: "Queued — the agent is continuing; deadline passed",
					tone: "attention",
				};
			}
			return {
				text: `Queued — the agent is continuing; expires in ${durationLabel(left)}`,
				tone: "wait",
			};
		}
		case "answered":
			/* `delivered` is the runtime's own statement that the response rows
			   exist in the transcript; until then the honest word is "delivering"
			   (see the module note). */
			return row.delivered
				? { text: "Answered — the agent was told", tone: "settled" }
				: { text: "Answered — delivering", tone: "settled" };
		case "late":
			return { text: "Answered late — the agent was told", tone: "settled" };
		case "declined":
			return { text: "Declined — the agent was told", tone: "settled" };
		case "dismissed":
			return { text: "Dismissed — no reply was sent", tone: "gone" };
		case "withdrawn":
			/* DESIGN §12's state word; the settled register names the ACTOR — the
			   agent retracted the question, the user did not (the core web lane
			   settled this copy in its design review round 1, D2). Like
			   `dismissed`, the ask is over with nothing to send; unlike it, the
			   asker retracted the question rather than the user. */
			return {
				text: "Withdrawn — the agent no longer needs an answer",
				tone: "gone",
			};
		case "expired":
			return {
				text: "Expired — this ask is too old to answer; ask the agent again",
				tone: "gone",
			};
		case "timed_out":
			return {
				text: "Timed out — the agent moved on; you can still answer",
				tone: "attention",
			};
		default:
			/* A status from a newer runtime. Passing it through as its own word is
			   the standing rule: an unknown state must not be silently rendered as
			   a known one, and it must not crash the row either. */
			return { text: status.replace(/_/g, " "), tone: "wait" };
	}
}

/** The asks worth showing on the outstanding surfaces. Keeps the wire's own
 *  order rather than re-ranking: the list is published open-first, newest-first
 *  (`asks.store.index_asks`), and inventing a second order here is how the bar
 *  and the sheet would come to lead with different asks. */
export function outstandingAsks(
	rows: PendingAsk[] | undefined | null,
): PendingAsk[] {
	if (!Array.isArray(rows)) return [];
	return rows.filter((row) => isOutstanding(String(row?.status || "open")));
}

/** The HEAD ask: the OLDEST still-open ask.
 *
 *  Deliberately NOT the wire's `rows[0]`. The published list leads with the
 *  NEWEST open ask, while a bar that jumped to each new arrival would move
 *  under the reader's finger mid-tap; the design names this divergence (§4's A2
 *  addendum), and the relay's own dock picks the same head. A `timed_out` ask
 *  is not a head: it is still answerable, but it is no longer the thing the
 *  agent is waiting on, so a count built from it must keep it out of the name.
 *  Equal `created_at` values break by `ask_id` — the same tie-break the web
 *  dock applies (`lib/asks.ts`), so the two surfaces name the same ask for
 *  the same queue instead of each following its own scan order. */
export function headAsk(
	rows: PendingAsk[] | undefined | null,
): PendingAsk | null {
	const list = Array.isArray(rows) ? rows : [];
	let head: PendingAsk | null = null;
	for (const row of list) {
		if (String(row?.status || "") !== "open") continue;
		if (
			head === null ||
			Number(row.created_at) < Number(head.created_at) ||
			(Number(row.created_at) === Number(head.created_at) &&
				String(row.ask_id) < String(head.ask_id))
		) {
			head = row;
		}
	}
	return head;
}

/** The ask the bar should NAME: the oldest open ask, or — when nothing is open
 *  — the first still-answerable one (a timed-out ask is answerable, §5).
 *
 *  WHY THE FALLBACK. With only a timed-out ask left, a bar that named only open
 *  asks would say "1 question waiting" with no preview at all: the count
 *  includes the answerable timeout while the preview did not, so the one state
 *  design §5 keeps answerable was also the one state that named nothing. The
 *  head rule is unchanged where an open ask exists.
 *
 *  NOT `rows[0]` — see `headAsk`. */
export function dockAsk(
	rows: PendingAsk[] | undefined | null,
): PendingAsk | null {
	const head = headAsk(rows);
	if (head !== null) return head;
	const outstanding = outstandingAsks(rows);
	return outstanding.length > 0 ? (outstanding[0] ?? null) : null;
}

/** The rows in the order every ask surface should show them: the ask the BAR
 *  NAMES first, then the wire's own order.
 *
 *  WHY THE ORDER IS THE CLIENT'S TO DECIDE. The bar names the dock ask, and
 *  the published list leads with the NEWEST — so tapping a bar that says
 *  "Which sequencing…" would open a sheet whose first row was a different
 *  question, with the named one below the fold. A thumb arrives expecting what
 *  it just read. The design's own addendum names this divergence; this is it,
 *  applied where the reader stands, with no wire change. */
export function orderedForDisplay(
	rows: PendingAsk[] | undefined | null,
): PendingAsk[] {
	const list = Array.isArray(rows) ? rows : [];
	const first = dockAsk(list);
	if (first === null) return [...list];
	return [first, ...list.filter((row) => row.ask_id !== first.ask_id)];
}

/** A signature of the frames' own outstanding-ask population, for the asks
 *  sheet's "a frame changed the population ⇒ re-read" trigger (spec §2.3; the
 *  web sheet keys on the store's `asksRevision`). PURE and exported so the
 *  rule is testable on its own — the sheet's effect is where it is USED, and
 *  an effect test would mock the fetch, not the rule. The rule is threefold
 *  and each clause is a deliberate answer: per-SESSION counts, so an unrelated
 *  repaint of a session streaming at 30/s cannot move it; ORDER-INSENSITIVE
 *  (the daemon's row order is its own rank and a re-rank is not new
 *  information); and a runtime that does not publish asks contributes NOTHING
 *  rather than a zero — absence is the capability proxy (§4; a zero would be a
 *  claim it cannot make). */
export function asksPopulationSignature(
	rows: readonly SessionSummary[] | undefined | null,
): string {
	const parts: string[] = [];
	for (const row of rows ?? []) {
		const count = row?.asks_open;
		if (typeof count !== "number" || count <= 0) continue;
		parts.push(`${row.session_id}:${count}`);
	}
	parts.sort();
	return parts.join(",");
}

/** How many of an ask's questions are already taken (settled answers or the
 *  legacy path's drafts), and how many there are — the form's progress
 *  arithmetic. NOT what the sheet's per-field number reads: that label counts
 *  each field's ABSOLUTE position in the full question list (`asks-sheet.tsx`),
 *  because a taken PREFIX would renumber the tail under subset numbering —
 *  and for a taken middle the two would disagree. */
export function questionProgress(row: PendingAsk): {
	index: number;
	total: number;
} {
	const total = Array.isArray(row.questions) ? row.questions.length : 0;
	const done = Math.max(0, total - unansweredQuestions(row).length);
	return {
		index: Math.min(done, Math.max(0, total - 1)),
		total: Math.max(1, total),
	};
}

/** The questions this ask still needs an answer for.
 *
 *  `answers` holds settled labels per question id; `draft_question_ids` holds
 *  the ids the LEGACY incremental path (design §4's A2 addendum) has already
 *  taken in this runtime for a still-open ask. Both remove a question from the
 *  form, and both are needed: a phone that offered a question the old path had
 *  already taken would collect a second answer to it. */
export function unansweredQuestions(row: PendingAsk): AskQuestion[] {
	const questions = Array.isArray(row.questions) ? row.questions : [];
	const taken = new Set(Object.keys(row.answers ?? {}));
	for (const id of row.draft_question_ids ?? []) taken.add(String(id));
	return questions.filter((q) => !taken.has(String(q?.id || "")));
}

/** The `Other` door's own state for one question — whether it is the selected
 *  row (single-select) or ticked (multi-select), and what its field holds,
 *  UNTRIMMED.
 *
 *  Kept apart from the answer cell on purpose, the way the desktop card keeps
 *  it: a typed string living in the same array as the option labels reads back
 *  as an option — typing `No, thanks` beside an option `No` would light it up —
 *  and the cell is trimmed on its way to the wire, so a field fed from the cell
 *  would drop the space between two typed words. The field keeps the reader's
 *  text exactly; only what travels is trimmed. */
export interface AskOther {
	open: boolean;
	text: string;
}

/** No door opened. Shared so a lookup miss never mints a new object per render. */
export const EMPTY_OTHER: AskOther = { open: false, text: "" };

/** Whether this question ends in the explicit `Other` row — the free-text door
 *  of design §5.0 (`docs/design/ask-nonblocking.md`): "the explicit free-text
 *  door is the trailing `Other` row on every non-secret question, with its own
 *  input."
 *
 *  False in the two cases the note itself names, so the condition and its
 *  reasons live in one place:
 *
 *   - a **free-text-only** question — "its input is the question's only
 *     control and is shown open", so a row that merely reveals the only
 *     possible input would be ceremony;
 *   - a **secret** question — its masked field IS its free-form entry, and a
 *     plain box beside a credential is the failure the secret-ask rules exist
 *     for. The gate is on `secret`, not on an empty option list: secret
 *     questions carry no options today, and the door must stay out if one ever
 *     arrives with them. */
export function hasOtherDoor(question: AskQuestion): boolean {
	const options = Array.isArray(question.options) ? question.options : [];
	return !question.secret && options.length > 0;
}

/** The values one question's answer will carry, from its option ticks and its
 *  `Other` door — the ONE composition rule, read by both the submit's
 *  enabled-state and the body it sends (two copies is how a button and its
 *  body come to disagree about what an answer is).
 *
 *  The door's rules as the family's two shipped instances define them — the
 *  desktop card's `askCellWith` (UI #892) for the door itself, and the TUI
 *  picker's `_chosen`, which agrees with it on both select modes:
 *
 *   - **Single-select: `Other` and the options exclude each other.** An open
 *     `Other` makes the answer its typed text ALONE — whatever was chosen
 *     before — so an option press is what switches the answer back (the card
 *     runs that half: choosing an option closes the row, and its text is kept
 *     for a mis-click).
 *   - **Multi-select: `Other` is ADDITIVE and goes LAST**, the order the card
 *     draws: the ticks keep their order and the typed text appends after them.
 *   - **An empty `Other` contributes nothing — not an empty string — and it
 *     holds the question open.** While the door stands open on blank text the
 *     question does not count as answered in EITHER mode, even beside ticks
 *     that would answer it alone (`questionIsAnswered` holds that half; the
 *     desktop's pending-`Other` rule is its source). Typing, or unticking the
 *     door to send the ticks by themselves, is how the reader completes it. */
export function composedAnswer(
	question: AskQuestion,
	ticks: readonly string[],
	other: AskOther,
): string[] {
	if (!hasOtherDoor(question)) return [...ticks];
	const entry = other.open ? other.text.trim() : "";
	if (!question.multi) {
		if (!other.open) return [...ticks];
		return entry === "" ? [] : [entry];
	}
	return entry === "" ? [...ticks] : [...ticks, entry];
}

/** Whether this question carries a usable cell: any non-empty value after
 *  composition — AND no `Other` door standing open and empty. The sheet's
 *  `Answer` gate reads this for every still-open question, so the submit
 *  cannot proceed while any answerable question is in that state.
 *
 *  AN OPEN, EMPTY DOOR HOLDS THE QUESTION OPEN, EVEN BESIDE TICKS. That is
 *  the desktop card's rule, taken deliberately (`askQuestionIsAnswered`,
 *  UI #892): its cell carries a blank marker for a selected-but-empty `Other`
 *  and refuses any cell holding one — "a multi-select with ticks beside an
 *  empty `Other` stays incomplete too, where it used to be complete on its
 *  ticks and so DROPPED the row the user had selected without a word".
 *  Without this half, the multi-select here would enable `Answer` on its
 *  ticks and the submit would silently drop the door the reader just opened;
 *  with it, the reader completes the question by typing, or unticks the door
 *  to send the ticks alone.
 *
 *  The single-select reads the same rule rather than relying on its
 *  composition (an open empty door composes to the empty cell there anyway):
 *  one condition covers both modes and cannot drift between them. */
export function questionIsAnswered(
	question: AskQuestion,
	cell: readonly string[],
	other: AskOther,
): boolean {
	if (other.open && other.text.trim() === "") return false;
	return composedAnswer(question, cell, other).some(
		(value) => value.trim() !== "",
	);
}

/** The whole-ask `ask_respond` body: one entry per question id, a skipped
 *  question riding as the empty list the queue's contract defines — never a
 *  missing key, because the wire refuses a partial map. Values are
 *  DEDUPLICATED, first occurrence kept (the desktop's `askAnswerMap`, UI
 *  #892): an `Other` text that equals a ticked label is the same answer once.
 *  Extracted from the sheet so the composition has a seam the Node tests can
 *  READ (the sheet itself cannot load there): the sheet renders it, the tests
 *  pin it. */
export function askResponseBody(
	questions: readonly AskQuestion[],
	drafts: {
		answers: Record<string, string[]>;
		others: Record<string, AskOther>;
		skipped: readonly string[];
	},
): Record<string, string[]> {
	const body: Record<string, string[]> = {};
	for (const question of questions) {
		const id = String(question.id);
		if (drafts.skipped.includes(id)) {
			body[id] = [];
			continue;
		}
		/* Deduped at the wire, first occurrence kept — the desktop's rule
		 * (`askAnswerMap`); without it a typed text equal to a ticked label
		 * travels twice and the settled record renders it twice. */
		const values = composedAnswer(
			question,
			drafts.answers[id] ?? [],
			drafts.others[id] ?? EMPTY_OTHER,
		).map((value) => value.trim());
		body[id] = [...new Set(values)];
	}
	return body;
}

/** One value of a settled answer, with the frame's own boundary. `other` is
 *  true when the question's option list did NOT offer this value — the
 *  reader's own words, drawn with the desktop's muted `Other` word
 *  (`ask-panel.tsx`'s answer frame, UI #892), so a settled `prod` reads as an
 *  answer the list did not offer rather than as a label that happens to be
 *  missing from it. */
export interface AnsweredValue {
	text: string;
	other: boolean;
}

/** The whole response as one entry per question — what a response card shows
 *  behind its disclosure, each value on its own line (the desktop's answer
 *  frame draws one value per line).
 *
 *  WHAT IS NOT HERE, AND WHY: no option description is attached, no
 *  ` — description` suffix. The frame "keeps what was written"
 *  (`ask-panel.tsx`, UI #892), and an attachment could not be truthful
 *  anyway — the wire carries plain strings, so a typed answer that happens to
 *  equal an option's label is indistinguishable from a tick of that option,
 *  and any lookup by label would hand the reader that option's description
 *  for their own words. Nothing attaches, so nothing can attach wrongly.
 *
 *  A secret answer holds the KEY the runtime stored (`[<key>]`), never the
 *  value: this renders that key, so the card can say which credential was
 *  supplied without ever having held it — and a key is never tagged (the
 *  desktop's own condition, `secret !== true && offered.length > 0`, which is
 *  this file's `hasOtherDoor`: a secret question has no list to be outside
 *  of). */
export function answeredPairs(
	questions: AskQuestion[] | undefined,
	answers: Record<string, string[]> | undefined,
): { question: string; values: AnsweredValue[] }[] {
	const list = Array.isArray(questions) ? questions : [];
	const map = answers ?? {};
	return list.map((q) => {
		const chosen = Array.isArray(map[String(q?.id || "")])
			? map[String(q.id)]
			: [];
		const offered = (q?.options ?? []).map((option) => option.label);
		/* Only a question with a list tags, and never a secret one — one
		 * predicate (`hasOtherDoor`), so the door and the receipt cannot
		 * disagree about which questions have a list to be outside of. */
		const tags = q != null && hasOtherDoor(q);
		return {
			question: String(q?.question || ""),
			values: (chosen ?? []).map((value) => ({
				text: value,
				other: tags && !offered.includes(value),
			})),
		};
	});
}

/** Which surface settled this ask, when another one beat this phone to it
 *  (§4's single-winner rule: the loser is told `already answered by <surface>`).
 *  Empty when the runtime did not say — an older core, or a settlement this
 *  phone made itself. */
export function answeredBySurface(row: PendingAsk): string {
	const by = row.answered_by;
	if (!by) return "";
	const surface = by.surface;
	return typeof surface === "string" ? surface : "";
}

/** The projection's BLOCKING pending request, with the legacy ask mirror
 *  removed (design §4's client rule N3).
 *
 *  For one release a queued ask is ALSO published as today's single-slot
 *  `pending` card, so an OLD client can still see and answer it. A client that
 *  has the `asks` field must IGNORE that card when its `kind` is `"ask"` —
 *  otherwise the same ask renders twice (the mirror card *and* a queued row)
 *  and a card the user answers is a second answer the queue refuses.
 *
 *  The presence of `asks` IS the capability proxy (§4): the field exists
 *  exactly while the runtime publishes queued asks, so `undefined` means "this
 *  runtime predates them" and the mirrored card is then the only view of the
 *  ask — which is precisely the case the mirror exists for. */
export function blockingPending<T extends { kind: string }>(
	pending: T | null | undefined,
	asks: unknown,
): T | null {
	if (pending == null) return null;
	if (asks !== undefined && pending.kind === "ask") return null;
	return pending;
}

/** The bar's count label — QUESTIONS, of the outstanding set.
 *
 *  The manager of this round fixed the unit: the bar counts questions (how much
 *  is owed on the thing it names, the relay's own line) while the row chip and
 *  the header badge count ASKS (`asks_open`). Both surfaces label their unit in
 *  as many words, so the two counts cannot be read as one number said twice.
 *  Never rendered at zero — the bar's presence IS the statement. */
export function questionsWaitingLabel(questions: number): string {
	return questions === 1
		? "1 question waiting"
		: `${questions} questions waiting`;
}

/** How many questions the outstanding set still owes an answer for — the
 *  number the bar shows. A timed-out ask is still counted: it is still
 *  answerable, which is why this walks the outstanding set rather than the
 *  open one. */
export function outstandingQuestions(
	rows: PendingAsk[] | undefined | null,
): number {
	return outstandingAsks(rows).reduce(
		(total, row) =>
			total + (Array.isArray(row.questions) ? row.questions.length : 0),
		0,
	);
}

/* ---------------------------------------------- the sheet's failure lines */

/** The app's one transport sentence (`relay/errors.ts`) — not a sheet-local
 *  second wording of "could not reach the computer": two copies of one rule is
 *  how the two drift (design D4). */
export const READ_FAILED = TRANSPORT_SENTENCE;

/** What the sheet says about a failed list read while rows are still on screen.
 *
 *  The read being refreshed and the answer being sent are different requests, and
 *  the sheet stays interactive over its drawn rows (round 2, U9), so a bare
 *  transport sentence under a live Answer button reads as "answering will fail" -
 *  which it does not. This scopes the failure to the list and says the form works
 *  (round 3, U12). With nothing drawn there is no form to reassure about and the
 *  read's own sentence is the whole explanation (the older-daemon line is the one
 *  a reader can act on), so it is shown as it is. */
export const REFRESH_FAILED_ROWS_DRAWN =
	"Couldn't refresh the list — you can still answer.";

export const readFailureNotice = (error: string, drawn: number): string =>
	error !== "" && drawn > 0 ? REFRESH_FAILED_ROWS_DRAWN : error;

/** A 404 on the aggregate route is an OLDER daemon: the route is additive and
 *  its absence is the one read failure that is not a transport problem. The
 *  noun is the COMPUTER's relay, never "this session" — the sheet is
 *  index-backed and cross-session, opened from the sessions list where there is
 *  no "this session" — and the line names what to update (design D4). */
export const RUNTIME_PREDATES_ASKS =
	"The relay on this computer is too old for queued questions. Update local-operator to see them here.";

/** The relay's own sentence when it gave one; the plainest honest line when it
 *  did not. Never a bare status code under a button that explains nothing. */
export const refusalText = (failure: unknown): string =>
	isRelayError(failure) ? failure.displayableMessage : READ_FAILED;

/** The line the sheet shows for a failed aggregate read.
 *
 *  A 404 means "this daemon predates the route" ONLY when the RELAY itself sent
 *  it — `isRelayMissing`. The edge and the gateway answer `404` for "this
 *  hostname is not a tunnel" too, a refusal from a machine IN FRONT of the
 *  relay: the host was never reached, so nothing can be concluded about its age,
 *  and telling the reader to update a computer the app could not reach is a
 *  false statement about where the problem is. That case reads as unreachable. */
export const asksReadFailureLine = (failure: unknown): string => {
	if (isRelayMissing(failure)) return RUNTIME_PREDATES_ASKS;
	if (isRelayError(failure) && failure.kind === "unknown-tunnel") {
		return READ_FAILED;
	}
	return refusalText(failure);
};
