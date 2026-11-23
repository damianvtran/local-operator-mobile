/**
 * Community render and flow decisions, as pure functions.
 *
 * WHY THIS MODULE EXISTS. Every rule here has a desktop twin in
 * `local-operator-ui` (`features/community/community-model.ts`,
 * `community-attempts.ts`, `team-bridge-scope-preference.ts`). The phone mirrors
 * that BEHAVIOUR, not its code, and keeps the rules free of React Native so
 * Node tests pin them (`vitest.config.ts`: unit tests run in Node).
 */

import { type CommunityError, isCommunityError } from "@/community/client";
import type {
	AgentApproval,
	Bootstrap,
	Channel,
	CommunityRole,
	CommunityMessage as Message,
	RefusalCategory,
} from "@/community/contract";

/* -------------------------------------------------------------------------- */
/* Switcher and opening selection (RFC v2.4 Amendment A)                       */
/* -------------------------------------------------------------------------- */

/** A private Team org row as the switcher holds it (`team-bridge/model` `Organization`). */
export type PrivateOrgRow = {
	tenantId: string;
	/** A pending invitation to this org rather than a membership (frame D22). */
	invited?: boolean;
};

/** One joined community in the Communities group: its own scope and unread count. */
export type CommunityRow = {
	communityId: string;
	name: string;
	unread: number;
	readOnly: boolean;
};

/**
 * Where Team Bridge lands. A community is its own variant, never a tenant id,
 * so no private read can be handed a community id by accident.
 */
export type BridgeSelection =
	| { kind: "private"; tenantId: string }
	| { kind: "community"; communityId: string };

/**
 * Amendment A §3's opening rule, first match wins:
 *
 * 1. A pending invitation to a private org (D22). The mobile status read does
 *    not carry invitations yet, so today this only fires for callers that pass
 *    one; the rule is here so the data, when it lands, has one place to go.
 * 2. This app session's selection, if still valid (a listed org, or a joined
 *    community). Amendment A: a switch "lasts until you switch back or restart
 *    the app". The session value lives in memory only, so a restart drops it.
 * 3. The account's default private org (Radient home tenant), when it is one
 *    of the reader's Team Bridge orgs. The phone has no memberships read that
 *    names the home tenant yet, so production callers pass none and this rule
 *    is inert until one lands; the slot is here so the order cannot drift.
 * 4. Exactly one private org: that org.
 * 5. The durable last-used private org (`recallOrg`), when still listed.
 * 6. Several private orgs: the first in the hub's order. The phone's switcher
 *    has no "All organizations" row, so this is the desktop's union rule's
 *    phone equivalent (the shipped mobile rule).
 * 7. Only with NO private org and no invitation: the first joined community.
 *    This is the only way a community is ever a launch default.
 *
 * The order is the desktop's `resolveDefaultSelection`
 * (local-operator-ui `team-bridge-scope-preference.ts`) rule for rule, so a
 * reader lands in the same place on both clients.
 *
 * `null` means nothing to open (no org, no community).
 */
export function openingSelection({
	organizations,
	communities,
	session,
	defaultTenantId,
	stored,
}: {
	organizations: readonly PrivateOrgRow[];
	communities: readonly Pick<CommunityRow, "communityId">[];
	session?: BridgeSelection | null;
	defaultTenantId?: string | null;
	/** The durable last-used private org (never a community). */
	stored?: string | null;
}): BridgeSelection | null {
	const invited = organizations.find((org) => org.invited);
	if (invited) return { kind: "private", tenantId: invited.tenantId };
	if (
		session?.kind === "private" &&
		organizations.some((org) => org.tenantId === session.tenantId)
	)
		return session;
	if (
		session?.kind === "community" &&
		communities.some((row) => row.communityId === session.communityId)
	)
		return session;
	if (
		defaultTenantId &&
		organizations.some((org) => org.tenantId === defaultTenantId)
	)
		return { kind: "private", tenantId: defaultTenantId };
	if (organizations.length === 1 && organizations[0])
		return { kind: "private", tenantId: organizations[0].tenantId };
	if (stored && organizations.some((org) => org.tenantId === stored))
		return { kind: "private", tenantId: stored };
	const first = organizations[0];
	if (first) return { kind: "private", tenantId: first.tenantId };
	const community = communities[0];
	if (community)
		return { kind: "community", communityId: community.communityId };
	return null;
}

