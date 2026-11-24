/**
 * Reply threads on Team Bridge: the pure rules the timeline row, the thread
 * screen, the store and the push tap share.
 *
 * NAMING. In this codebase "thread" already means one CONVERSATION's screen
 * (`thread-screen.tsx`, `ThreadData`, `threadKey`). A thread of REPLIES under
 * one root message is therefore a "reply thread" everywhere in code, so the two
 * never share an identifier. On screen it is simply "Thread", as on the desktop.
 *
 * THE PROJECTION RULE. Every number here is the hub's: `reply_count`,
 * `reply_participants` and `thread_unread_count` are computed server-side for
 * the reading account. Nothing in this module counts replies or subtracts a
 * read cursor; it only decides whether a served value is shown. That is what
 * keeps the phone's badge equal to the desktop's for the same reader.
 *
 * WHY A SEPARATE ROUTE AND NOT A SHEET. A push about a reply must open the
 * thread directly (cold start included), and a URL is the one destination both
 * a tap and a deep link already know how to reach (`push-payload.ts`).
 */

import { t } from "@/i18n";
import type {
	DirectoryMember,
	Message,
	ReplyThreadPage,
} from "@/team-bridge/contract";
import * as model from "@/team-bridge/model";

export interface ReplyThreadTarget {
	tenantId: string;
	conversationId: string;
	rootId: string;
}

/**
 * One replier as served: the label every hub sends, enriched by the parallel
 * `reply_participant_ids` entry at the same index when there is one. The id is
 * what lets a row say WHICH replier is an agent (design review D1): a bare
 * label would pass an agent off as a person.
 */
export interface ReplyParticipant {
	label: string;
	accountId?: string;
	kind?: "human" | "agent";
}

/** What a root row shows. `unread` is null when the hub did not say. */
export interface ReplyThreadSummary {
	count: number;
	participants: ReplyParticipant[];
	unread: number | null;
	/** Only a valid hub rollup timestamp, never inferred from visible replies. */
	lastReplyAt?: string;
}

/**
 * The affordance a timeline row draws, or null for none.
 *
 * Null for a REPLY (it never roots a thread) and for a root the hub reports
 * with no replies or no rollup at all: an older hub sends none of these
 * fields, and "0 replies" is not something worth a control. An unread count
 * that is absent stays null, never 0 (absent means "cannot tell").
 */
export function replyThreadSummary(
	message: Pick<
		Message,
		| "thread_root_id"
		| "reply_count"
		| "reply_participants"
		| "reply_participant_ids"
		| "thread_unread_count"
		| "last_reply_at"
	>,
): ReplyThreadSummary | null {
	if (message.thread_root_id) return null;
	const count = message.reply_count;
	if (count === undefined || count <= 0) return null;
	/* Merge by INDEX before dropping blanks, the desktop's `threadParticipants`
	 * rule: labels lead (every hub sends them), so an id list that is shorter,
	 * longer or absent never drops or invents a replier; a null id entry (one
	 * the contract could not read) leaves its label plain. */
	const ids = message.reply_participant_ids ?? [];
	return {
		count,
		participants: (message.reply_participants ?? [])
			.map((raw, index): ReplyParticipant | null => {
				const label = raw.trim();
				if (label === "") return null;
				const id = ids[index];
				return id
					? { label, accountId: id.account_id, kind: id.kind }
					: { label };
			})
			.filter((p): p is ReplyParticipant => p !== null)
			.slice(0, 3),
		unread: message.thread_unread_count ?? null,
		...(message.last_reply_at &&
		Number.isFinite(Date.parse(message.last_reply_at))
			? { lastReplyAt: message.last_reply_at }
			: {}),
	};
}

/**
 * One replier's name, marked the way the rows of the same timeline mark it
 * (design review D1): an agent reads `Aida (Ben)` through `model.senderLabel`,
 * exactly as its own messages do, so the one line that summarises a thread
 * never makes an agent and a human look alike. An agent the directory cannot
 * place yet (no owner to name) still says what it is — `Aida (Agent)` — rather
 * than passing for a person. A human id resolves to the directory's live name.
 * Only a replier the hub sent no id for keeps its plain served label: there is
 * nothing to tell its kind by, and guessing would be inventing.
 */
