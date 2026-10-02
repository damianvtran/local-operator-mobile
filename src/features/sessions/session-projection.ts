/**
 * The sessions list's projections: what a row means, how rows group, and how
 * stale is stated. Pure functions, no React, no platform.
 *
 * Separated from the screen because these are the decisions a reviewer argues
 * with — the precedence of a state mark, which section a row belongs to, what
 * "stale" says — and a decision that can only be observed by rendering it is a
 * decision that gets changed by accident.
 */

import type { SessionSummary } from "@/contracts";

/**
 * The one state mark a row shows (docs/ux/flows.md § 5 step 2).
 *
 * **The precedence is the design.** A row can carry several facts at once: an
 * approval gate runs INSIDE a turn, so the row that most needs the reader
 * arrives with `needs_attention` and `streaming` both true. Ranking streaming
 * first would replace the danger mark with a neutral one on exactly that row.
 * The order is fixed against the web client's documented ranking so the two
 * surfaces never disagree about the same session.
 *
 * `ended` and `degraded` are the relay's health RECEIPTS
 * (`SessionSummary.ended` / `.degraded`, `local-operator` PR #1784 U7). Both are
 * optional on the wire — an older relay omits them and absence reads exactly
 * like `false`. Neither is an error state: a row carrying neither is an ordinary
 * session and must render as one.
 */
export type RowMark =
	| "decision"
	| "running"
	| "new"
	| "ended"
	| "degraded"
	| "idle";

export function rowMark(session: SessionSummary): RowMark {
	if (session.needs_attention) return "decision";
	if (session.streaming) return "running";
	if (session.unseen) return "new";
	if (session.ended) return "ended";
	if (session.degraded) return "degraded";
	return "idle";
}

/** The attention word a decision row carries. `pending_kind` is `"approval"`,
 *  `"ask"`, or empty, and the empty case still has to say something: the relay
 *  said something needs a decision and did not say which. */
export function attentionWord(
	session: SessionSummary,
): "approval" | "question" {
	return session.pending_kind === "ask" ? "question" : "approval";
}

/**
 * How many sessions are waiting on the reader. Counted from `needs_attention`
 * and never from `unseen`: "new since you looked" and "blocked until you answer"
 * are different facts, and conflating them makes the badge say "3" for a list of
 * three finished turns.
 */
export function attentionCount(sessions: readonly SessionSummary[]): number {
	return sessions.reduce(
		(total, session) => (session.needs_attention ? total + 1 : total),
		0,
	);
}

/**
 * The three sections, in the order the relay's own catalogue ranks them.
 *
 * **Nothing here re-sorts.** The relay sorts rows on the shared catalogue key so
 * the phone, the TUI and the desktop agree (`daemon.py`), and a client that
 * re-ordered them would be a fourth opinion. Grouping preserves the incoming
 * order within each section.
 *
 * `pinned` is a durable store that all three surfaces share, which is why a
 * pinned row appears here and not only in the app that pinned it.
 */
export type SessionSections = {
	pinned: SessionSummary[];
	active: SessionSummary[];
	previous: SessionSummary[];
};

export function splitSections(
	sessions: readonly SessionSummary[],
): SessionSections {
	const out: SessionSections = { pinned: [], active: [], previous: [] };
	for (const session of sessions) {
		/* Pinned outranks the section: a pinned previous conversation belongs with
		 * the pinned ones, or pinning an old session would appear to do nothing. */
		if (session.pinned) out.pinned.push(session);
		else if (session.section === "previous") out.previous.push(session);
		else out.active.push(session);
	}
	return out;
}

/** True when any row is a candidate for the section headings at all. */
export function hasSections(sections: SessionSections): boolean {
	return (
		sections.pinned.length > 0 ||
		sections.active.length > 0 ||
		sections.previous.length > 0
	);
}

/**
 * The stale line, or `null`.
 *
 * The cold-start rule (`docs/architecture.md` § Lifecycle) is that the last known
 * list keeps rendering while the stream reconnects, marked as old rather than
 * blanked. This is the marking: a sentence with the age in it, because "stale"
 * alone gives the reader no way to judge whether to wait or to act.
 */
export function staleNote(input: {
	stale: boolean;
	lastFrameAt: number | null;
	now?: number;
}): string | null {
	if (!input.stale || input.lastFrameAt === null) return null;
	const now = input.now ?? Date.now();
	const seconds = Math.max(0, Math.round((now - input.lastFrameAt) / 1000));
	if (seconds < 5) return "Last updated just now.";
	if (seconds < 60) return `Last updated ${seconds}s ago.`;
	const minutes = Math.round(seconds / 60);
	return `Last updated ${minutes} min ago.`;
}

/**
 * The list's own degradation, as a sentence (`degraded: ["sessions"]` /
 * `["attention"]`).
 *
 * A listing the relay could not fully walk is NOT "you have no conversations",
 * and a reader who sees a short list with no explanation will believe it is
 * complete. The two markers mean different things and say so separately.
 */
export function degradedNote(degraded: readonly string[]): string | null {
	if (degraded.length === 0) return null;
	if (degraded.includes("sessions") && degraded.includes("attention"))
		return "Some conversations could not be read just now, and this list may be incomplete.";
	if (degraded.includes("sessions"))
		return "Some conversations could not be read just now, so this list may be missing rows.";
	return "Recent activity could not be read, so the new markers may be out of date.";
}

/**
 * The same three facts, in sentences that survive the one configuration where the
 * long ones cannot be painted whole.
 *
 * At 320 pt with the platform text at 200 % the banner is capped at two lines —
 * about 52 characters — while the long sentences run 73 to 80, so the reader saw
 * `! Some conversations …` and nothing more: a warning with neither a cause nor a
 * consequence, at the one text size where it most needs to be spelled out
 * (design round 5, D29). Shortening the COPY is the honest fix and the cap is
 * what keeps the truncation: swapping in a complete sentence loses nothing to a
 * screen reader, whereas truncating the long one loses the second half of it
 * there too.
 *
 * Each variant keeps its long counterpart's distinction — rows missing, markers
 * stale, or both — so the three states remain three states in words. */
export function degradedShortNote(degraded: readonly string[]): string {
	if (degraded.includes("sessions") && degraded.includes("attention"))
		return "This list may be incomplete.";
	if (degraded.includes("sessions")) return "Some rows may be missing.";
	return "New markers may be stale.";
}
