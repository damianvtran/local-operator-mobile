/**
 * The sessions list's projections: what a row means, how rows group, and how
 * stale is stated. Pure functions, no React, no platform.
 *
 * Separated from the screen because these are the decisions a reviewer argues
 * with — the precedence of a state mark, which section a row belongs to, what
 * "stale" says — and a decision that can only be observed by rendering it is a
 * decision that gets changed by accident.
 */

import type { SessionSummary, UnreadBlock } from "@/contracts";

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

/**
 * True when the row is ANOTHER device's conversation.
 *
 * `locality` is the relay's own discriminator and the only one: a remote row is
 * exactly the one whose `locality` is `"remote"` (the phone's local rows carry
 * no `locality` key at all, and a future relay that stamps `"local"` on them
 * reads the same way here). Nothing else about a row — a missing `cwd`, a
 * defaulted `streaming` — may be used to infer it: the boundary defaults make
 * every omitted local-only field look like an ordinary inert local value.
 */
export function isRemoteRow(session: SessionSummary): boolean {
	return session.locality === "remote";
}

/** The gate a REMOTE row is waiting on, in the answer family's own words — or
 *  `null`.
 *
 *  `pending` is the transport's gate word VERBATIM, and this is its one reading
 *  on the phone: never mapped into the local `pending_kind` vocabulary, never
 *  guessed from a mark. The vocabulary is OPEN by contract (`approval` / `ask`
 *  today, additive tomorrow — round 1, R1-1), so the reading is the relay's own
 *  (`session/catalog.py` `status_code`): a truthy gate that is exactly
 *  `"approval"` spells approval; EVERY other gate word reads as the answer
 *  family, this surface's "question" (`attentionWord`). A falsy gate (`null` /
 *  absent — or an empty word, which the relay's own boundary already turns into
 *  `null`) is no gate. A local row answers `null` here — its gates are
 *  `needs_attention`/`pending_kind`, which is the sibling function below, and
 *  mixing the two vocabularies on one row is how a remote row would silently
 *  read as idle. */
export function remoteAttention(
	session: SessionSummary,
): "approval" | "answer" | null {
	if (!session.pending) return null;
	return session.pending === "approval" ? "approval" : "answer";
}

/**
 * True when the row belongs in the Running bin — a turn is live on it, or it
 * waits on the reader.
 *
 * LOCAL rows read the relay's `streaming`/`needs_attention` pair. REMOTE rows
 * read the transport's `pending`/`live_state` VERBATIM, per the relay's own
 * staging rule: any gate word, or a busy/wedged owner. The other
 * two live words are deliberately NOT Running: `idle` is live but not working,
 * and `attached` means a terminal is watching — neither is this list's
 * "Running", and inventing a third spelling for either is the drift the shared
 * vocabulary exists to stop.
 */
export function rowIsRunning(session: SessionSummary): boolean {
	if (isRemoteRow(session)) {
		return (
			remoteAttention(session) !== null ||
			session.live_state === "busy" ||
			session.live_state === "wedged"
		);
	}
	return session.streaming || session.needs_attention;
}

export function rowMark(session: SessionSummary): RowMark {
	if (isRemoteRow(session)) {
		/* The remote ladder, in the same precedence order as the local one: the
		 * gate outranks everything (a decision runs INSIDE a turn), then the two
		 * live words that are this list's Running. `wedged` takes the degraded
		 * mark, not the running one: `wedged` is the owner having STOPPED
		 * reporting, and the mark's job is to say what the reader needs to know —
		 * that row needs a person, not a spinner. `unseen`/`ended` cannot occur:
		 * this device holds no attention store or generation record for a peer's
		 * conversation, so their defaults read `false` and are not consulted. */
		if (remoteAttention(session) !== null) return "decision";
		if (session.live_state === "busy") return "running";
		if (session.live_state === "wedged") return "degraded";
		return "idle";
	}
	if (session.needs_attention) return "decision";
	if (session.streaming) return "running";
	if (session.unseen) return "new";
	if (session.ended) return "ended";
	if (session.degraded) return "degraded";
	return "idle";
}

/** The attention word a decision row carries. `pending_kind` is `"approval"`,
 *  `"ask"`, or empty, and the empty case still has to say something: the relay
 *  said something needs a decision and did not say which. A REMOTE row's gate
 *  is its `pending` word, mapped onto the same two words this surface already
 *  shows — only `approval` spells approval, and every other gate word is what
 *  the app spells "question" for the local ask gate. */
export function attentionWord(
	session: SessionSummary,
): "approval" | "question" {
	if (isRemoteRow(session)) {
		return remoteAttention(session) === "approval" ? "approval" : "question";
	}
	return session.pending_kind === "ask" ? "question" : "approval";
}