export function replierLabel(
	participant: ReplyParticipant,
	people: readonly DirectoryMember[],
): string {
	const { label, accountId, kind } = participant;
	if (!accountId || !kind) return label;
	const sender = { account_id: accountId, kind, display_label: label };
	if (
		kind === "agent" &&
		!people.some((person) => person.account_id === accountId)
	)
		return t("mobile.team_bridge.profile.name_with_owner", {
			agent: label,
			owner: t("mobile.team_bridge.profile.badge_agent"),
		});
	return model.senderLabel(sender, people);
}

/** Whether the row's unread badge shows: only a served count above zero. */
export const showsThreadUnread = (
	summary: ReplyThreadSummary | null,
): boolean => summary !== null && summary.unread !== null && summary.unread > 0;

/**
 * Refuse a page that is not THIS thread rather than painting (or later
 * acknowledging) another conversation's replies under this header. The
 * desktop's `assertThreadPage`, kept identical: the root must be the
 * addressed root of this conversation and not itself a reply, and every reply
 * must belong to it.
 */
export function isReplyThreadPageFor(
	page: ReplyThreadPage,
	target: ReplyThreadTarget,
): boolean {
	return (
		page.root.id === target.rootId &&
		page.root.conversation_id === target.conversationId &&
		!page.root.thread_root_id &&
		page.replies.every(
			(reply) =>
				reply.conversation_id === target.conversationId &&
				reply.thread_root_id === target.rootId,
		)
	);
}

/**
 * The newest reply seq the reader has actually had on screen, from the rows
 * the list reports visible. A FETCHED page is not evidence of reading (the
 * desktop's `observeDisplayedThreadReplies` rule): only replies that were
 * displayed may advance the cursor, so a long thread opened at its top never
 * marks its unseen tail read. The root is not a reply and never counts.
 */
export function newestDisplayedReplySeq(
	visible: readonly Pick<Message, "seq" | "thread_root_id">[],
	rootId: string,
): number | null {
	let newest: number | null = null;
	for (const row of visible) {
		if (row.thread_root_id !== rootId) continue;
		if (newest === null || row.seq > newest) newest = row.seq;
	}
	return newest;
}

/**
 * Apply the hub's answer to a thread read onto the root it describes. The
 * count is TAKEN from the answer, never computed. An answer without a count
 * (a lenient parse of an odd body) leaves the root as it was; the next page or
 * timeline read restates it.
 */
export function rootAfterThreadRead<T extends Message>(
	root: T,
	answer: { thread_unread_count?: number; thread_last_read_seq?: number },
): T {
	if (answer.thread_unread_count === undefined) return root;
	if (
		answer.thread_last_read_seq !== undefined &&
		root.thread_last_read_seq !== undefined &&
		answer.thread_last_read_seq < root.thread_last_read_seq
	)
		// A slower, older answer must not resurrect a badge a newer read cleared.
		return root;
	if (
		root.thread_unread_count === answer.thread_unread_count &&
		root.thread_last_read_seq ===
			(answer.thread_last_read_seq ?? root.thread_last_read_seq)
	)
		return root;
	return {
		...root,
		thread_unread_count: answer.thread_unread_count,
		...(answer.thread_last_read_seq === undefined
			? {}
			: { thread_last_read_seq: answer.thread_last_read_seq }),
	};
}

/**
 * The root to hold after a replies GET, given the copy already held.
 *
 * A GET and a thread read race: a poll's GET can leave before a read POST and
 * answer after it, carrying the cursor/unread pair from BEFORE the read
 * (agent review R1: observed unread 0 -> 2, cursor 3 -> 0). The hub keeps the
 * max cursor, so a served `thread_last_read_seq` below the held one is stale by
 * construction: keep the held PAIR (cursor and the count computed for it,
 * never one without the other) and take everything else — reply count,
 * repliers, edits — from the page. The next GET after the read restates both.
 */
