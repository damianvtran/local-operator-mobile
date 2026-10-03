/**
 * The queued-ask vocabulary — the phone's half of the shared copy contract.
 *
 * WHY ONE MODULE. Every ask state (open / answered / timed out / late /
 * declined / dismissed / expired) is spelled in exactly one string per state,
 * and four surfaces need to say it: the minimized bar above the composer, an
 * ask's row and detail in the sheet, a session row's outstanding count, and the
 * response card in the transcript. Four call sites each composing its own
 * sentence is how one state grows two wordings — and the wording is the whole
 * feature here, because the reader's next action depends on whether an ask is
 * still waiting, already answered, or past its deadline.
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

import type { AskQuestion, PendingAsk } from "@/contracts";

/** The statuses the wire carries (design §4's frozen `PendingAsk.status`; a
 *  newer runtime may add one, so callers must keep the unknown arm). */
export type AskStatus =
	| "open"
	| "answered"
	| "declined"
	| "timed_out"
	| "late"
	| "dismissed"
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
 *  Everything already settled (answered/late/declined/dismissed) and everything
 *  too old to carry (expired) is not. This is the ONLY answerability predicate:
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
 */
export function headAsk(
	rows: PendingAsk[] | undefined | null,
): PendingAsk | null {
	const list = Array.isArray(rows) ? rows : [];
	let head: PendingAsk | null = null;
	for (const row of list) {
		if (String(row?.status || "") !== "open") continue;
		if (head === null || Number(row.created_at) < Number(head.created_at)) {
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

/** How many of an ask's questions are answered, and how many there are — the
 *  sheet's `Question 1 of 3` label reads this, so the label and the form's own
 *  completeness check (both counting `unansweredQuestions`) agree by
 *  construction rather than by two copies of the arithmetic. */
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

/** The whole response as one line per question — what a response card shows
 *  behind its disclosure. A secret answer holds the KEY the runtime stored
 *  (`[<key>]`), never the value: this renders that key, so the card can say
 *  which credential was supplied without ever having held it. */
export function answeredPairs(
	questions: AskQuestion[] | undefined,
	answers: Record<string, string[]> | undefined,
): { question: string; answer: string }[] {
	const list = Array.isArray(questions) ? questions : [];
	const map = answers ?? {};
	return list.map((q) => {
		const chosen = Array.isArray(map[String(q?.id || "")])
			? map[String(q.id)]
			: [];
		return {
			question: String(q?.question || ""),
			answer: (chosen ?? [])
				.map((label) => {
					const option = (q?.options ?? []).find((o) => o.label === label);
					return option?.description
						? `${label} — ${option.description}`
						: label;
				})
				.join(", "),
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
