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

/* ---------------------------------------------------------------- writes --- */

/**
 * The message a milestone name containing a slash gets, and the reason it is the
 * PHONE that refuses it.
 *
 * The relay's remove route carries the milestone's name as the last PATH
 * SEGMENT (`/api/projects/{key}/milestones/{name}`, `[^/]+` upstream), so a name
 * with a slash is CREATABLE — the add route carries the name in its BODY — and
 * then unaddressable: `ship%2Fv2` does not reach the route and the relay answers
 * a bare `404 Not Found` with no JSON body at all (measured against an isolated
 * daemon, both raw and percent-encoded). The real remedy is a relay route that
 * does not put the key in the path; until then the honest control is an
 * explanation rather than a button that cannot work.
 *
 * THE MECHANISM STAYS HERE AND DOES NOT TRAVEL INTO THE SENTENCE. Both review
 * rounds took the first wording apart for it: a reader has no "route", and the
 * half they can act on is the consequence (U-21 — no jargon noun; say what
 * happens). What the reader needs is above the line; the paragraph you are
 * reading is where the why for the next maintainer lives.
 */
export const MILESTONE_SLASH_NOTE =
	"Milestone names can't contain a slash. A milestone with one could never be removed.";

/** Whether a typed milestone name is one this build will send. */
export function milestoneNameUsable(name: string): boolean {
	const trimmed = name.trim();
	return trimmed !== "" && !trimmed.includes("/");
}

/** Whether a name ALREADY on a milestone contains a slash — the other half of
 *  the guard: such a milestone cannot be removed from here at all. */
export function milestoneUnremovable(name: string): boolean {
	return name.includes("/");
}

/**
 * The name grammar, said BEFORE the tap.
 *
 * The relay's own refusal is `project name must be 1-64 characters of letters,
 * digits, dot, underscore or hyphen, and cannot start with a hyphen` — and this
 * hint exists so a reader does not spend a round trip learning the rule, so it
 * has to carry the WHOLE rule: the first version named the alphabet and stopped,
 * which still cost a round trip for a 65-character name or a leading hyphen
 * (U4). The wording stays in the reader's terms rather than the store's.
 */
export const PROJECT_NAME_HINT =
	"1-64 characters: letters, digits, dot, underscore or hyphen. No spaces, and it can't start with a hyphen.";

/**
 * What a form says when it reopens holding the reader's unfinished work.
 *
 * One string, used by both forms, because the behaviour had to become ONE rule:
 * the create sheet kept a dismissed draft silently while the milestone editor
 * reset itself, and neither reader could tell which was happening (U3). The rule
 * now is that a draft SURVIVES a dismissal — losing typed work to a stray tap is
 * the worse of the two failures — and the form says so, so a reader opening the
 * sheet to start something else is not silently handed the last attempt.
 */
export const DRAFT_KEPT_NOTE =
	"Kept from your last visit. Clear the fields to start something new.";

/**
 * The tags a reader typed, split the way a list is typed.
 *
 * Commas or whitespace, the two separators the tag grammar itself cannot
 * contain. The values are sent VERBATIM: an upper-case tag or a leading `#` is
 * the store's to refuse, with its own sentence, rather than this field's to
 * silently rewrite.
 */
export function parseTags(text: string): string[] {
	return text
		.split(/[\s,]+/)
		.map((tag) => tag.trim())
		.filter((tag) => tag !== "");
}

/** The deletion's confirmation sentence, naming what is lost and what is not. */
export function deleteProjectBody(displayName: string): string {
	return `Delete ${displayName}? The project row goes for good. Its linked sessions and their transcripts are not touched.`;
}

/** The milestone removal's confirmation sentence, the same two halves. */
export function removeMilestoneBody(name: string): string {
	return `Remove ${name} from this project? The milestone goes for good. The project's sessions and its progress line are not touched.`;
}

/**
 * What a failed project WRITE says when the relay wrote no sentence of its own.
 *
 * A transport failure is the one case where the outcome is genuinely UNKNOWN:
 * the request may have reached the store and its answer may have been lost, so
 * this sentence says that rather than "it did not work", which is a claim this
 * client cannot make. A definitive refusal never reaches here — it carries the
 * relay's own words (`projectRefusalSentence`).
 */
export const WRITE_UNKNOWN_NOTE =
	"We couldn't reach your computer, so we can't tell whether that was saved. Check the project before trying again.";

/** The one-line receipt a successful write leaves. */
export function writeReceipt(action: string, subject: string): string {
	return `${action} ${subject}.`;
}

/**
 * Whether a write's failure is the relay saying the row is GONE.
 *
 * Another surface — the tool, the desktop app, a second phone — deleted the
 * project between the read and the write. A refusal sentence standing under a
 * detail view for a row that no longer exists is a dead end (there is nothing
 * left to retry against), so the screen says what happened and goes back to the
 * listing, which is the shape the web client's sheet takes for the same case.
 */
export function isVanishRefusal(error: unknown): boolean {
	return (
		isRelayError(error) &&
		error.kind === "rejected" &&
		error.status === 404 &&
		error.code === "project_not_found"
	);
}