/**
 * The §1.4 badge number, off the frame-level `unread` block — or `null` for
 * every state where the number is not readable.
 *
 * The badge means "conversations with unread notifications" (ADR 0006 §1.4),
 * and the number is the MACHINE's own read (§1.1) — a conversation with three
 * unread completions counts once, and no client recomputes it from its own
 * list. This function therefore deliberately does NOT fall back to counting
 * `unseen` rows and does NOT return `0` for absence: an older relay omits the
 * block, and a degraded one withholds `count`, and both absences mean
 * **unknown** — the header shows no number rather than one the machine did
 * not give. (`0` — a readable count of zero — is a real answer and clears the
 * badge, which is what the caller's `> 0` check is for.)
 */
export function unreadBadgeCount(block: UnreadBlock | null): number | null {
	if (block === null || block.count === undefined) return null;
	return block.count;
}

/**
 * The stale line, or `null`.
 *
 * The cold-start rule (`docs/architecture.md` § Lifecycle) is that the last known
 * list keeps rendering while the stream reconnects, marked as old rather than
 * blanked. This is the marking: a sentence with the age in it, because "stale"
 * alone gives the reader no way to judge whether to wait or to act.
 */
export type StaleNoteInput = {
	stale: boolean;
	lastFrameAt: number | null;
	now?: number;
};

export function staleNote(input: StaleNoteInput): string | null {
	const phrase = stalePhrase(input);
	return phrase === null ? null : `Last updated ${phrase}.`;
}

/**
 * The same age, in a form that fits ONE line at the platform's largest text size.
 *
 * The stale line shares the degraded band with the banner, and the band is what
 * decides how many rows are complete: at 320 pt / 200 % a `body-sm` line is
 * 40.6 dp and the band has about 55 dp left under a capped banner, so this line
 * may occupy one line and no more (review round 6, M-B). Capping it there is not
 * enough by itself — a capped 22-character sentence paints `Last updated …` and
 * hides the age, which is the only thing this line carries, and hiding the
 * actionable part is the D29 defect in reverse (D3). So the narrow
 * configuration gets an age-only sentence that fits whole: one line holds about
 * twelve characters at that size.
 *
 * The connection pill directly above states the CONDITION (`Not answering`) with
 * the long sentence as its message, so the short form drops the verb and keeps
 * the number — the reader has the sentence and the number on screen, and neither
 * is truncated.
 */
export function staleShortNote(input: StaleNoteInput): string | null {
	const phrase = stalePhrase(input);
	if (phrase === null) return null;
	return `${phrase === "just now" ? "Just now" : phrase}.`;
}

/**
 * How old the last frame is, as a phrase with no verb — `just now`, `30s ago`,
 * `5 min ago`, `3h ago`, `2d ago` — or `null` when nothing has ever been stale.
 *
 * The unit is the largest that keeps the phrase short, and that is what BOUNDS
 * the short sentence: a minutes-only form grew without limit, so a week-old list
 * read `10080 min ago.` — fourteen characters against the twelve one line holds
 * at 200 % — and the short form exists precisely to fit one line whole (review
 * round 2, R2-5).
 *
 * One phrase for both sentences, so the long form and the short form cannot
 * disagree about the age the reader is being told.
 */