/**
 * What the Team Bridge list does when it MOUNTS (Amendment A §3 on the phone).
 *
 * The phone's private list and a community are two routes, so "landing" in a
 * community means the list replacing itself with that community's home. This
 * decides it from the two stores' states:
 *
 * - `wait`: an input is still in flight (the hub's status, or the joined
 *   communities read). Deciding early would land a reader with a community on
 *   the no-plan gate, or flash a community before the default org is known.
 * - `stay`: the rule picked a private org (the list's own store already
 *   selects it), or the gate is an error/sign-in state a redirect would hide.
 * - `community`: rule 2 (this session's community) or rule 7 (no private org).
 *
 * A failed communities read counts as "none joined": the private list (or the
 * no-plan gate with its join card) is the safe landing, never a spinner.
 */
export type OpeningRoute =
	| { kind: "wait" }
	| { kind: "stay" }
	| { kind: "community"; communityId: string };

export function openingRoute({
	gate,
	organizations,
	communitiesState,
	communities,
	session,
}: {
	/** `TeamBridgeState.gate`: `open` lists orgs; `plan_required` means none. */
	gate: string;
	organizations: readonly PrivateOrgRow[];
	communitiesState: "idle" | "loading" | "ready" | "error";
	communities: readonly Pick<CommunityRow, "communityId">[];
	session?: BridgeSelection | null;
}): OpeningRoute {
	if (gate === "checking") return { kind: "wait" };
	if (gate !== "open" && gate !== "plan_required") return { kind: "stay" };
	if (communitiesState === "idle" || communitiesState === "loading")
		return { kind: "wait" };
	const selection = openingSelection({
		organizations: gate === "open" ? organizations : [],
		communities: communitiesState === "ready" ? communities : [],
		session,
	});
	return selection?.kind === "community"
		? { kind: "community", communityId: selection.communityId }
		: { kind: "stay" };
}

/**
 * Past this many joined communities the group gains a search field and scrolls
 * (Amendment A §2: "scrolling past 6, with search"). The RFC's number, not a
 * measured fit.
 */
export const COMMUNITY_SEARCH_THRESHOLD = 6;

/**
 * The Communities group of the switcher. A community's unread count NEVER adds
 * into the private total (Amendment A §2), which is why this returns its own
 * rows rather than appending to the organizations list. The group is drawn
 * exactly when the build flag is on, so "Browse communities…" is reachable
 * with none joined. With the flag off nothing community-shaped is drawn or
 * read: the flag is a bundle-time constant (`flag.ts`), so there is no
 * mid-session "turned off for a member" state to keep reachable.
 */
export function communityGroup({
	communities,
	enabled,
	query = "",
}: {
	communities: readonly CommunityRow[];
	enabled: boolean;
	query?: string;
}): { show: boolean; search: boolean; rows: CommunityRow[] } {
	const needle = query.trim().toLocaleLowerCase();
	return {
		show: enabled,
		// Decided on the JOINED count so typing never removes the field being typed in.
		search: communities.length > COMMUNITY_SEARCH_THRESHOLD,
		rows: needle
			? communities.filter((row) =>
					row.name.toLocaleLowerCase().includes(needle),
				)
			: [...communities],
	};
}

/**
 * A community's switcher count: its joined channels' unread, plus its DMs'.
 * Never added to the private "All organizations" total (Amendment A §2).
 */
export function communityUnread(
	channels: readonly Pick<Channel, "unread" | "member">[],
	directs: readonly { unread: number }[] = [],
): number {
	let total = 0;
	for (const channel of channels)
		if (channel.member !== false) total += channel.unread ?? 0;
	for (const direct of directs) total += direct.unread;
	return total;
}