export function rootFromServedPage<T extends Message>(
	held: T | null | undefined,
	served: T,
): T {
	const heldCursor = held?.thread_last_read_seq;
	if (!held || heldCursor === undefined) return served;
	const servedCursor = served.thread_last_read_seq;
	if (servedCursor !== undefined && servedCursor >= heldCursor) return served;
	return {
		...served,
		thread_last_read_seq: heldCursor,
		thread_unread_count: held.thread_unread_count,
	};
}

/**
 * `rootFromServedPage` for every root in a TIMELINE page (a refresh, its
 * bridging reads, or an older page), against the copies the timeline holds
 * when the page is APPLIED.
 *
 * The timeline carries the same cursor/unread pair as a reply page, so it has
 * the same race: a GET that left before a thread read and answers after it
 * would put the pre-read pair back (held 3/0 -> stale 0/2). The check has to
 * run at application time, against `held` as it is then, not a snapshot from
 * when the request started: the read lands in between, and that is exactly
 * what the stale page must not undo. Messages the timeline does not hold yet,
 * or holds without a cursor, are taken as served.
 *
 * Returns `incoming` itself when no root needed protecting, so the caller's
 * `mergeMessages` keeps its structural sharing; a protected root equal to the
 * held copy is then also kept as the held object by `mergeMessages`.
 */
export function protectHeldThreadCursors<T extends Message>(
	held: readonly T[],
	incoming: readonly T[],
): T[] {
	// Only held copies that carry a cursor can be regressed; most messages are
	// not thread roots, so this is usually empty and the page passes through.
	const cursors = new Map<string, T>();
	for (const message of held)
		if (message.thread_last_read_seq !== undefined)
			cursors.set(message.id, message);
	if (cursors.size === 0) return incoming as T[];
	let changed = false;
	const out = incoming.map((served) => {
		const kept = cursors.get(served.id);
		if (!kept) return served;
		const next = rootFromServedPage(kept, served);
		if (
			next.thread_last_read_seq === served.thread_last_read_seq &&
			next.thread_unread_count === served.thread_unread_count
		)
			return served;
		changed = true;
		return next;
	});
	return changed ? out : (incoming as T[]);
}

/** Whether a failed thread read means the root itself is gone, so retrying
 *  can never succeed (UX review U3): the hub's 404 `message_not_found`. */
export const isReplyRootGone = (
	error: { status: number | null; code: string | null } | null | undefined,
): boolean =>
	!!error && (error.code === "message_not_found" || error.status === 404);

/**
 * Replace a root the timeline already holds with the hub's newer copy (a
 * reply page carries the root with its fresh rollup). Only a HELD root is
 * replaced: inserting one the timeline never paged would open a hole in the
 * conversation's history. Returns `messages` itself when nothing changed, so a
 * store can skip publishing (the structural-sharing rule in `mergeMessages`).
 */
export function withRoot(
	messages: readonly Message[],
	root: Message,
	same: (a: Message, b: Message) => boolean,
): Message[] {
	const index = messages.findIndex((message) => message.id === root.id);
	if (index === -1) return messages as Message[];
	const held = messages[index] as Message;
	if (same(held, root)) return messages as Message[];
	const next = messages.slice();
	next[index] = root;
	return next;
}

/** The route a root row and a reply push open. `compose` asks the thread
 *  screen to focus its composer on arrival: the actions sheet's "Reply in
 *  thread" means "I am about to type", unlike opening the chip to read. */
export const replyThreadPath = (
	target: ReplyThreadTarget,
	options: { compose?: boolean } = {},
): string =>
	`/team-bridge/${encodeURIComponent(target.tenantId)}/${encodeURIComponent(target.conversationId)}/thread/${encodeURIComponent(target.rootId)}${options.compose ? `?${REPLY_THREAD_COMPOSE_PARAM}=1` : ""}`;

/** The query parameter `replyThreadPath(…, { compose: true })` sets. */
export const REPLY_THREAD_COMPOSE_PARAM = "compose";

export const replyThreadKey = (target: ReplyThreadTarget): string =>
	`${target.tenantId}/${target.conversationId}/${target.rootId}`;
