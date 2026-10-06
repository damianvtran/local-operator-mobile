import type { LinkedSession, ProjectSummary } from "@/contracts";
import { isRelayError } from "@/relay";
import type { SemanticTone } from "@/ui/variants";

/**
 * The projects surfaces' copy and arithmetic — the pure half, so the rules can be
 * tested without a renderer.
 *
 * The rule this module exists to hold: **nothing here derives a fact the relay
 * already decided.** `progress_stale`, a milestone's status, the live-session
 * count and the milestone counts all cross the wire computed; a client that
 * recomputed one would be a second derivation with a drift window, and the relay
 * computes each exactly once so two surfaces cannot disagree about one record.
 * What is here is presentation — a word, a tone, a joining of numbers the relay
 * sent.
 */

/** The display name every surface renders: the title when set, else the
 *  addressing name (the same fallback the relay's own search hits use). */
export function projectDisplayName(project: {
	title: string | null;
	name: string;
}): string {
	const title = project.title?.trim() ?? "";
	return title === "" ? project.name : title;
}

/**
 * The board's tone for a status.
 *
 * Tones are a reading aid, never the only channel: the section heading carries
 * the status WORD, so a reader who cannot see the colour loses decoration rather
 * than information. `archived` is neutral rather than dim — a settled record is
 * not a warning.
 */
export function projectStatusTone(status: string): SemanticTone {
	switch (status) {
		case "active":
			return "info";
		case "qa":
		case "validation":
			return "success";
		case "paused":
			return "warning";
		case "planning":
		case "done":
		case "archived":
			return "neutral";
		default:
			/* An unknown status is not an error — it is a status this build has
			 * never heard of, and colouring it like a problem would say otherwise. */
			return "neutral";
	}
}

/** "2 of 3 milestones" — from the relay's own two counts, never re-counted. */
export function milestoneCountLabel(
	milestonesCompleted: number,
	milestonesTotal: number,
): string {
	if (milestonesTotal <= 0) return "no milestones";
	return `${milestonesCompleted} of ${milestonesTotal} milestones`;
}

/**
 * The session link counts a row shows.
 *
 * `sessions` is the WORK set and `coordination_sessions` is the "filed by"
 * provenance count; they are never added together, because a filing is not a
 * worker (the relay's own note on `ProjectSummary.coordination_sessions`). The
 * live count is a subset of `sessions`, and it is stated only when non-zero: a
 * "0 live" chip would be a claim about a list the relay scanned, not a fact the
 * reader needs.
 */
export function sessionCountLabel(
	sessions: number,
	liveSessions: number,
): string {
	const base = sessions === 1 ? "1 session" : `${sessions} sessions`;
	if (liveSessions <= 0) return base;
	return `${base} · ${liveSessions} live`;
}

/** The row's one-line summary: milestones, then sessions, then the stale word. */
export function projectRowMeta(project: ProjectSummary): string {
	const parts = [
		milestoneCountLabel(project.milestones_completed, project.milestones_total),
		sessionCountLabel(project.sessions, project.live_sessions),
	];
	return parts.join(" · ");
}

/**
 * The stale verdict's ONE word, shared by the list row's badge, the detail's badge
 * and the row's accessible name.
 *
 * `progress stale` rather than a bare `stale`, and the reason is where the badge
 * sits: on the LIST it is beside the project name, over a meta line that counts
 * milestones and sessions and says nothing about progress, so a bare `stale` reads
 * as a verdict on the PROJECT (review round 1, D4). Naming what has gone old is
 * true in both places, because the condition is `progress_stale` over a progress
 * line that exists (`showsStaleMark`) — and ONE constant is what stops the two
 * surfaces drifting into two spellings of one fact again.
 */
export const STALE_BADGE_LABEL = "progress stale";

/**
 * Whether to show the stale mark, which is NOT the same question as
 * `project.progress_stale` on its own.
 *
 * The relay computes `progress_stale` from the configured window and it is `true`
 * BY CONSTRUCTION for a record that has never had a progress line at all — the
 * honest reading of "nothing has been reported" rather than of "what was
 * reported is old". Marking that row "stale" would spend the loudest ink on the
 * honest default and tell the reader a report exists when none does.
 *
 * Both fields are still the relay's: this is a DISPLAY condition over two of them,
 * never a second staleness computation. The web client's sheet encodes the same
 * rule against the same field pair, so the two surfaces agree about which rows
 * are marked.
 */
export function showsStaleMark(project: {
	progress_stale: boolean;
	progress_updated_at: number | null;
}): boolean {
	return project.progress_updated_at !== null && project.progress_stale;
}

/**
 * The sentence to show for a failed project read, or `null` when the failure has
 * no sentence of its own.
 *
 * A refusal that carries a body sentence is shown VERBATIM: the daemon writes
 * these for the reader ("no project with id or name 'paymnts' — closest:
 * payments-migration"), and re-wording one here would give a single refusal two
 * voices. `displayableMessage` is the taxonomy's ONE copy accessor and it is what
 * is read, not `message`: it refuses a runtime's own words, an empty body and
 * markup, so an HTML error page from a proxy can never reach a screen.
 *
 * `null` means the connection's own surface owns this failure — `transport` and
 * the gateway's deferrals already have a cause and a remedy there, and a second,
 * vaguer line beside them is the app inventing a problem.
 */
export function projectRefusalSentence(error: unknown): string | null {
	if (!isRelayError(error)) return null;
	/* The relay's OWN refusal, in its own words: `kind: "rejected"` is the
	 * definitive answer it wrote for a reader (the detail's `404
	 * project_not_found` on these read paths).
	 *
	 * NOT `surface === "none"`, which is what this gated on first — that surface is
	 * shared with `malformed-frame`, whose message is a CLIENT-side diagnostic
	 * (`"GET /api/projects did not match the relay contract"`) and must never reach
	 * user copy (review round 1, m1). Everything else — a transport drop, a gateway
	 * deferral, a certificate — is a connection failure whose own surface names its
	 * cause. */
	if (error.kind !== "rejected") return null;
	const sentence = error.displayableMessage.trim();
	return sentence === "" ? null : sentence;
}

/**
 * One linked session's display name.
 *
 * The TITLE when the relay resolved one, else the session id — never blank. A
 * link whose session directory is gone still has an id (`exists: false`), and an
 * empty row would be a link the reader cannot identify at all; the id is the one
 * thing that still names it (the store marks a missing link and never silently
 * removes it).
 */
export function linkedSessionLabel(link: LinkedSession): string {
	const title = link.title?.trim() ?? "";
	return title === "" ? link.session_id : title;
}

/**
 * The liveness word for one linked session, or `null` when the row carries none.
 *
 * `runtime.state` is the relay's own vocabulary (`live` / `wedged` / `stale` /
 * `stopped`), and `stopped` is the ordinary state of a session the operator
 * finished with — so it reads as "not running" rather than as an error. A
 * COORDINATION row carries no `runtime` at all by construction (it is filing
 * provenance, not work), which is `null` here rather than "stopped": a renderer
 * must not paint a filing as a worker that has stopped.
 */
export function linkedSessionState(link: LinkedSession): string | null {
	if (link.role === "coordination") return "filed by";
	if (!link.exists) return "missing";
	const state = link.runtime?.state;
	if (typeof state !== "string" || state === "") return null;
	return state === "stopped" ? "not running" : state;
}