function stalePhrase(input: StaleNoteInput): string | null {
	if (!input.stale || input.lastFrameAt === null) return null;
	const now = input.now ?? Date.now();
	const seconds = Math.max(0, Math.round((now - input.lastFrameAt) / 1000));
	if (seconds < 5) return "just now";
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
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
/**
 * The conversations panel's sections, and the row's relative time — the
 * desktop's own vocabulary and rules (`local-operator-ui` `chat-list-sections.ts`,
 * read at 854afeb7), adopted here because the panel IS the sessions list now.
 *
 *   RUNNING    a turn is live or waiting on the reader (`streaming ||
 *              needs_attention`). Never collapsed, and **no time**: a running
 *              row's time is "now", which says nothing.
 *   TODAY      last moved on this local calendar day. Calendar days rather than a
 *              rolling 24 h, because "today" is the word on screen: a
 *              conversation from 11 pm yesterday is not from today at 9 am,
 *              whatever the arithmetic says.
 *   THIS WEEK  within the last seven days, and not today.
 *   OLDER      everything else.
 *
 * PINNED outranks the binning — the app's existing rule (a pinned previous
 * conversation belongs with the pinned ones, or pinning appears to do nothing).
 *
 * **Nothing here re-sorts.** The relay's order holds inside each bucket, exactly
 * as it did in the old sections; bucketing is `filter`.
 *
 * The time basis is `(created_at ?? mtime) × 1000` — both are epoch SECONDS on
 * the wire (`SessionSummary`), and `created_at` is absent on older relays. A
 * REMOTE row's two clocks are the same number (the peer's `started` claim), so
 * the basis is that claim either way. A basis of `<= 0` is the relay's NO CLAIM
 * — an old-build peer's non-number birth stamp arrives as `0.0` — and such a
 * row bins by the time branch below (→ Older) with NO label (`relativeTimeFor`),
 * exactly where the relay ranked it last; never as a 1970 date (the desktop
 * sidebar's rule, `local-operator-ui` #903).
 */
export type SidebarSections = {
	pinned: SessionSummary[];
	running: SessionSummary[];
	today: SessionSummary[];
	week: SessionSummary[];
	older: SessionSummary[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** A row's time in epoch MILLISECONDS: the activity clock, or the conversation's
 *  birth when a relay predates `created_at` — or `null` when the row carries NO
 *  usable clock.
 *
 * `null` is a REAL reading here, not an error: `created_at`/`mtime` `<= 0` is
 * the relay's no-claim (a non-number birth stamp — an old-build peer's — is read
 * as `0.0` at the relay's own boundary), and no surface may render a no-claim as
 * an ancient date. The row paints no label and the relay's own ranking has
 * already placed it last inside its bin. */
export function rowTimeMs(session: SessionSummary): number | null {
	const stamp = session.created_at ?? session.mtime;
	return typeof stamp === "number" && stamp > 0 ? stamp * 1000 : null;
}

/** Local midnight for `now` — the boundary "Today" means. */
const startOfDayMs = (now: number): number => {
	const date = new Date(now);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
};

export function splitSidebarSections(
	sessions: readonly SessionSummary[],
	now: number = Date.now(),
): SidebarSections {
	const out: SidebarSections = {
		pinned: [],
		running: [],
		today: [],
		week: [],
		older: [],
	};
	const startOfDay = startOfDayMs(now);
	for (const session of sessions) {
		if (session.pinned) {
			out.pinned.push(session);
			continue;
		}
		if (rowIsRunning(session)) {
			out.running.push(session);
			continue;
		}
		const at = rowTimeMs(session);
		if (at !== null && at >= startOfDay) out.today.push(session);
		else if (at !== null && now - at < 7 * DAY_MS) out.week.push(session);
		else out.older.push(session);
	}
	return out;
}

/**
 * The row's trailing relative time — `now`, `5 min`, `3h`, `2d` — the companion
 * of the sections above. Without it a time-based section is illegible: the
 * section says WHEN, the row must say how long ago.
 *
 * Minutes are spelled `min` (the spec's own examples). Weeks and years fold the
 * same way the desktop's `relativeTime` does, so a long-cold row stays short.
 *
 * `null` for a row the panel paints no time on — a running row (see the section
 * comment above), or a row whose clock is a NO CLAIM (`rowTimeMs`). The rule
 * lives HERE, not at the render site, so the row and the section cannot disagree
 * about which rows carry a time.
 */
export function relativeTimeFor(
	session: SessionSummary,
	now: number = Date.now(),
): string | null {
	if (rowIsRunning(session)) return null;
	const at = rowTimeMs(session);
	if (at === null) return null;
	const minutes = Math.floor(Math.max(0, now - at) / 60_000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	const weeks = Math.floor(days / 7);
	if (days < 365) return `${weeks}w`;
	return `${Math.floor(days / 365)}y`;
}

export function degradedShortNote(degraded: readonly string[]): string {
	if (degraded.includes("sessions") && degraded.includes("attention"))
		return "This list may be incomplete.";
	if (degraded.includes("sessions")) return "Some rows may be missing.";
	return "New markers may be stale.";
}

/**
 * A remote row's device label: the owner's name, else the id's TAIL — the
 * desktop's own `deviceLabel` rule, adopted so one device is never spelled two
 * ways across two clients.
 *
 * The tail rather than the id whole because a 34-character hash does not fit a
 * row and says nothing a person recognises; the tail still tells two unnamed
 * devices apart. "another device" is the honest last resort when the transport
 * named neither — never an empty string on a line the reader must understand.
 */
export function remoteDeviceLabel(
	session: Pick<SessionSummary, "owner_device" | "owner_device_name">,
): string {
	const name = session.owner_device_name?.trim();
	if (name) return name;
	const id = session.owner_device?.trim() ?? "";
	return id.length > 0 ? `device …${id.slice(-6)}` : "another device";
}

/** One peer the loaded list reveals: the device id a move can name, and the
 *  label to show for it. */
export type VisiblePeer = { deviceId: string; label: string };

/**
 * The devices the sessions payload ITSELF reveals, in first-seen order.
 *
 * This is the whole destination catalogue the phone has today: a device appears
 * when it owns at least one visible session, and disappears when it owns none.
 * That is a named GAP, not the design — a full peer picker needs the network's
 * own device listing (the desktop's peers route, `lop network peers`) served to
 * this plane; until that route exists, offering exactly the devices whose rows
 * the reader can see is the honest scope. A device the transport did not give
 * an id for cannot be a destination (the move takes an id or `"local"`), so
 * such rows contribute no entry rather than a dead one.
 */
export function visiblePeers(
	sessions: readonly SessionSummary[],
): VisiblePeer[] {
	const out: VisiblePeer[] = [];
	const seen = new Set<string>();
	for (const session of sessions) {
		if (!isRemoteRow(session)) continue;
		const deviceId = session.owner_device?.trim() ?? "";
		if (deviceId.length === 0 || seen.has(deviceId)) continue;
		seen.add(deviceId);
		out.push({ deviceId, label: remoteDeviceLabel(session) });
	}
	return out;
}
