/**
 * The answers a reader has typed but not submitted, held for the life of the app
 * run.
 *
 * WHY THIS EXISTS (operator decision on a-5712, 2026-11-22: "Keep it"). Closing
 * the sheet used to discard a typed `Other` answer, so a reader who checked the
 * conversation — or had the sheet taken away by an incoming call — lost what
 * they had written. The draft now survives its expansion reset AND a close and
 * reopen, because it is keyed by conversation + ask rather than owned by the
 * expansion.
 *
 * WHAT THIS IS NOT. Nothing reaches the disk: the app still "caches nothing
 * durably" (ADR 0005 § 2, as amended by this decision — the rest of that rule
 * stands, and the ADR carries the note). A restart, or the ask settling, drops
 * the record. A SECRET question is never kept at all — not the typed value, not
 * the fact that one was typed — because a value the runtime deliberately never
 * echoes back must not be the one string this store holds.
 */

import type { AskQuestion } from "@/contracts";
import type { AskOther } from "@/features/session/asks";

export type AskDraftRecord = {
	answers: Record<string, string[]>;
	others: Record<string, AskOther>;
	skipped: string[];
};

/** One record per ask. The separator cannot appear in a session id or an ask id
 *  (both are the relay's own tokens), so two pairs can never collide. */
export const askDraftKey = (sessionId: string, askId: string): string =>
	`${sessionId}\u0000${askId}`;

/** The row's own conversation, not the sheet's current one.
 *
 *  The ask sheet lists asks from OTHER conversations too (an aggregate read),
 *  and a draft written under the sheet's session was pruned by the very next
 *  re-read: the write key said `<current>\0<ask>`, the live set held
 *  `<foreign>\0<ask>`, so `retainAskDrafts` deleted the answer the reader had
 *  just typed (review r1 F2 / QA r1 Q2). Every caller — write, read, prune,
 *  settle drop — derives its key HERE, so the four cannot drift apart again. */
export const askDraftKeyFor = (
	row: { ask_id: string; session_id?: string | null },
	currentSessionId: number | string | null | undefined,
): string =>
	askDraftKey(String(row.session_id || currentSessionId || ""), row.ask_id);

const drafts = new Map<string, AskDraftRecord>();

export const readAskDraft = (key: string): AskDraftRecord | null =>
	drafts.get(key) ?? null;

/**
 * Store one draft, with every SECRET question's answer removed on the way in.
 *
 * Stripping happens here rather than at the call site so there is one gate: a
 * caller that forgets is a caller that keeps a secret, and no later reader of
 * this module can opt out of the rule.
 */
export const writeAskDraft = (
	key: string,
	record: AskDraftRecord,
	secretIds: ReadonlySet<string>,
): void => {
	const answers: Record<string, string[]> = {};
	for (const [id, value] of Object.entries(record.answers)) {
		if (secretIds.has(id)) continue;
		answers[id] = value;
	}
	const others: Record<string, AskOther> = {};
	for (const [id, value] of Object.entries(record.others)) {
		if (secretIds.has(id)) continue;
		/* Copied, not referenced: the sheet keeps one object per question and
		 *  replaces it per keystroke, but a reference the store holds would still
		 *  change under it if a caller ever mutated one in place. */
		others[id] = { ...value };
	}
	drafts.set(key, { answers, others, skipped: [...record.skipped] });
};

export const dropAskDraft = (key: string): void => {
	drafts.delete(key);
};

/**
 * Forget every draft whose ask is no longer OUTSTANDING — settled, withdrawn, or
 * gone from the queue. Called with the live set on every read, so an ask answered
 * on another surface never leaves text behind for a row that no longer exists.
 */
export const retainAskDrafts = (keys: ReadonlySet<string>): void => {
	for (const key of [...drafts.keys()]) {
		if (!keys.has(key)) drafts.delete(key);
	}
};

/** Tests only: the store is module state, and a suite must start empty. */
export const forgetAskDrafts = (): void => {
	drafts.clear();
};

/** The secret question ids of one ask, as the store wants them. */
export const secretQuestionIds = (
	questions: readonly AskQuestion[],
): ReadonlySet<string> =>
	new Set(
		questions
			.filter((question) => question.secret === true)
			.map((question) => String(question.id)),
	);