/* -------------------------------------------------------------------------- */
/* Membership and guidelines                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the join dialog must do for this bootstrap.
 *
 * - `join`: not a member; show the guidelines with an unchecked agreement.
 * - `reaccept`: a member whose accepted version is not the current one (RFC
 *   §5.11, "rules updates"); writes that depend on the guidelines answer 409
 *   until they accept again, so the dialog shows the NEW version.
 * - `none`: a current member.
 * - `closed`: a read-only community; a non-member cannot join it at all.
 */
export function guidelinesStep(
	bootstrap: Bootstrap,
): "join" | "reaccept" | "none" | "closed" {
	if (!bootstrap.membership)
		return bootstrap.community.state === "active" ? "join" : "closed";
	return bootstrap.membership.guidelines_version ===
		bootstrap.guidelines.version
		? "none"
		: "reaccept";
}

/* -------------------------------------------------------------------------- */
/* Channels                                                                   */
/* -------------------------------------------------------------------------- */

/** Why the composer is not offered in a channel, or `null` when it is. */
export function postingBlock(
	channel: Pick<Channel, "posting" | "locked" | "archived">,
	options: { role: CommunityRole | null; readOnlyCommunity: boolean },
): "read_only" | "archived" | "locked" | "staff_only" | null {
	if (options.readOnlyCommunity) return "read_only";
	if (channel.archived) return "archived";
	if (channel.locked) return "locked";
	if (
		channel.posting === "staff" &&
		options.role !== "staff" &&
		options.role !== "moderator"
	)
		return "staff_only";
	return null;
}

/**
 * Apply a fresh NEWEST page (an open, an event, a publish) to the history held.
 *
 * WHY NOT A UNION (review round 1, R1-2). The server drops deleted and
 * moderator-removed messages from history (`deleted:false`; a deleted root
 * with replies is the one tombstone it keeps) and cuts history at a block. A
 * union with what the phone already held kept such a message on screen for
 * the whole app session. So the newest page is AUTHORITATIVE for the seq
 * window it covers (`seq >= its oldest seq`): every held message in that
 * window that the page no longer carries is dropped. Messages below the
 * window (older pages the reader loaded) are kept; `loadOlder` still merges
 * by union, because an older page says nothing about newer seqs.
 *
 * A page with no `next_cursor` is the WHOLE history, so it replaces
 * everything, including older pages held from before a deletion.
 */
export function replaceNewestWindow(
	current: readonly Message[],
	page: readonly Message[],
	complete: boolean,
): { messages: Message[]; keptOlder: boolean } {
	if (complete || page.length === 0) {
		/* An empty newest page with a cursor cannot happen by contract; treat it
		 * as the whole history rather than keep messages nothing vouches for. */
		return { messages: mergeMessages([], page), keptOlder: false };
	}
	const floor = Math.min(...page.map((message) => message.seq));
	const older = current.filter((message) => message.seq < floor);
	return {
		messages: mergeMessages(older, page),
		keptOlder: older.length > 0,
	};
}

/**
 * Merge pages of history into one OLDEST-first list (the order a thread
 * renders), deduplicated by message id; a message edited between reads keeps
 * its newest revision. The server pages newest first with viewer-bound
 * cursors, so a page's order is never trusted: `seq` decides.
 */
