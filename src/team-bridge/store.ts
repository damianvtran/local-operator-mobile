import { accountIdFromToken } from "@/connection/radient-identity";

export { accountIdFromToken } from "@/connection/radient-identity";

/**
 * Team Bridge state: one store per process, shared by the list, the thread and
 * the navigation entry's badge.
 *
 * WHY A STORE AND NOT SCREEN STATE. The list and the thread both show a
 * conversation's unread count, and the drawer entry shows the account total. If
 * each screen held its own copy, reading a thread would leave the list's badge
 * stale until a refetch, which is the "two screens disagree" defect this app
 * avoids everywhere else. A read the thread makes (`markRead`) updates the one
 * row everyone renders.
 *
 * WHAT IT DOES NOT HOLD. No token, and no message body outside the open thread's
 * page. Bodies live only in `threads`, keyed by conversation, and the whole store
 * resets on sign-out (`reset`), so a second account on the same phone never sees
 * the first one's messages.
 *
 * The store is plain (no React), so the transitions are Node-testable.
 */

import { createStore } from "zustand/vanilla";

import {
	type AttachmentLimits,
	attachmentLimits,
	clearAttachmentCache,
} from "@/team-bridge/attachments";
import { transientDelay } from "@/team-bridge/avatars";
import { type HubClient, HubError, isHubError } from "@/team-bridge/client";
import type {
	Conversation,
	DirectoryMember,
	MentionRow,
	Message,
	Notify,
	Reaction,
	StatusConsent,
} from "@/team-bridge/contract";
import {
	clearTeamBridgeEmoji,
	recordTeamBridgeEmoji,
} from "@/team-bridge/emoji-usage";
import { clearTeamBridgeTargets } from "@/team-bridge/last-target";
import {
	type DefaultOnNotice,
	defaultOnNoticeFor,
	type Eligibility,
	eligibility,
	mergeMessages,
	type Organization,
	organizationsFrom,
	preferredOrganization,
	type StatusRead,
	sameValue,
} from "@/team-bridge/model";
import { reactionAdds, toggleReaction } from "@/team-bridge/reactions";
import {
	isReplyThreadPageFor,
	protectHeldThreadCursors,
	type ReplyThreadTarget,
	replyThreadKey,
	rootAfterThreadRead,
	rootFromServedPage,
	withRoot,
} from "@/team-bridge/reply-threads";
import { clearTeamBridgeDrafts } from "@/team-bridge/thread-drafts";

export type LoadState = "idle" | "loading" | "ready" | "error";

export interface OrgData {
	conversations: Conversation[];
	conversationsState: LoadState;
	conversationsError: HubError | null;
	people: DirectoryMember[];
	peopleIncomplete: boolean;
	peopleState: LoadState;
	peopleError: HubError | null;
	refreshedAt: number | null;
	/** When the directory last answered; drives `DIRECTORY_TTL_MS`. */
	peopleRefreshedAt: number | null;
	/**
	 * The hub has refused this half with 429 at least twice in a row: the
	 * Retry-After wait passed and the retry was refused again. Only then does the
	 * list say "Catching up…" (calm, never an alert); a single 429 is waited out
	 * silently. Held rows stay on screen either way.
	 */
	conversationsCatchingUp: boolean;
	peopleCatchingUp: boolean;
}

export interface ThreadData {
	messages: Message[];
	state: LoadState;
	error: HubError | null;
	/** More history exists before the oldest held message. */
	hasMore: boolean;
	loadingOlder: boolean;
	olderError: HubError | null;
}

/**
 * One REPLY thread (`reply-threads.ts`): its root as the hub last served it and
 * its replies oldest-first. Bodies, so it lives beside `threads` and resets
 * with it on sign-out.
 */
export interface ReplyThreadData {
	root: Message | null;
	replies: Message[];
	state: LoadState;
	error: HubError | null;
	/**
	 * Where `loadMoreReplies` resumes (the hub's inclusive `next_after_seq`),
	 * or null when the hub said there is nothing past what is held. Kept so a
	 * thread longer than one load's page cap stays reachable instead of being
	 * silently treated as complete (agent review R2: reply 501 was unreachable,
	 * so it could never be displayed or acknowledged).
	 */
	moreAfterSeq: number | null;
}

export interface TeamBridgeState {
	/** `checking` until the first status answer; then a gate or `open`. */
	gate: "checking" | "open" | Eligibility;
	gateError: HubError | null;
	selfAccountId: string | null;
	organizations: Organization[];
	selectedTenantId: string | null;
	totalUnread: number;
	/**
	 * Whether `totalUnread` came from a successful account-unread read. Until one
	 * lands, `totalUnread` is the initial 0 and an absence of knowledge, not a
	 * receipt: the workspace drawer's Bridge badge must say "loading" rather than
	 * paint "no unread" (Bridge UI brief §2, unknown ≠ zero). A failed refresh
	 * keeps whatever was last known, like the badge itself does.
	 */
	unreadKnown: boolean;
	/**
	 * The FIRST account-unread read failed and none has succeeded since. Without
	 * it a failed first read left `unreadKnown` false forever, and the drawer's
	 * Bridge button kept announcing "loading" for a read that was never coming
	 * (PR #212 review R1-2 / QA Q1-2). The badge reads this as "unavailable" —
	 * still never a zero. Cleared by the next successful read; once a count is
	 * known a later failure keeps that count, so this stays false.
	 */
	unreadFailed: boolean;
	/**
	 * How many account-unread reads have PUBLISHED on this store (0 after a
	 * reset). Only `refreshUnread`'s success path increments it, so an observer
	 * can tell that read's publication apart from a conversation patch, which
	 * also replaces `organizations` and `totalUnread` while `unreadKnown` is
	 * already true (review R1-m1). The background task's scope
	 * (`team-bridge/badge.ts` `backgroundUnreadScope`) is that observer.
	 */
	unreadReads: number;
	/**
	 * What the composer may attach, from `status.attachments`. `null` until a
	 * status read says otherwise, and whenever the hub has no attachment store:
	 * no attach affordance is offered (`attachmentLimits`).
	 */
	attachments: AttachmentLimits | null;
	orgs: Record<string, OrgData>;
	threads: Record<string, ThreadData>;
	/** Reply threads, keyed by `replyThreadKey`. */
	replyThreads: Record<string, ReplyThreadData>;
	/** The consent the status read served (eligible callers only). Held for the default-on notice's text. */
	servedConsent: StatusConsent | null;
	/** The notice to show for the selected organization, or null. Never set before dismissal was read. */
	defaultOnNotice: DefaultOnNotice | null;
	/** A failed Turn off. The notice stays so the person can retry. */
	defaultOnNoticeError: HubError | null;
	defaultOnNoticeBusy: boolean;
	/**
	 * REACTIONS (spec §4.8). The optimistic rows of a message whose toggle is
	 * in flight, keyed by `reactionKey`. Kept BESIDE the held messages rather
	 * than written into them, which is the poll-vs-pending guard: a 20 s poll
	 * that lands mid-write replaces the held message freely, the pills keep
	 * showing these rows until the write settles, and the poll's answer is
	 * what shows afterwards (spec step 5: "applies after the write settles").
	 * One entry per message is also the in-flight guard (the desktop rule).
	 */
	reactionPending: Record<string, { rows: Reaction[]; emoji: string }>;
	/** Messages whose last toggle was refused: they draw the error line. */
	reactionFailed: Record<string, true>;
	/**
	 * The hub answered a reaction write with an UNCODED 404/405: it does not
	 * serve the route (spec gap G4 — there is no capability flag to ask up
	 * front). Every reaction control hides for this session, with no error, as
	 * core does for typing on an outdated hub. Reset with the account.
	 */
	reactionsUnserved: boolean;
}

/**
 * Device-local, per-account-and-organization record that the default-on notice
 * was dismissed (or its Turn off succeeded). It never expires: the product rule
 * is "never returns once dismissed". Injected so the store stays Node-testable.
 */
export interface NoticeDismissals {
	has(accountId: string, tenantId: string): Promise<boolean>;
	set(accountId: string, tenantId: string): Promise<void>;
}

const emptyOrg = (): OrgData => ({
	conversations: [],
	conversationsState: "idle",
	conversationsError: null,
	people: [],
	peopleIncomplete: false,
	peopleState: "idle",
	peopleError: null,
	refreshedAt: null,
	peopleRefreshedAt: null,
	conversationsCatchingUp: false,
	peopleCatchingUp: false,
});

const emptyThread = (): ThreadData => ({
	messages: [],
	state: "idle",
	error: null,
	hasMore: false,
	loadingOlder: false,
	olderError: null,
});

export const initialTeamBridgeState = (): TeamBridgeState => ({
	gate: "checking",
	gateError: null,
	selfAccountId: null,
	organizations: [],
	selectedTenantId: null,
	totalUnread: 0,
	unreadKnown: false,
	unreadFailed: false,
	unreadReads: 0,
	attachments: null,
	orgs: {},
	threads: {},
	replyThreads: {},
	servedConsent: null,
	defaultOnNotice: null,
	defaultOnNoticeError: null,
	defaultOnNoticeBusy: false,
	reactionPending: {},
	reactionFailed: {},
	reactionsUnserved: false,
});

/** One message, wherever it is held (`reactionPending`, `reactionFailed`). */
export interface ReactionTarget {
	tenantId: string;
	conversationId: string;
	messageId: string;
}
export const reactionKey = (target: ReactionTarget): string =>
	`${target.tenantId}/${target.conversationId}/${target.messageId}`;

/** What one tap did, so the screen can pick the haptic and announcement. */
export type ReactionOutcome =
	| "added"
	| "removed"
	| "failed"
	/** A toggle for this message was already in flight (double tap). */
	| "ignored"
	/** The hub does not serve reactions; the controls are now hidden. */
	| "unserved";

/** An uncoded 404/405: the ROUTE is missing, not the message (a missing
 *  message comes back coded, e.g. `message_not_found`). */
const routeMissing = (error: unknown): boolean =>
	isHubError(error) &&
	(error.status === 404 || error.status === 405) &&
	!error.code;

const emptyReplyThread = (): ReplyThreadData => ({
	root: null,
	replies: [],
	state: "idle",
	error: null,
	moreAfterSeq: null,
});

/**
 * How many reply pages one load follows. The hub pages at 50 (max 100); ten
 * pages is 500 replies, beyond any thread observed on the desktop. A thread
 * still `has_more` after that shows what it holds rather than looping on a
 * hub that never stops paging, and keeps the cursor (`moreAfterSeq`) so the
 * reader can ask for the next 500 (`loadMoreReplies`).
 */
export const REPLY_PAGE_LIMIT = 10;

/** A history page this size; the hub clamps it anyway. */
export const PAGE_SIZE = 50;

/** Key each history by tenant as well as conversation identity. */
export const threadKey = (tenantId: string, conversationId: string): string =>
	`${tenantId}/${conversationId}`;

/**
 * The silent retries a thread refresh gets when the hub gave NO answer
 * (`unreachable`) before the refresh warning is shown.
 *
 * The session stream's resume budget, deliberately (`resume-hold.ts`'s
 * `RESUME_GRACE_MS` and `reconnectDelay`'s 1 s → 2 s → 4 s curve): the first
 * request plus three retries at t≈0, 1, 3 and 7 s, so the reader sees the
 * warning after the same ~8 s on both surfaces, and only if every attempt
 * failed. The thread's 20 s poll is longer than the whole budget, so a retry
 * run never overlaps the next poll (`once` dedupes it if it did).
 */
export const THREAD_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];

/*
 * RATE LIMITS (TestFlight 1157: the drawer showed "Radient refused the request
 * (HTTP 429)." and "The people directory could not load.").
 *
 * The hub (agent-server `internal/middlewares/bridge_limiter.go`) keys every
 * Team Bridge read bucket on the signed-in ACCOUNT, not the device: the list
 * and thread reads share `conversation-reads` (120/min) and the directory
 * shares `reads` (120/min) with the endpoint-avatar, settings and legacy
 * inbox reads. The phone, the desktop app (an 8 s history poll per open
 * channel, a 30 s account list poll) and every agent's bridge tool call
 * (named-recipient and DM resolution each read the directory, uncached) all
 * draw from those same two buckets. So the phone cannot assume it is the only
 * caller: it must ask less, and when refused it must wait for the hub's
 * `Retry-After` rather than re-ask on the next drawer open.
 *
 * Before this, every drawer open (and every docked-pane mount) re-read every
 * conversation page AND the directory, a 429 became a sticky red banner with
 * the raw HTTP sentence, and nothing retried until the reader pressed Retry,
 * which re-asked at once, inside the same window.
 */

/**
 * A drawer re-open inside this window reuses the held conversation list. 30 s
 * is the desktop app's notification poll (`TEAM_BRIDGE_NOTIFY_POLL_MS`,
 * local-operator-ui `src/shared/team-bridge-poll.ts`): the list is no staler
 * than the desktop's own. An unread-count change seen by `refreshUnread` (the
 * push and badge path) drops the reuse for that org, so a new message is
 * re-read on the next open rather than up to 30 s later. Explicit refreshes
 * (pull, Retry, after a send) bypass it.
 */
export const CONVERSATIONS_FRESH_MS = 30_000;

/**
 * How long a directory answer is reused. People and their agents change on
 * the scale of org administration, not seconds; five minutes matches the
 * desktop client's status cache (`STATUS_CACHE_TTL_S = 300`). Pull and Retry
 * bypass it.
 */
export const DIRECTORY_TTL_MS = 5 * 60_000;

/**
 * The wait when a 429 carries no usable `Retry-After`. The hub always sends
 * one (whole seconds, at most the 60 s window it enforces); this covers an
 * edge or proxy refusal that strips it.
 */
export const RATE_LIMIT_FALLBACK_MS = 15_000;

/**
 * The longest any one wait grows to under consecutive refusals (each strike
 * waits max(Retry-After, 2 × previous wait)). Above the hub's own 60 s window,
 * so a hub that keeps refusing is asked at most every five minutes, and low
 * enough that a recovered hub heals within one sitting.
 */
export const RATE_LIMIT_MAX_MS = 5 * 60_000;

const isRateLimited = (error: unknown): error is HubError =>
	isHubError(error) && error.kind === "rate_limited";

/*
 * TRANSIENT FAILURES (TestFlight 1157, 2026-11-17: the red "The people
 * directory could not load." sat ABOVE a people list that was already on
 * screen). #297 made a 429 wait silently; every other failure still turned
 * held rows into a red error with Retry, although the next read would most
 * likely succeed and the rows were still the best thing to show.
 *
 * Transient is anything that says "ask again later" rather than "the answer is
 * no": a 429, a 503 or `messaging_unavailable` (`unavailable` with a status), a timeout or
 * dead network (`unreachable`, status null), and any other 5xx (`server` with
 * a 5xx status: 500, a Cloudflare 502/504/52x edge page). A `server` kind with
 * a non-5xx status is an unmapped refusal (418, 405) and is NOT transient.
 * Definitive answers (401/403 through `gateFailure`, 404, 4xx `invalid`,
 * `malformed`) keep their existing handling.
 *
 * With rows held, a transient failure keeps them and the backoff below retries
 * silently; "Catching up…" appears from the second consecutive failure. With
 * nothing held, a non-429 transient failure gets ONE silent retry before the
 * red error with Retry: a cold list has nothing better to show once it keeps
 * failing. A cold 429 keeps #297's skeleton + "Catching up…" (design D2).
 */
const isTransient = (error: unknown): error is HubError => {
	if (!isHubError(error)) return false;
	switch (error.kind) {
		case "rate_limited":
		case "unreachable":
			return true;
		/* Only the hub's or edge's answer. This store raises its own statusless
		 * `unavailable` for the pagination ceiling ("Too many conversation
		 * pages"), which the same read will hit again: definitive. */
		case "unavailable":
			return error.status !== null;
		case "server":
			return error.status === null || error.status >= 500;
		default:
			return false;
	}
};