export function mergeMessages(
	current: readonly Message[],
	incoming: readonly Message[],
): Message[] {
	const byId = new Map<string, Message>();
	for (const message of [...current, ...incoming]) {
		const held = byId.get(message.id);
		if (!held || (message.revision ?? 0) >= (held.revision ?? 0))
			byId.set(message.id, message);
	}
	return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Five minutes: a reply after a pause re-states who is speaking. */
const GROUP_GAP_MS = 5 * 60_000;

/**
 * Does this message open a new author group (avatar + name line)? Consecutive
 * messages by the same author within `GROUP_GAP_MS` share one header, the
 * Team Bridge thread's run convention, so the avatar marks a change of
 * speaker rather than repeating down the column (design review round 1, D1).
 */
export function startsGroup(
	previous: Message | undefined,
	message: Message,
): boolean {
	if (!previous) return true;
	const a = previous.author;
	const b = message.author;
	if (a.kind !== b.kind || (a.public_id ?? null) !== (b.public_id ?? null))
		return true;
	if (!b.public_id && a.display_name !== b.display_name) return true;
	if (previous.deleted || message.deleted) return true;
	const gap = Date.parse(message.created_at) - Date.parse(previous.created_at);
	return !(gap >= 0 && gap < GROUP_GAP_MS);
}

/**
 * A profile's join month ("YYYY-MM", contract `Profile.joined_month`) as a
 * month name in the APP locale ("November 2026", "ноябрь 2026 г."), never the
 * raw ISO string (review round 1, R1-7). UTC on both ends: the value names a
 * calendar month, not an instant, so no device timezone may shift it. An
 * unreadable value is shown as served rather than dropped.
 */
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;
export function joinedMonthLabel(value: string, locale: string): string {
	const match = YEAR_MONTH.exec(value);
	if (!match) return value;
	const month = Number(match[2]);
	if (month < 1 || month > 12) return value;
	try {
		return new Intl.DateTimeFormat(locale, {
			month: "long",
			year: "numeric",
			timeZone: "UTC",
		}).format(Date.UTC(Number(match[1]), month - 1, 1));
	} catch {
		return value;
	}
}

/** The contract's cap on a submission's text (`SubmissionForm.text` maxLength). */
export const SUBMISSION_MAX_CHARS = 4000;

/**
 * Is this the server's pending-name placeholder ("New member · 1164")?
 *
 * A member whose display name has not passed the name check is served under a
 * placeholder (contract `Profile.display_name`: "Last approved value, or a New
 * member · NNNN placeholder"). Its initials ("NM") would read as a real
 * person's monogram, so the avatar shows the default mark instead (design
 * review round 1, D9; RFC frame D6). The contract carries no flag for this, so
 * the placeholder's own fixed shape is the signal; the server renders it in
 * English today (D10 is a server follow-up), and a localised placeholder would
 * simply fall back to initials, never mis-render.
 */
const PLACEHOLDER_NAME = /^New member · \d{1,8}$/;
export function isPlaceholderName(name: string): boolean {
	return PLACEHOLDER_NAME.test(name.trim());
}

/* -------------------------------------------------------------------------- */
/* Submissions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The composer's state for one attempt. Only the SENDER ever sees these (RFC
 * §5.5): a refusal's category and reference are never shown to anyone else, and
 * nothing about a refused message is stored but the reference.
 *
 * - `checking`: in flight ("Checking…" with Cancel on every surface).
 * - `refused`: category + `MOD-XXXX-XXXX` reference; the draft stays editable.
 * - `limited`: a per-sender limit; Retry after `retryAt` reuses the key.
 * - `unavailable`: moderation or auth could not answer; Retry reuses the key.
 * - `images_unavailable`: images cannot be posted in communities yet.
 * - `guidelines`: the guidelines changed; re-accept, then Retry.
 * - `forbidden`: this member may not post here (locked, seat, sanction).
 * - `failed`: the network dropped or an unexpected answer; Retry reuses the key.
 * - `invalid`: the server rejected the request itself (400 / 413: over the
 *   4000-character cap, a malformed body). Resending the same bytes can never
 *   pass, so there is no Retry; editing the text makes a new attempt.
 * - `cancelled`: Cancel won the race; nothing was posted.
 */
export type AttemptState =
	| { kind: "checking" }
	| { kind: "refused"; category: RefusalCategory; reference: string }
	| { kind: "limited"; retryAt: number }
	| { kind: "unavailable"; retryAt: number | null }
	| { kind: "images_unavailable" }
	| { kind: "guidelines"; version: string | null }
	| { kind: "forbidden"; reference: string | null }
	| { kind: "failed" }
	| { kind: "invalid" }
	| { kind: "cancelled" };

export type Attempt = {
	/** Reused by every retry of this text; a new send mints a new one. */
	key: string;
	/**
	 * The server settled this key as `expired` (observed for a key whose
	 * moderation could not answer). An expired key replays `expired` forever,
	 * so the next Retry must mint a fresh key rather than reuse this one.
	 */
	rekey?: boolean;
	text: string;
	threadRootId: string | null;
	state: AttemptState;
};

/** Map a failed submission to the state the composer shows. */
export function attemptStateFromError(
	error: unknown,
	now: number,
): AttemptState {
	if (!isCommunityError(error)) return { kind: "failed" };
	return attemptStateFromCommunityError(error, now);
}

function attemptStateFromCommunityError(
	error: CommunityError,
	now: number,
): AttemptState {
	switch (error.kind) {
		case "refused":
			return error.refusal
				? {
						kind: "refused",
						category: error.refusal.category,
						reference: error.refusal.reference,
					}
				: { kind: "failed" };
		case "rate_limited":
			return { kind: "limited", retryAt: now + (error.retryAfterMs ?? 1_000) };
		case "moderation_unavailable":
		case "auth_unavailable":
		case "unavailable":
			return {
				kind: "unavailable",
				retryAt: error.retryAfterMs === null ? null : now + error.retryAfterMs,
			};
		case "images_unavailable":
			return { kind: "images_unavailable" };
		case "guidelines_changed":
			return { kind: "guidelines", version: error.guidelinesVersion };
		case "restricted":
			return { kind: "forbidden", reference: error.reference };
		case "forbidden":
			return { kind: "forbidden", reference: null };
		case "invalid":
		case "too_large":
			return { kind: "invalid" };
		default:
			return { kind: "failed" };
	}
}

/**
 * Whether Retry may resend under the SAME key. True for every state whose
 * attempt left no final outcome on the server (throttled, unavailable,
 * dropped): the contract says such a key "reads 404 and may be retried". A
 * refusal is final for its key; editing the text and sending is a new attempt.
 */
export function retryKeepsKey(state: AttemptState): boolean {
	return (
		state.kind === "limited" ||
		state.kind === "unavailable" ||
		state.kind === "failed" ||
		state.kind === "guidelines"
	);
}

/** The draft to keep after an outcome: everything but a published send keeps the text. */
export function draftAfter(
	state: AttemptState | "published",
	text: string,
): string {
	return state === "published" ? "" : text;
}

/* -------------------------------------------------------------------------- */
/* Agent approvals                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The stubs the Requests → Agent approvals list shows: pending and unexpired,
 * soonest expiry first. Everything else is history another device already
 * answered (the `approval_changed` event refreshes the list).
 */
export function pendingApprovals(
	approvals: readonly AgentApproval[],
	now: number,
): AgentApproval[] {
	return approvals
		.filter(
			(approval) =>
				approval.state === "pending" && Date.parse(approval.expires_at) > now,
		)
		.sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at));
}

/** Whole hours left, rounded up, never below 1 while pending ("expires in 24 h"). */
export function hoursLeft(expiresAt: string, now: number): number {
	return Math.max(1, Math.ceil((Date.parse(expiresAt) - now) / 3_600_000));
}

/**
 * The time left before an expiry, in the unit a reader thinks in (design
 * review round 1, D6): a DM request lives 7 days, and "168 h" makes the reader
 * do arithmetic. Hours up to 48, whole days (rounded up) beyond.
 */
export function expiryLeft(
	expiresAt: string,
	now: number,
): { unit: "hours" | "days"; count: number } {
	const hours = hoursLeft(expiresAt, now);
	return hours <= 48
		? { unit: "hours", count: hours }
		: { unit: "days", count: Math.ceil(hours / 24) };
}