export function createTeamBridgeStore(deps: {
	hub: () => HubClient | null;
	accessToken: () => Promise<string | null>;
	/** Persisted org choice. Injected so tests and the web build stay in memory. */
	rememberOrg?: (tenantId: string) => void;
	recallOrg?: () => string | null;
	/** Absent (tests, web fixtures without storage) means the notice never shows: it cannot promise "once". */
	dismissals?: NoticeDismissals;
	now?: () => number;
}) {
	const store = createStore<TeamBridgeState>(() => initialTeamBridgeState());

	/** Apply a change to one conversation row wherever it is held. */
	function patchConversation(
		tenantId: string,
		conversationId: string,
		change: (conversation: Conversation) => Conversation,
	): void {
		store.setState((s) => {
			const org = s.orgs[tenantId];
			if (!org) return s;
			return {
				orgs: {
					...s.orgs,
					[tenantId]: {
						...org,
						conversations: org.conversations.map((c) =>
							c.id === conversationId ? change(c) : c,
						),
					},
				},
			};
		});
	}

	/** One delta drives all badges; muted rows do not contribute to account totals. */
	function reconcileConversation(
		tenantId: string,
		conversationId: string,
		change: (row: Conversation) => Conversation,
	): void {
		const previous = store
			.getState()
			.orgs[tenantId]?.conversations.find((c) => c.id === conversationId);
		if (!previous) return;
		const next = change(previous);
		const delta = next.unread_count - previous.unread_count;
		const accountDelta =
			(next.muted ? 0 : next.unread_count) -
			(previous.muted ? 0 : previous.unread_count);
		patchConversation(tenantId, conversationId, () => next);
		store.setState((state) => ({
			totalUnread: Math.max(0, state.totalUnread + accountDelta),
			organizations: state.organizations.map((org) =>
				org.tenantId === tenantId
					? { ...org, unread: Math.max(0, org.unread + delta) }
					: org,
			),
		}));
	}

	function patchOrg(tenantId: string, change: Partial<OrgData>): void {
		store.setState((s) => ({
			orgs: {
				...s.orgs,
				[tenantId]: { ...(s.orgs[tenantId] ?? emptyOrg()), ...change },
			},
		}));
	}

	function patchReplyThread(
		key: string,
		change: Partial<ReplyThreadData>,
	): void {
		store.setState((s) => ({
			replyThreads: {
				...s.replyThreads,
				[key]: { ...(s.replyThreads[key] ?? emptyReplyThread()), ...change },
			},
		}));
	}

	/**
	 * Put the hub's newest copy of a root wherever it is held: the open
	 * conversation's timeline (so its row's count and badge move) and the reply
	 * thread itself. `change` maps the HELD root; it never invents one.
	 */
	function patchRoot(
		target: ReplyThreadTarget,
		change: (root: Message) => Message,
	): void {
		store.setState((s) => {
			const conversationKey = threadKey(target.tenantId, target.conversationId);
			const held = s.threads[conversationKey];
			const heldRoot = held?.messages.find((m) => m.id === target.rootId);
			const replyKey = replyThreadKey(target);
			const reply = s.replyThreads[replyKey];
			const nextThreads =
				held && heldRoot
					? withRoot(held.messages, change(heldRoot), sameValue)
					: held?.messages;
			const nextReplyRoot = reply?.root ? change(reply.root) : reply?.root;
			const threadsChanged = !!held && nextThreads !== held.messages;
			const replyChanged = !!reply && nextReplyRoot !== reply.root;
			if (!threadsChanged && !replyChanged) return s;
			return {
				...(threadsChanged && held && nextThreads
					? {
							threads: {
								...s.threads,
								[conversationKey]: { ...held, messages: nextThreads },
							},
						}
					: {}),
				...(replyChanged && reply
					? {
							replyThreads: {
								...s.replyThreads,
								[replyKey]: { ...reply, root: nextReplyRoot ?? null },
							},
						}
					: {}),
			};
		});
	}

	/**
	 * Follow up to `REPLY_PAGE_LIMIT` reply pages from `start` (undefined = the
	 * first reply) and merge them into the held thread. Shared by the refresh
	 * and the continuation so both apply the same identity check, root rule
	 * and cursor bookkeeping.
	 */
	async function readReplyPages(
		target: ReplyThreadTarget,
		start: number | undefined,
		owned: () => boolean,
	): Promise<void> {
		const client = deps.hub();
		if (!client) return;
		const key = replyThreadKey(target);
		const readRevision = reactionRevision;
		if (store.getState().replyThreads[key]?.state !== "ready")
			patchReplyThread(key, { state: "loading", error: null });
		try {
			let root: Message | null = null;
			let replies: Message[] = [];
			let afterSeq = start;
			let more: number | null = null;
			for (let page = 0; page < REPLY_PAGE_LIMIT; page += 1) {
				const answer = await client.listReplies(
					target.tenantId,
					target.conversationId,
					target.rootId,
					{ afterSeq, limit: PAGE_SIZE },
				);
				if (!owned()) return;
				if (!isReplyThreadPageFor(answer, target))
					throw new HubError({
						kind: "malformed",
						message: "Radient returned a different thread.",
					});
				root = answer.root;
				replies = mergeMessages(replies, answer.replies);
				const next = answer.next_after_seq;
				more = null;
				// Inclusive cursor: it must move past what we hold, or stop.
				if (
					!answer.has_more ||
					next === undefined ||
					(afterSeq !== undefined && next <= afterSeq)
				)
					break;
				afterSeq = next;
				// Only a cursor that is still outstanding when the cap ends the
				// loop survives as `more`; a normal end resets it above.
				more = next;
			}
			if (!root) return;
			const held = store.getState().replyThreads[key];
			const merged = mergeMessages(
				held?.replies ?? [],
				protectReactions(
					target.tenantId,
					target.conversationId,
					replies,
					readRevision,
				),
			);
			/* A refresh re-reads from the top, so on a capped thread its own cursor
			 * would point back at reply ~500 even when the reader already continued
			 * further. Resume from the furthest of the two: the newest reply held
			 * (re-read once, deduplicated by id) or the served cursor. */
			const newestHeld = merged.reduce(
				(max, m) => (m.seq > max ? m.seq : max),
				-1,
			);
			// A load that ended on the hub's own "no more" leaves nothing outstanding.
			const moreAfterSeq = more === null ? null : Math.max(more, newestHeld);
			const servedRoot =
				protectReactions(
					target.tenantId,
					target.conversationId,
					[root],
					readRevision,
				)[0] ?? root;
			const nextRoot = rootFromServedPage(held?.root, servedRoot);
			patchReplyThread(key, {
				root:
					held?.root && sameValue(held.root, nextRoot) ? held.root : nextRoot,
				replies: merged,
				state: "ready",
				error: null,
				moreAfterSeq,
			});
			patchRoot(target, (heldRoot) => {
				const next = rootFromServedPage(heldRoot, servedRoot);
				return sameValue(heldRoot, next) ? heldRoot : next;
			});
		} catch (error) {
			if (!owned()) return;
			if (gateFailure(error)) return;
			patchReplyThread(key, {
				state: "error",
				error: isHubError(error)
					? error
					: new HubError({
							kind: "unreachable",
							message: "Couldn't reach Radient.",
						}),
			});
		}
	}

	/**
	 * Apply `change` to one message in every place it is held: the timeline,
	 * and any reply thread of the same conversation (as its root or a reply).
	 * The same message can be on screen twice (the timeline stays mounted under
	 * the reply thread), and both copies must agree (spec §4.8 step 6).
	 */
	function patchMessage(
		target: ReactionTarget,
		change: (message: Message) => Message,
	): void {
		const map = (list: Message[]) => {
			let hit = false;
			const next = list.map((m) => {
				if (m.id !== target.messageId) return m;
				hit = true;
				return change(m);
			});
			return hit ? next : list;
		};
		store.setState((s) => {
			const key = threadKey(target.tenantId, target.conversationId);
			const held = s.threads[key];
			const messages = held ? map(held.messages) : null;
			const threads =
				held && messages && messages !== held.messages
					? { ...s.threads, [key]: { ...held, messages } }
					: s.threads;
			const prefix = `${key}/`;
			let replyThreads = s.replyThreads;
			for (const [replyKey, reply] of Object.entries(s.replyThreads)) {
				if (!replyKey.startsWith(prefix)) continue;
				const root =
					reply.root?.id === target.messageId ? change(reply.root) : reply.root;
				const replies = map(reply.replies);
				if (root === reply.root && replies === reply.replies) continue;
				replyThreads = {
					...replyThreads,
					[replyKey]: { ...reply, root, replies },
				};
			}
			return { threads, replyThreads };
		});
	}

	/** The reactions currently held for a message, from whichever copy has it. */
	function heldReactions(target: ReactionTarget): Reaction[] {
		const s = store.getState();
		const key = threadKey(target.tenantId, target.conversationId);
		const inTimeline = s.threads[key]?.messages.find(
			(m) => m.id === target.messageId,
		);
		if (inTimeline) return inTimeline.reactions ?? [];
		for (const [replyKey, reply] of Object.entries(s.replyThreads)) {
			if (!replyKey.startsWith(`${key}/`)) continue;
			const found =
				reply.root?.id === target.messageId
					? reply.root
					: reply.replies.find((m) => m.id === target.messageId);
			if (found) return found.reactions ?? [];
		}
		return [];
	}

	function patchThread(key: string, change: Partial<ThreadData>): void {
		store.setState((s) => ({
			threads: {
				...s.threads,
				[key]: { ...(s.threads[key] ?? emptyThread()), ...change },
			},
		}));
	}

	/*
	 * Single-flight per read. Pull-to-refresh, focus and a push tap can all ask
	 * for the same page within a second; one request answers all of them, and a
	 * stale answer can never overwrite a newer one.
	 */
	let generation = 0;
	// History has no server revision. A GET started before a confirmed write
	// must not undo it, including copies in reply roots and older pages. Only
	// reactions are protected: the rest of that history answer still merges.
	let reactionRevision = 0;
	const reactionSettled = new Map<string, number>();
	function protectReactions(
		tenantId: string,
		conversationId: string,
		messages: Message[],
		readRevision: number,
	): Message[] {
		return messages.map((message) => {
			const target = { tenantId, conversationId, messageId: message.id };
			const key = reactionKey(target);
			if (
				store.getState().reactionPending[key] ||
				(reactionSettled.get(key) ?? 0) > readRevision
			)
				return { ...message, reactions: heldReactions(target) };
			return message;
		});
	}
	// Reset is recoverable within a live provider; retirement is permanent even
	// if the same account logs in again. Retained closures cannot regain grants.
	let closed = false;
	const requireLive = () => {
		if (closed)
			throw new HubError({
				kind: "sign_in",
				message: "Account scope retired.",
			});
	};
	/*
	 * Per-read backoff after a transient failure (`isTransient`), keyed `conv:<tenant>`, `people:<tenant>` or
	 * `thread:<key>`. Kept outside the published state because nothing renders
	 * it; `strikes` is consecutive refusals, reset by any success. Invariant: no
	 * read in a keyed family is sent before its `until` (checked by
	 * `rate-limit.test.ts`).
	 */
	const backoff = new Map<
		string,
		{ until: number; waitMs: number; strikes: number; rateLimited: boolean }
	>();
	/** One pending silent retry per organization; replaced, never stacked. */
	const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const clock = () => (deps.now ?? Date.now)();
	const backedOff = (key: string, at: number) =>
		(backoff.get(key)?.until ?? 0) > at;
	/* A forced read (Retry, pull) still honours a 429's Retry-After: re-asking
	 * inside it only earns another refusal from the shared account bucket. Any
	 * other transient wait is this client's own guess, and the reader pressing
	 * Retry on a red error must actually re-read. */
	const blocked = (key: string, at: number, force: boolean) =>
		backedOff(key, at) && (!force || backoff.get(key)?.rateLimited === true);
	/** Record one refusal; returns the consecutive-strike count. */
	function noteTransient(key: string, error: HubError, at: number): number {
		/* Only success deletes a thread's record, and a thread the reader left
		 * never succeeds again: without this prune its record lives for the whole
		 * session, and a 429 on that thread hours later would start from a doubled
		 * wait and a second strike. A record whose wait ended more than one cap
		 * ago describes a refusal the hub has long forgotten. (Org records are
		 * settled by every org load, so they need no prune.) */
		for (const [other, record] of backoff) {
			if (other.startsWith("thread:") && at - record.until > RATE_LIMIT_MAX_MS)
				backoff.delete(other);
		}
		const prev = backoff.get(key);
		const strikes = (prev?.strikes ?? 0) + 1;
		const served = transientDelay(error.retryAfterMs, RATE_LIMIT_FALLBACK_MS);
		const waitMs = Math.min(
			prev ? Math.max(served, prev.waitMs * 2) : served,
			RATE_LIMIT_MAX_MS,
		);
		backoff.set(key, {
			until: at + waitMs,
			waitMs,
			strikes,
			rateLimited: error.kind === "rate_limited",
		});
		return strikes;
	}
	function clearBackoff() {
		backoff.clear();
		reactionSettled.clear();
		for (const timer of retryTimers.values()) clearTimeout(timer);
		retryTimers.clear();
	}
	/**
	 * Schedule ONE silent re-read of an org for when its earliest backoff ends.
	 * The retry is what makes a 429 invisible: the reader never has to press
	 * anything, and a re-open meanwhile sends nothing (it is backed off too).
	 */
	function scheduleOrgRetry(tenantId: string) {
		const at = clock();
		/* A record whose wait already ENDED is a half nobody has re-read since:
		 * every org load either deletes its half's record (success, fresh, non-429
		 * error) or renews it (another 429). One survives only when a load SKIPPED
		 * the half because it was still backed off when the load began, and the
		 * wait ran out before that load finished, typically the retry timer firing
		 * into a pull already in flight, which `once` merges away (review M1). It
		 * is due now: clamp it to `at`, or the cold list stays a skeleton until
		 * the reader pulls again. */
		const ends = [`conv:${tenantId}`, `people:${tenantId}`]
			.map((key) => backoff.get(key)?.until)
			.filter((until): until is number => until !== undefined)
			.map((until) => Math.max(until, at));
		if (!ends.length) return;
		const existing = retryTimers.get(tenantId);
		if (existing) clearTimeout(existing);
		const epoch = generation;
		retryTimers.set(
			tenantId,
			setTimeout(
				() => {
					retryTimers.delete(tenantId);
					if (closed || epoch !== generation) return;
					void actions.loadOrganization(tenantId, {
						silent: true,
						ifStale: true,
						retryDue: true,
					});
				},
				Math.min(...ends) - at,
			),
		);
	}

	const inFlight = new Map<string, Promise<void>>();
	function once(
		key: string,
		run: (owned: () => boolean) => Promise<void>,
	): Promise<void> {
		if (closed) return Promise.resolve();
		const existing = inFlight.get(key);
		if (existing) return existing;
		const epoch = generation;
		const next = run(() => !closed && epoch === generation).finally(() => {
			// A retired request must not remove its successor after account change.
			if (inFlight.get(key) === next) inFlight.delete(key);
		});
		inFlight.set(key, next);
		return next;
	}

	/** Entitlement/auth refusals retire every outstanding publication, not just this screen. */
	function gateFailure(error: unknown): boolean {
		if (closed || !isHubError(error)) return false;
		if (error.kind === "sign_in") {
			actions.reset();
			store.setState({ gate: "signed_out", gateError: error });
			return true;
		}
		if (error.kind === "plan") {
			generation += 1;
			inFlight.clear();
			store.setState({
				gate: "plan_required",
				gateError: error,
				// This boundary retires ALL writes, not just the request that
				// discovered the refusal. Old continuations cannot settle new ones.
				reactionPending: {},
				reactionFailed: {},
				defaultOnNoticeBusy: false,
				defaultOnNoticeError: null,
			});
			return true;
		}
		return false;
	}

	const actions = {
		/**
		 * Read the hub's status and decide the gate. The status read is the ONE
		 * input of the eligibility ladder (desktop `teamBridgeEligibility`); a
		 * transport failure keeps the previous gate when there was one (the reader
		 * keeps what they had), and is otherwise the `unavailable` gate with a retry.
		 */
		checkStatus(): Promise<void> {
			return once("status", async (owned) => {
				const client = deps.hub();
				let token: string | null;
				try {
					token = await deps.accessToken();
				} catch (error) {
					if (!owned()) return;
					if (gateFailure(error)) return;
					if (owned())
						store.setState({
							gate:
								store.getState().gate === "checking"
									? "unavailable"
									: store.getState().gate,
							gateError: isHubError(error)
								? error
								: new HubError({
										kind: "unreachable",
										message:
											"Radient could not refresh the session. Please retry.",
									}),
						});
					return;
				}
				if (!owned()) return;
				if (!client || !token) {
					actions.reset();
					store.setState({ gate: "signed_out" });
					return;
				}
				let read: StatusRead;
				try {
					read = { kind: "ok", status: await client.status() };
					if (!owned()) return;
				} catch (error) {
					if (!owned()) return;
					if (gateFailure(error)) return;
					const hubError = isHubError(error) ? error : null;
					if (hubError?.kind === "sign_in") read = { kind: "signed_out" };
					else if (
						hubError?.kind === "unavailable" ||
						store.getState().gate === "checking"
					) {
						store.setState({ gate: "unavailable", gateError: hubError });
						return;
					} else {
						/* A refresh that failed after the surface was open keeps it open. */
						store.setState({ gateError: hubError });
						return;
					}
				}
				const gate = eligibility(read);
				if (read.kind !== "ok" || gate !== null) {
					if (gate === "signed_out") actions.reset();
					store.setState({
						gateError: null,
						...(gate === "signed_out" ? initialTeamBridgeState() : {}),
						gate: gate ?? "unavailable",
					});
					return;
				}
				const previous = store.getState().organizations;
				const unread = new Map(previous.map((o) => [o.tenantId, o.unread]));
				const organizations = organizationsFrom(read.status.tenants, unread);
				const current = store.getState().selectedTenantId;
				const selected = preferredOrganization(
					organizations,
					current ?? deps.recallOrg?.() ?? null,
				);
				store.setState({
					gate: "open",
					gateError: null,
					selfAccountId: accountIdFromToken(token),
					organizations,
					selectedTenantId: selected?.tenantId ?? null,
					attachments: attachmentLimits(read.status.attachments),
					servedConsent: read.status.consent ?? null,
				});
			});
		},

		/**
		 * Decide whether the one-time default-on notice shows for this organization.
		 *
		 * READ-ONLY and best effort: it only ever reads (`GET /settings`), so mounting
		 * the tab fires nothing at the hub that changes state, and enrolment stays
		 * the desktop runtime's job. Any failure (storage, hub, parse) shows NO
		 * notice: the notice is additive, and a screen that cannot prove "not
		 * dismissed" or "enrolled by default" must stay quiet rather than guess.
		 */
		loadDefaultOnNotice(tenantId: string): Promise<void> {
			return once(`notice:${tenantId}`, async (owned) => {
				const client = deps.hub();
				const state = store.getState();
				const accountId = state.selfAccountId;
				const organization = state.organizations.find(
					(o) => o.tenantId === tenantId,
				);
				if (!client || !deps.dismissals || !accountId || !organization) return;
				try {
					if (await deps.dismissals.has(accountId, tenantId)) return;
					const settings = await client.settings(tenantId);
					if (!owned()) return;
					// Re-read: a dismissal or Turn off can land while the GET is in flight.
					if (await deps.dismissals.has(accountId, tenantId)) return;
					if (!owned()) return;
					const notice = defaultOnNoticeFor({
						tenantId,
						eligible: organization.eligible,
						settings,
						served: store.getState().servedConsent,
					});
					if (notice && store.getState().selectedTenantId === tenantId) {
						store.setState({
							defaultOnNotice: notice,
							defaultOnNoticeBusy: false,
							defaultOnNoticeError: null,
						});
					}
				} catch {
					// Status owns the tab gate; this additive read must never close it.
				}
			});
		},

		/** Dismiss for good on this device. The notice hides even if the write fails (it returns next launch then). */
		async dismissDefaultOnNotice(): Promise<void> {
			if (closed) return;
			const notice = store.getState().defaultOnNotice;
			const accountId = store.getState().selfAccountId;
			if (!notice) return;
			store.setState({ defaultOnNotice: null, defaultOnNoticeError: null });
			if (!accountId) return;
			try {
				await deps.dismissals?.set(accountId, notice.tenantId);
			} catch {
				/* Hidden for this session; storage failure must not trap the person behind a banner. */
			}
		},

		/**
		 * "Turn off": `PUT /settings {state: "disabled", tenant_id}` alone. The notice
		 * is dismissed only AFTER the hub confirmed; a refusal keeps it and records
		 * the error, because a banner that vanished while the setting stayed on
		 * would be a false "off".
		 */
		async turnOffDefaultOn(): Promise<void> {
			requireLive();
			const notice = store.getState().defaultOnNotice;
			const accountId = store.getState().selfAccountId;
			const client = deps.hub();
			if (!notice || !client || store.getState().defaultOnNoticeBusy) return;
			store.setState({ defaultOnNoticeBusy: true, defaultOnNoticeError: null });
			const epoch = generation;
			try {
				await client.turnOff(notice.tenantId);
			} catch (error) {
				if (epoch !== generation || store.getState().defaultOnNotice !== notice)
					return;
				const hubError = isHubError(error)
					? error
					: new HubError({
							kind: "unreachable",
							message: "Radient could not be reached. Try again.",
						});
				store.setState({
					defaultOnNoticeBusy: false,
					defaultOnNoticeError: hubError,
				});
				return;
			}
			if (closed || epoch !== generation) return;
			// A PUT belongs to the account/org captured before dispatch, not whichever
			// notice happens to be visible when it completes after an org switch.
			if (store.getState().defaultOnNotice === notice) {
				store.setState({
					defaultOnNotice: null,
					defaultOnNoticeBusy: false,
					defaultOnNoticeError: null,
				});
			}
			if (accountId) {
				try {
					await deps.dismissals?.set(accountId, notice.tenantId);
				} catch {
					/* A persistence failure must not undo a confirmed opt-out. */
				}
			}
		},

		selectOrganization(tenantId: string) {
			if (closed) return;
			if (!store.getState().organizations.some((o) => o.tenantId === tenantId))
				return;
			if (store.getState().selectedTenantId !== tenantId) {
				store.setState({
					defaultOnNotice: null,
					defaultOnNoticeBusy: false,
					defaultOnNoticeError: null,
				});
			}
			store.setState({ selectedTenantId: tenantId });
			deps.rememberOrg?.(tenantId);
		},

		/** The account-wide badge and the switcher's per-org counts. Best effort. */
		refreshUnread(): Promise<void> {
			return once("unread", async (owned) => {
				const client = deps.hub();
				if (!client) return;
				try {
					const answer = await client.accountUnread();
					if (!owned()) return;
					const byTenant = new Map(
						(answer.organizations ?? []).map((o) => [o.tenant_id, o.unread]),
					);
					store.setState((s) => {
						/* A changed count means the held list is behind (a new message,
						 * maybe a new conversation): drop that org's list freshness so
						 * the next drawer open re-reads it instead of reusing it for up to
						 * `CONVERSATIONS_FRESH_MS` under a badge that disagrees with the
						 * rows (review m2). Unchanged counts keep the reuse. */
						let orgs = s.orgs;
						for (const o of s.organizations) {
							const next = byTenant.get(o.tenantId);
							const held = orgs[o.tenantId];
							if (next === undefined || next === o.unread) continue;
							if (!held || held.refreshedAt === null) continue;
							orgs = { ...orgs, [o.tenantId]: { ...held, refreshedAt: null } };
						}
						return {
							totalUnread: answer.total,
							unreadKnown: true,
							unreadFailed: false,
							unreadReads: s.unreadReads + 1,
							orgs,
							organizations: s.organizations.map((o) => ({
								...o,
								unread: byTenant.get(o.tenantId) ?? o.unread,
							})),
						};
					});
				} catch (error) {
					if (!owned()) return;
					// A gate failure (sign-in, plan) resets or re-gates the store, and
					// the gate then speaks for the badge.
					if (gateFailure(error) || !owned()) return;
					/* The badge keeps its last value; the list's own read reports
					 * failures. With no last value there is nothing to keep: say the
					 * count is unavailable instead of loading forever. */
					if (!store.getState().unreadKnown)
						store.setState({ unreadFailed: true });
				}
			});
		},

		/**
		 * One organization's conversations (every page) and its people, in
		 * parallel. A failure in one half is that section's own error state; the
		 * other half still renders.
		 *
		 * Options (see the RATE LIMITS note above `CONVERSATIONS_FRESH_MS`):
		 * - `ifStale`: a drawer/list mount. Conversations read within
		 *   `CONVERSATIONS_FRESH_MS` are reused instead of re-read.
		 * - `force`: the reader asked (pull, Retry). Bypasses the freshness window
		 *   and the directory TTL, but never an active 429 backoff: re-asking
		 *   inside the hub's `Retry-After` only extends the refusal.
		 * Without `force`, the directory is reused for `DIRECTORY_TTL_MS`.
		 */
		loadOrganization(
			tenantId: string,
			options: {
				silent?: boolean;
				ifStale?: boolean;
				force?: boolean;
				retryDue?: boolean;
			} = {},
		): Promise<void> {
			return once(`org:${tenantId}`, async (owned) => {
				const client = deps.hub();
				if (!client) return;
				const held = store.getState().orgs[tenantId];
				const at = clock();
				const convKey = `conv:${tenantId}`;
				const peopleKey = `people:${tenantId}`;
				const convFresh =
					options.ifStale === true &&
					options.force !== true &&
					held?.conversationsState === "ready" &&
					held.refreshedAt !== null &&
					at - held.refreshedAt < CONVERSATIONS_FRESH_MS;
				const peopleFresh =
					options.force !== true &&
					held?.peopleState === "ready" &&
					held.peopleRefreshedAt !== null &&
					at - held.peopleRefreshedAt < DIRECTORY_TTL_MS;
				const force = options.force === true;
				/* Halves whose elapsed 429 record was just discarded in favour of
				 * fresh rows (review R2-1 / QA Q2). Deleting the record ends the
				 * episode, and the only writers that clear "Catching up…" are a read
				 * outcome, so without this the heading stays latched with no read and
				 * no timer left to end it. Invariant: `CatchingUp` is true only while
				 * that half's backoff record exists (rate-limit.test.ts, "clears
				 * Catching up when an expired 429 yields to fresh rows"). Clearing
				 * sends nothing, so no request goes out inside a Retry-After.
				 * Declared before `shouldRead`, which writes it (review R3-2). */
				const settled = new Set<string>();
				const shouldRead = (key: string, fresh: boolean) => {
					const refusal = backoff.get(key);
					if (blocked(key, at, force)) return false;
					// The timer owns only refused halves, not an ordinary TTL refresh.
					if (options.retryDue && !refusal) return false;
					if (!fresh) return true;
					// A transient failure over held rows still needs a success to
					// clear its status. Keep #297's fresh-row 429 reuse instead.
					if (refusal && !refusal.rateLimited) return true;
					backoff.delete(key);
					if (refusal) settled.add(key);
					return false;
				};
				const readConversations = shouldRead(convKey, convFresh);
				const readPeople = shouldRead(peopleKey, peopleFresh);
				if (settled.size) {
					patchOrg(tenantId, {
						...(settled.has(convKey) ? { conversationsCatchingUp: false } : {}),
						...(settled.has(peopleKey) ? { peopleCatchingUp: false } : {}),
					});
				}
				if (!readConversations && !readPeople) {
					scheduleOrgRetry(tenantId);
					return;
				}
				const silent =
					options.silent === true && held?.conversationsState === "ready";
				if (!silent) {
					patchOrg(tenantId, {
						...(readConversations
							? { conversationsState: "loading", conversationsError: null }
							: {}),
						...(!readPeople || held?.peopleState === "ready"
							? {}
							: { peopleState: "loading", peopleError: null }),
					});
				}
				const conversations = (async () => {
					if (!readConversations) return;
					try {
						const rows: Conversation[] = [];
						let cursor: string | undefined;
						/* Never publish a partial walk as a complete list: the UI has no pagination action. */
						for (let page = 0; page < 10; page += 1) {
							const answer = await client.listConversations(tenantId, {
								cursor,
							});
							if (!owned()) return;
							rows.push(...answer.conversations);
							if (!answer.has_more) break;
							if (!answer.next_cursor)
								throw new HubError({
									kind: "malformed",
									message: "Conversation page is missing its next cursor.",
								});
							if (page === 9)
								throw new HubError({
									kind: "unavailable",
									message: "Too many conversation pages. Please retry later.",
								});
							cursor = answer.next_cursor;
						}
						patchOrg(tenantId, {
							conversations: rows.map((row) => {
								const current = store
									.getState()
									.orgs[tenantId]?.conversations.find(
										(held) => held.id === row.id,
									);
								// A list snapshot may predate a receipt accepted while it was loading.
								return current && current.last_read_seq > row.last_read_seq
									? {
											...row,
											last_read_seq: current.last_read_seq,
											unread_count: current.unread_count,
										}
									: row;
							}),
							conversationsState: "ready",
							conversationsError: null,
							conversationsCatchingUp: false,
							refreshedAt: clock(),
						});
						backoff.delete(convKey);
					} catch (error) {
						if (!owned()) return;
						if (gateFailure(error)) return;
						if (isTransient(error)) {
							/* Wait it out: rows held stay "ready" with no banner; with none
							 * the skeleton stays up. The scheduled retry is the recovery. */
							const strikes = noteTransient(convKey, error, clock());
							const warm =
								held?.conversationsState === "ready" ||
								(held?.conversations.length ?? 0) > 0;
							if (warm || isRateLimited(error) || strikes < 2) {
								patchOrg(tenantId, {
									conversationsState: warm ? "ready" : "loading",
									conversationsError: null,
									conversationsCatchingUp: strikes > 1,
								});
								return;
							}
							/* Cold and still failing: the red error with Retry. The record
							 * stays, so the scheduled silent retry keeps trying too. */
							patchOrg(tenantId, {
								conversationsState: "error",
								conversationsError: error,
								conversationsCatchingUp: false,
							});
							return;
						}
						const hubError = isHubError(error) ? error : null;
						/* A different failure ends the rate-limit episode: the error
						 * state speaks now, and "Catching up…" over a red error and its
						 * Retry button would contradict it (review m1). The record goes
						 * too, so a later 429 is a first, silent strike. */
						backoff.delete(convKey);

						/* A silent refresh that fails keeps the rows on screen. */
						patchOrg(tenantId, {
							conversationsState: "error",
							conversationsError: hubError,
							conversationsCatchingUp: false,
						});
					}
				})();
				const people = (async () => {
					if (!readPeople) return;
					try {
						const answer = await client.directory(tenantId);
						if (!owned()) return;
						patchOrg(tenantId, {
							people: answer.members,
							peopleIncomplete: answer.unavailable_count > 0,
							peopleState: "ready",
							peopleError: null,
							peopleCatchingUp: false,
							peopleRefreshedAt: clock(),
						});
						backoff.delete(peopleKey);
					} catch (error) {
						if (!owned()) return;
						if (gateFailure(error)) return;
						if (isTransient(error)) {
							const strikes = noteTransient(peopleKey, error, clock());
							const warm =
								held?.peopleState === "ready" || (held?.people.length ?? 0) > 0;
							if (warm || isRateLimited(error) || strikes < 2) {
								patchOrg(tenantId, {
									peopleState: warm ? "ready" : "loading",
									peopleError: null,
									peopleCatchingUp: strikes > 1,
								});
								return;
							}
							patchOrg(tenantId, {
								peopleState: "error",
								peopleError: error,
								peopleCatchingUp: false,
							});
							return;
						}
						// As for conversations above: a definitive failure ends the episode.
						backoff.delete(peopleKey);
						patchOrg(tenantId, {
							peopleState: "error",
							peopleError: isHubError(error) ? error : null,
							peopleCatchingUp: false,
						});
					}
				})();
				await Promise.all([conversations, people]);
				if (owned()) scheduleOrgRetry(tenantId);
			});
		},

		/**
		 * The newest page of one thread (open, pull-to-refresh, a push tap). It
		 * MERGES into what is held, so a refresh never drops older pages the
		 * reader already scrolled to.
		 */
		loadThread(tenantId: string, conversationId: string): Promise<void> {
			const key = threadKey(tenantId, conversationId);
			return once(`thread:${key}`, async (owned) => {
				const client = deps.hub();
				if (!client) return;
				// The screen's 20 s poll must not re-ask inside the hub's Retry-After.
				if (backedOff(`thread:${key}`, clock())) return;
				const readRevision = reactionRevision;
				const held = store.getState().threads[key];
				if (held?.state !== "ready")
					patchThread(key, { state: "loading", error: null });
				for (let attempt = 0; ; attempt += 1) {
					try {
						const page = await client.listMessages(tenantId, conversationId, {
							limit: PAGE_SIZE,
						});
						if (!owned()) return;
						backoff.delete(`thread:${key}`);
						let incoming = page.messages;
						const heldTail = held?.messages.at(-1)?.seq;
						let oldestIncoming = incoming.reduce(
							(min, message) => Math.min(min, message.seq),
							Infinity,
						);
						let more = page.has_more;
						// A tail refresh can jump over multiple pages. Bridge before publishing,
						// otherwise older pagination walks the held head and can never reach the hole.
						for (
							let bridge = 0;
							heldTail !== undefined &&
							oldestIncoming > heldTail &&
							Number.isFinite(oldestIncoming) &&
							more;
							bridge += 1
						) {
							if (bridge === 10)
								throw new HubError({
									kind: "unavailable",
									message:
										"More messages arrived than could be refreshed. Please retry.",
								});
							const previous = await client.listMessages(
								tenantId,
								conversationId,
								{ beforeSeq: oldestIncoming, limit: PAGE_SIZE },
							);
							if (!owned()) return;
							const nextOldest = previous.messages.reduce(
								(min, message) => Math.min(min, message.seq),
								Infinity,
							);
							if (nextOldest >= oldestIncoming)
								throw new HubError({
									kind: "malformed",
									message: "Message history did not advance.",
								});
							incoming = mergeMessages(incoming, previous.messages);
							oldestIncoming = nextOldest;
							more = previous.has_more;
						}
						if (
							heldTail !== undefined &&
							Number.isFinite(oldestIncoming) &&
							oldestIncoming > heldTail
						)
							throw new HubError({
								kind: "unavailable",
								message:
									"Message history could not be connected. Please retry.",
							});
						const current = store.getState().threads[key];
						const first = !current || current.messages.length === 0;
						/* `current`, not the `held` snapshot from before the GET: a thread
						 *  read that landed while this page was in flight moved the root's
						 *  cursor, and a page from before it must not move it back. */
						const messages = mergeMessages(
							current?.messages ?? [],
							protectHeldThreadCursors(
								current?.messages ?? [],
								protectReactions(
									tenantId,
									conversationId,
									incoming,
									readRevision,
								),
							),
						);
						/* An unchanged poll is not an update (Bridge thread flicker):
						 *  publishing it re-rendered the open thread, its memoised rows
						 *  and the viewport's admission recheck for nothing. `mergeMessages`
						 *  returns the held array itself when no message changed. */
						if (
							current &&
							messages === current.messages &&
							current.state === "ready" &&
							current.error === null &&
							// A first page also decides `hasMore` (below); skip only when
							// that answer is unchanged too (empty threads, QA r1 Q3).
							(!first || current.hasMore === (page.has_more === true))
						)
							return;
						patchThread(key, {
							messages,
							state: "ready",
							error: null,
							/* Only the FIRST page decides whether older history exists; a
							 *  refresh of the tail says nothing about the head. */
							...(first ? { hasMore: page.has_more === true } : {}),
						});
						return;
					} catch (error) {
						if (!owned()) return;
						if (gateFailure(error)) return;
						/* No answer at all is retried silently before it is shown: the
						 *  thread screen reloads the moment the app returns to the
						 *  foreground, which is exactly when the radio is still waking,
						 *  and one failed request there painted the refresh warning over
						 *  a thread the next attempt loaded (TestFlight 836). Refusals —
						 *  sign-in, plan, revoked, malformed — still surface at once. */
						const wait = THREAD_RETRY_DELAYS_MS[attempt];
						if (
							wait !== undefined &&
							isHubError(error) &&
							error.kind === "unreachable"
						) {
							await new Promise((resolve) => setTimeout(resolve, wait));
							if (!owned()) return;
							continue;
						}
						if (isRateLimited(error)) {
							/* A 429 is the shared account bucket, not this thread: keep what
							 * is held (or the skeleton) and let the next poll after the wait
							 * read it. Never the raw "HTTP 429" warning. */
							noteTransient(`thread:${key}`, error, clock());
							if (held?.state !== "ready")
								patchThread(key, { state: "loading", error: null });
							return;
						}
						patchThread(key, {
							state: "error",
							error: isHubError(error) ? error : null,
						});
						return;
					}
				}
			});
		},

		/** The page before the oldest held message (`before_seq` is exclusive). */
		loadOlder(tenantId: string, conversationId: string): Promise<void> {
			const key = threadKey(tenantId, conversationId);
			return once(`older:${key}`, async (owned) => {
				const client = deps.hub();
				const held = store.getState().threads[key];
				if (!client || !held?.hasMore || held.messages.length === 0) return;
				const oldest = held.messages[0];
				if (!oldest) return;
				const readRevision = reactionRevision;
				patchThread(key, { loadingOlder: true, olderError: null });
				try {
					const page = await client.listMessages(tenantId, conversationId, {
						beforeSeq: oldest.seq,
						limit: PAGE_SIZE,
					});
					if (!owned()) return;
					const current = store.getState().threads[key] ?? emptyThread();
					patchThread(key, {
						// An older page can restate a held root (an edit, a rollup) with
						// the cursor from before a read that landed meanwhile.
						messages: mergeMessages(
							current.messages,
							protectHeldThreadCursors(
								current.messages,
								protectReactions(
									tenantId,
									conversationId,
									page.messages,
									readRevision,
								),
							),
						),
						hasMore: page.has_more === true && page.messages.length > 0,
						loadingOlder: false,
					});
				} catch (error) {
					if (!owned()) return;
					if (gateFailure(error)) return;
					store.setState((s) => ({
						threads: {
							...s.threads,
							[key]: {
								...(s.threads[key] ?? emptyThread()),
								loadingOlder: false,
								olderError: isHubError(error) ? error : null,
							},
						},
					}));
				}
			});
		},

		/**
		 * Only the newest loaded page can prove all unseen messages were read.
		 * Keep the durable cursor server-owned so a failed receipt stays retryable.
		 */
		async markRead(tenantId: string, conversationId: string, seq: number) {
			requireLive();
			const client = deps.hub();
			if (!client) return;
			const epoch = generation;
			const row = store
				.getState()
				.orgs[tenantId]?.conversations.find((c) => c.id === conversationId);
			if (row && row.last_read_seq >= seq && row.unread_count === 0) return;
			let optimistic: Conversation | undefined;
			if (row && seq >= row.latest_seq) {
				optimistic = { ...row, unread_count: 0 };
				reconcileConversation(
					tenantId,
					conversationId,
					() => optimistic ?? row,
				);
			}
			try {
				const answer = await client.markRead(tenantId, conversationId, { seq });
				if (closed || epoch !== generation) return;
				reconcileConversation(tenantId, conversationId, (current) => {
					// Receipts can arrive in reverse order; the server cursor never goes back.
					if (answer.last_read_seq < current.last_read_seq) return current;
					return {
						...current,
						last_read_seq: answer.last_read_seq,
						unread_count: answer.unread_count,
						muted: answer.muted,
						...(answer.notify ? { notify: answer.notify } : {}),
					};
				});
			} catch (error) {
				if (closed || epoch !== generation) return;
				if (gateFailure(error)) return;
				// Restore only our untouched optimistic row, never a newer receipt/refresh.
				if (row && optimistic) {
					const current = store
						.getState()
						.orgs[tenantId]?.conversations.find((c) => c.id === conversationId);
					if (current === optimistic)
						reconcileConversation(tenantId, conversationId, () => row);
					else if (current && current.last_read_seq < seq) {
						// Another writer owns this row now: undoing our old snapshot would
						// lose its changes. Reconcile from the server instead of guessing.
						await Promise.all([
							actions.loadOrganization(tenantId, { silent: true }),
							actions.refreshUnread(),
						]);
					}
				}
			}
		},

		/**
		 * Upload through the same account gate as Send, not directly from a chip.
		 * The client owns the single forced refresh; only its final refusal may
		 * retire private state, and an old account's refusal cannot retire its
		 * successor. Successful late uploads are released using the captured
		 * client/conversation rather than publishing into the new account.
		 */
		async uploadAttachment(
			tenantId: string,
			conversationId: string,
			bytes: Uint8Array,
		) {
			requireLive();
			const gate = store.getState().gate;
			if (gate === "plan_required" || gate === "signed_out")
				throw new HubError({
					kind: gate === "plan_required" ? "plan" : "sign_in",
					message: "Team Bridge is not available for this account.",
				});
			const epoch = generation;
			const client = deps.hub();
			try {
				if (!client)
					throw new HubError({
						kind: "sign_in",
						message: "Sign in to Radient.",
					});
				const answer = await client.uploadAttachment(
					tenantId,
					conversationId,
					bytes,
				);
				if (closed || epoch !== generation) {
					// A live reset may clean up with its captured client. A retired
					// provider must not refresh credentials even for a DELETE; staged
					// expiry is the backstop after its authority has ended.
					if (!closed)
						void client
							.deleteAttachment(tenantId, conversationId, answer.id)
							.catch(() => undefined);
					throw new HubError({
						kind: "sign_in",
						message: "Account changed while uploading.",
					});
				}
				return answer;
			} catch (error) {
				if (!closed && epoch === generation) gateFailure(error);
				throw error;
			}
		},

		/** Change this conversation's notification policy. Throws so the menu can say so. */
		async setNotify(tenantId: string, conversationId: string, notify: Notify) {
			requireLive();
			const gate = store.getState().gate;
			if (gate === "plan_required" || gate === "signed_out")
				throw new HubError({
					kind: gate === "plan_required" ? "plan" : "sign_in",
					message: "Team Bridge is not available for this account.",
				});
			const client = deps.hub();
			if (!client)
				throw new HubError({ kind: "sign_in", message: "Sign in to Radient." });
			const epoch = generation;
			let answer: Awaited<ReturnType<HubClient["markRead"]>>;
			try {
				answer = await client.markRead(tenantId, conversationId, {
					notify,
				});
			} catch (error) {
				if (!closed && epoch === generation) gateFailure(error);
				throw error;
			}
			if (closed || epoch !== generation) return;
			reconcileConversation(tenantId, conversationId, (c) => ({
				...c,
				unread_count:
					answer.last_read_seq >= c.last_read_seq
						? answer.unread_count
						: c.unread_count,
				last_read_seq: Math.max(c.last_read_seq, answer.last_read_seq),
				muted: answer.muted,
				notify: answer.notify ?? notify,
			}));
			// The hub's account total excludes muted conversations, so a policy
			// change moves the drawer badge and the app icon badge: re-read the
			// authoritative total instead of guessing the delta here.
			void actions.refreshUnread();
		},

		/**
		 * Send as the reader. The conversation is created FIRST when the target
		 * is a draft (create-on-first-send). Returns the stored message so the
		 * thread can replace its pending row. Throws a `HubError` so the composer
		 * keeps the draft and says what failed.
		 */
		async send(
			tenantId: string,
			conversationId: string,
			body: string,
			clientRef: string,
			attachmentIds: string[] = [],
			mentions: MentionRow[] = [],
		): Promise<Message> {
			requireLive();
			const gate = store.getState().gate;
			if (gate === "plan_required" || gate === "signed_out")
				throw new HubError({
					kind: gate === "plan_required" ? "plan" : "sign_in",
					message: "Team Bridge is not available for this account.",
				});
			const client = deps.hub();
			if (!client)
				throw new HubError({ kind: "sign_in", message: "Sign in to Radient." });
			const epoch = generation;
			let message: Message;
			try {
				message = await client.send(tenantId, conversationId, {
					clientRef,
					body,
					attachmentIds,
					// Only when present: a send with no mentions keeps the exact
					// call (and wire body) it had before mentions existed.
					...(mentions.length > 0 ? { mentions } : {}),
				});
			} catch (error) {
				if (!closed && epoch === generation) gateFailure(error);
				throw error;
			}
			if (closed || epoch !== generation)
				throw new HubError({
					kind: "sign_in",
					message: "Account changed while sending.",
				});
			const key = threadKey(tenantId, conversationId);
			store.setState((s) => ({
				threads: {
					...s.threads,
					[key]: {
						...(s.threads[key] ?? emptyThread()),
						messages: mergeMessages(s.threads[key]?.messages ?? [], [message]),
					},
				},
			}));
			patchConversation(tenantId, conversationId, (c) => ({
				...c,
				latest_seq: Math.max(c.latest_seq, message.seq),
				last_read_seq: Math.max(c.last_read_seq, message.seq),
				last_message_at: message.created_at,
			}));
			return message;
		},

		/**
		 * Read one reply thread from its first reply, following the hub's
		 * inclusive `next_after_seq` cursor. The served root replaces the
		 * timeline's copy, which is how the root row's count and unread move
		 * without the phone counting anything itself.
		 */
		loadReplyThread(target: ReplyThreadTarget): Promise<void> {
			const key = replyThreadKey(target);
			return once(`replies:${key}`, (owned) =>
				readReplyPages(target, undefined, owned),
			);
		},

		/**
		 * Continue a thread past the page cap from the held `moreAfterSeq`. Its
		 * own coalescing key, so a tap is never swallowed by a poll in flight;
		 * both merge by id into what is held, so their order does not matter.
		 */
		loadMoreReplies(target: ReplyThreadTarget): Promise<void> {
			const key = replyThreadKey(target);
			const from = store.getState().replyThreads[key]?.moreAfterSeq;
			if (from === null || from === undefined) return Promise.resolve();
			return once(`replies-more:${key}`, (owned) =>
				readReplyPages(target, from, owned),
			);
		},

		/**
		 * Advance this reader's cursor for one reply thread to `seq` (the newest
		 * reply actually displayed). The answer's count is applied to the root
		 * as served; the account badge is re-read, because the hub rolls a thread
		 * read into the conversation's unread. Never throws: `false` says the
		 * write did not land, so the screen may try again; the badge simply
		 * stays until a read succeeds.
		 */
		async markReplyThreadRead(
			target: ReplyThreadTarget,
			seq: number,
		): Promise<boolean> {
			if (closed) return false;
			const client = deps.hub();
			if (!client) return false;
			const epoch = generation;
			let answer: Awaited<ReturnType<HubClient["markThreadRead"]>>;
			try {
				answer = await client.markThreadRead(
					target.tenantId,
					target.conversationId,
					target.rootId,
					seq,
				);
			} catch (error) {
				if (!closed && epoch === generation) gateFailure(error);
				return false;
			}
			if (closed || epoch !== generation) return false;
			patchRoot(target, (root) => rootAfterThreadRead(root, answer));
			void actions.refreshUnread();
			return true;
		},

		/**
		 * Reply in a thread as the reader. Idempotent on `clientRef` like a
		 * top-level send. The stored reply joins the reply thread only: the
		 * hub keeps replies out of the conversation timeline, and so does the
		 * phone. The thread is then re-read so the root's count comes from the
		 * hub. Throws a `HubError` so the composer keeps the draft.
		 */
		async sendReply(
			target: ReplyThreadTarget,
			body: string,
			clientRef: string,
		): Promise<Message> {
			requireLive();
			const gate = store.getState().gate;
			if (gate === "plan_required" || gate === "signed_out")
				throw new HubError({
					kind: gate === "plan_required" ? "plan" : "sign_in",
					message: "Team Bridge is not available for this account.",
				});
			const client = deps.hub();
			if (!client)
				throw new HubError({ kind: "sign_in", message: "Sign in to Radient." });
			const epoch = generation;
			let message: Message;
			try {
				message = await client.send(target.tenantId, target.conversationId, {
					clientRef,
					body,
					threadRootId: target.rootId,
				});
			} catch (error) {
				if (!closed && epoch === generation) gateFailure(error);
				throw error;
			}
			if (closed || epoch !== generation)
				throw new HubError({
					kind: "sign_in",
					message: "Account changed while sending.",
				});
			const key = replyThreadKey(target);
			patchReplyThread(key, {
				replies: mergeMessages(
					store.getState().replyThreads[key]?.replies ?? [],
					[message],
				),
			});
			void actions.loadReplyThread(target);
			return message;
		},

		/**
		 * Toggle MY `emoji` on one message (spec §4.8, the desktop's
		 * `useTeamBridgeReactionState` rule set):
		 * 1. One toggle in flight per MESSAGE: a second tap while one is pending
		 *    is `ignored`, so a quick double tap sends one request and two
		 *    snapshots can never race on rollback.
		 * 2. The optimistic projection shows at once (`reactionPending`); the
		 *    held message is untouched, so a poll landing mid-write cannot
		 *    overwrite it and the snapshot to restore is simply "drop the
		 *    overlay".
		 * 3. Success: the server's full summary REPLACES the rows everywhere the
		 *    message is held; a confirmed add feeds the quick row's usage.
		 * 4. Failure: the overlay is dropped (the exact prior rows show again),
		 *    the message is marked failed. No automatic retry: both verbs are
		 *    idempotent, so the reader's next tap is the retry. Offline fails the
		 *    same way; no reaction is queued.
		 * 5. An uncoded 404/405 hides reactions for the session, no error line.
		 * Haptics and announcements are the screen's (this store is Node-tested);
		 * it returns what happened so the screen can pick them.
		 */
		async toggleReaction(
			target: ReactionTarget,
			emoji: string,
		): Promise<ReactionOutcome> {
			if (closed) return "ignored";
			const state = store.getState();
			if (state.reactionsUnserved) return "unserved";
			if (
				state.gate === "plan_required" ||
				state.gate === "signed_out" ||
				backedOff("reactions", clock())
			)
				return "ignored";
			const key = reactionKey(target);
			if (state.reactionPending[key]) return "ignored";
			const client = deps.hub();
			if (!client) return "failed";
			const before = heldReactions(target);
			const active = reactionAdds(before, emoji);
			const { [key]: _cleared, ...failed } = state.reactionFailed;
			store.setState({
				reactionPending: {
					...state.reactionPending,
					[key]: { rows: toggleReaction(before, emoji), emoji },
				},
				reactionFailed: failed,
			});
			const epoch = generation;
			const priorBackoff = backoff.get("reactions");
			const settle = (change: Partial<TeamBridgeState>) =>
				store.setState((s) => {
					const { [key]: _done, ...pending } = s.reactionPending;
					return { reactionPending: pending, ...change };
				});
			try {
				const answer = await client.react(
					target.tenantId,
					target.conversationId,
					target.messageId,
					emoji,
					active,
				);
				// An account change mid-write: the reset already cleared everything.
				if (closed || epoch !== generation) return "ignored";
				reactionSettled.set(key, ++reactionRevision);
				// A different message may have received a 429 while this write
				// was in flight. Its newer refusal must survive this success.
				if (backoff.get("reactions") === priorBackoff)
					backoff.delete("reactions");
				patchMessage(target, (m) => ({ ...m, reactions: answer.reactions }));
				settle({});
				if (active)
					recordTeamBridgeEmoji(
						store.getState().selfAccountId,
						emoji,
						(deps.now ?? Date.now)(),
					);
				return active ? "added" : "removed";
			} catch (error) {
				if (closed || epoch !== generation) return "ignored";
				if (routeMissing(error)) {
					settle({ reactionsUnserved: true });
					return "unserved";
				}
				// Writes share an account bucket. Reuse its refusal policy but never
				// schedule an automatic toggle (which would invert user intent).
				if (isRateLimited(error)) noteTransient("reactions", error, clock());
				settle({
					reactionFailed: { ...store.getState().reactionFailed, [key]: true },
				});
				gateFailure(error);
				return "failed";
			}
		},

		/** Insert a conversation the reader just created (a first send's DM). */
		adopt(conversation: Conversation) {
			if (closed) return;
			store.setState((s) => {
				const org = s.orgs[conversation.tenant_id] ?? emptyOrg();
				const rest = org.conversations.filter((c) => c.id !== conversation.id);
				return {
					orgs: {
						...s.orgs,
						[conversation.tenant_id]: {
							...org,
							conversations: [conversation, ...rest],
						},
					},
				};
			});
		},

		/** Sign-out: nothing of the previous account survives. */
		retire() {
			if (closed) return;
			closed = true;
			generation += 1;
			inFlight.clear();
			clearBackoff();
			clearAttachmentCache();
			clearTeamBridgeDrafts();
			// The remembered last conversation is the same account-scoped class (`last-target.ts`).
			clearTeamBridgeTargets();
			clearTeamBridgeEmoji();
			store.setState(initialTeamBridgeState());
		},

		reset() {
			if (closed) return;
			generation += 1;
			inFlight.clear();
			// The next account starts with no inherited waits or pending retries.
			clearBackoff();
			// Sign-out and account change both land here: the previous account's
			// decoded images and unsent text drafts must not outlive it in memory.
			clearAttachmentCache();
			clearTeamBridgeDrafts();
			// The remembered last conversation is the same account-scoped class (`last-target.ts`).
			clearTeamBridgeTargets();
			// Emoji usage is per account and in memory (`emoji-usage.ts`).
			clearTeamBridgeEmoji();
			store.setState(initialTeamBridgeState());
		},
	};

	return { store, actions, isActive: () => !closed };
}

export type TeamBridgeStore = ReturnType<typeof createTeamBridgeStore>;
