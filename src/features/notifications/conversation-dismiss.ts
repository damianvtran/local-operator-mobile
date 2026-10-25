/**
 * "Dismiss all from this conversation": the scope it freezes and the writes it
 * sends.
 *
 * WHY A FROZEN, ENUMERATED SCOPE RATHER THAN A SWEEP. The operator reads a
 * number ("Dismiss all 120 from Aida") and confirms THAT number, so the write
 * may reach exactly the rows that number counted and nothing else:
 *
 * - **Every page, not the loaded one.** The count walks the conversation's
 *   updates cursor page by cursor page under one `through_seq`, so 120 rows
 *   across two 100-row pages are all counted and all sent — a count over the
 *   first page promised 100 and applied 100 of 120 (the desktop's code round 2,
 *   minor 2, is the same defect on the other surface).
 * - **One boundary for the whole walk.** The first page's `high_water` is the
 *   server's own capture (taken before it read any row), and every later page
 *   names it, so an update that lands mid-count — or between the confirmation
 *   and the write — is neither counted nor dismissed.
 * - **The observed tokens are the write.** The live relay refuses a bulk write
 *   without `observed` (measured at local-operator `a7d149e705`: "bulk writes
 *   require 0..500 observed tokens") and applies ONLY those id/revision pairs,
 *   narrowed by `session_id`. So the tokens this walk collected are sent back
 *   verbatim, in batches of at most 500, and a row revised since it was counted
 *   is refused as `stale_revision` rather than cleared unseen (R10 applied to a
 *   conversation).
 * - **Open asks are never in it.** An agent blocked on the operator is not an
 *   update to clear (contract §2.3); the relay would refuse one with `live_ask`.
 *   They are counted separately so the confirmation and the receipt can SAY they
 *   were skipped instead of leaving the reader to wonder why one row stayed.
 *
 * This module is deliberately renderer-free and import-free (its types are
 * structural): the same functions run in the app and in the mock relay's store
 * tests, so the rule a test pins is the rule the screen runs. It mirrors the
 * desktop's `notification-operations.ts` (`observeNotificationScope`,
 * `applyNotificationOperation`) so the two surfaces cannot drift on what
 * "all from this conversation" means.
 */

/** One id at one revision — what a write names. */
export interface ScopeToken {
	id: string;
	revision: number;
}

/** The slice of a list answer this walk reads. Structural, so the app's parsed
 *  payload and the mock store's raw JSON both satisfy it. */
export interface ScopePage {
	items: ReadonlyArray<{
		id: string;
		revision: number;
		source: string;
		dismissed?: boolean;
		session: { id: string };
	}>;
	waiting?: ReadonlyArray<{ id: string; session: { id: string } }>;
	next_cursor: string | null;
	high_water: number;
	observed?: ReadonlyArray<ScopeToken>;
}

/** The page request the walk makes: everything not dismissed, in one
 *  conversation, under one boundary. */
export interface ScopePageRequest {
	state: "all";
	session_id: string;
	limit: number;
	through_seq?: number;
	cursor?: string;
}

/** The slice of a write answer the receipt reads. */
export interface ScopeWriteAnswer {
	changed: ReadonlyArray<string>;
	skipped: ReadonlyArray<{ id: string; reason: string }>;
}

/** The PATCH bodies this module sends — the route's own shapes. */
export type ScopeWriteBody =
	| {
			op: "dismiss";
			session_id: string;
			through_seq: number;
			observed: ScopeToken[];
	  }
	| { op: "undismiss"; ids: ScopeToken[] };

/** What the confirmation owns: the exact rows its number counted. */
export interface ConversationScope {
	sessionId: string;
	title: string;
	throughSeq: number;
	tokens: ReadonlyArray<ScopeToken>;
	/** Open asks in this conversation — skipped by the write, named by the copy. */
	openAsks: number;
}

/** What one operation actually did, three ways, so partial is never "done". */
export interface ScopeReceipt {
	changed: ScopeToken[];
	skipped: Array<{ id: string; reason: string }>;
	/** Tokens no answer confirmed either way (a dropped request may still have
	 *  committed, so they are reported as unconfirmed, never retried silently). */
	pending: ScopeToken[];
	failed: boolean;
}

/** The route's page bound, and the largest page the walk asks for. */
export const SCOPE_PAGE_LIMIT = 100;
/** The route's bound on tokens per write (`0..500`, both `ids` and `observed`). */
export const SCOPE_BATCH_LIMIT = 500;

const ASK_PREFIX = "ask:";

/**
 * Walk every page of one conversation's updates under one frozen boundary.
 *
 * The first page carries no `through_seq`: the server captures its own
 * `high_water` before reading rows, and that capture becomes the boundary every
 * later page names. A cursor that repeats is a server bug, and looping on it
 * would hang the confirmation, so it throws instead.
 */
export async function observeConversationScope(
	readPage: (request: ScopePageRequest) => Promise<ScopePage>,
	input: { sessionId: string; title: string },
): Promise<ConversationScope> {
	const tokens = new Map<string, ScopeToken>();
	const asks = new Set<string>();
	let throughSeq: number | undefined;
	let cursor: string | undefined;
	const cursors = new Set<string>();
	do {
		const page = await readPage({
			state: "all",
			session_id: input.sessionId,
			limit: SCOPE_PAGE_LIMIT,
			...(throughSeq !== undefined ? { through_seq: throughSeq } : {}),
			...(cursor !== undefined ? { cursor } : {}),
		});
		if (throughSeq === undefined) throughSeq = page.high_water;
		for (const ask of page.waiting ?? []) {
			if (ask.session.id === input.sessionId) asks.add(ask.id);
		}
		/* The rows, not the answer's `observed` list, decide membership: a row
		 * must be an update, undismissed and in THIS conversation. The revision
		 * is the observed token's when the relay states one, so the write echoes
		 * the server's own assertion rather than a copy made from the row. */
		const stated = new Map(
			(page.observed ?? []).map((token) => [token.id, token.revision]),
		);
		for (const item of page.items) {
			if (item.id.startsWith(ASK_PREFIX) || item.source === "ask") continue;
			if (item.dismissed === true) continue;
			if (item.session.id !== input.sessionId) continue;
			if (tokens.has(item.id)) continue;
			tokens.set(item.id, {
				id: item.id,
				revision: stated.get(item.id) ?? item.revision,
			});
		}
		cursor = page.next_cursor ?? undefined;
		if (cursor !== undefined) {
			if (cursors.has(cursor)) {
				throw new Error("The notification cursor did not advance.");
			}
			cursors.add(cursor);
		}
	} while (cursor !== undefined);
	return Object.freeze({
		sessionId: input.sessionId,
		title: input.title,
		throughSeq: throughSeq ?? 0,
		tokens: Object.freeze([...tokens.values()]),
		openAsks: asks.size,
	});
}

/**
 * Send one operation in batches of at most 500 tokens and keep a three-way
 * receipt.
 *
 * `dismiss` sends the frozen scope (`session_id` + `through_seq` + the batch as
 * `observed`); `undismiss` names the ORIGINAL tokens as `ids`, never a revision
 * fetched afterwards, so an Undo cannot restore something the operator never
 * saw. A failed request stops the run: the server may have committed it, so its
 * tokens stay "not confirmed" instead of being resent.
 */
export async function applyConversationOperation(
	send: (body: ScopeWriteBody) => Promise<ScopeWriteAnswer>,
	op: "dismiss" | "undismiss",
	tokens: ReadonlyArray<ScopeToken>,
	scope: ConversationScope,
): Promise<ScopeReceipt> {
	const captured = [
		...new Map(tokens.map((token) => [token.id, { ...token }])).values(),
	];
	const receipt: ScopeReceipt = {
		changed: [],
		skipped: [],
		pending: captured,
		failed: false,
	};
	const settled = new Set<string>();
	for (let index = 0; index < captured.length; index += SCOPE_BATCH_LIMIT) {
		const batch = captured.slice(index, index + SCOPE_BATCH_LIMIT);
		const byId = new Map(batch.map((token) => [token.id, token]));
		try {
			const answer = await send(
				op === "dismiss"
					? {
							op,
							session_id: scope.sessionId,
							through_seq: scope.throughSeq,
							observed: batch,
						}
					: { op, ids: batch },
			);
			for (const id of answer.changed) {
				const token = byId.get(id);
				if (token !== undefined && !settled.has(id)) {
					receipt.changed.push(token);
					settled.add(id);
				}
			}
			for (const skip of answer.skipped) {
				if (byId.has(skip.id) && !settled.has(skip.id)) {
					receipt.skipped.push({ id: skip.id, reason: skip.reason });
					settled.add(skip.id);
				}
			}
		} catch {
			receipt.failed = true;
		}
		receipt.pending = captured.filter((token) => !settled.has(token.id));
		if (receipt.failed) break;
	}
	return receipt;
}

/** Whether every named token is confirmed changed — the only state that earns
 *  the plain sentence. Anything else keeps the counts on screen. */
export function receiptComplete(receipt: ScopeReceipt, expected: number) {
	return (
		receipt.changed.length === expected &&
		receipt.skipped.length === 0 &&
		receipt.pending.length === 0 &&
		!receipt.failed
	);
}

/* ------------------------------------------------------------------ copy -- */

function updates(count: number): string {
	return `${count} update${count === 1 ? "" : "s"}`;
}

function asksStay(count: number): string {
	return count === 1
		? "1 open ask stays until it's answered."
		: `${count} open asks stay until they're answered.`;
}

/** The control's label once the scope is counted. */
export function dismissAllLabel(count: number, title: string): string {
	return `Dismiss all ${count} from ${title}`;
}

/** The control's label while the count is in flight: no number is invented. */
export function dismissAllPendingLabel(title: string): string {
	return `Dismiss all from ${title}`;
}

/** The row's accessibility action — the same verb, reachable from the list. */
export function dismissAllActionLabel(title: string): string {
	return `Dismiss all from ${title}`;
}

export function confirmDismissTitle(count: number, title: string): string {
	return `Dismiss ${updates(count)} from ${title}?`;
}

/** The confirmation's second line says what is NOT included, so a row left
 *  standing afterwards is the one the reader was told about. */
export function confirmDismissBody(openAsks: number): string {
	return openAsks > 0
		? `${asksStay(openAsks)} Only updates are dismissed.`
		: "Only updates are dismissed; open asks always stay until they're answered.";
}

export const DISMISS_ALL_NONE = "No updates from this conversation to dismiss.";
export const DISMISS_ALL_COUNT_FAILED =
	"Couldn't count this conversation's updates.";
export const DISMISS_CONFIRM_LABEL = "Dismiss";
export const UNDO_LABEL = "Undo";

/** The receipt for a dismissal: the plain sentence only when it was whole. */
export function dismissReceiptSentence(
	receipt: ScopeReceipt,
	scope: ConversationScope,
): string {
	const asks = scope.openAsks > 0 ? ` ${asksStay(scope.openAsks)}` : "";
	if (receiptComplete(receipt, scope.tokens.length)) {
		return `Dismissed ${updates(receipt.changed.length)} from ${scope.title}.${asks}`;
	}
	const parts = [
		`Dismissed ${receipt.changed.length} of ${updates(scope.tokens.length)} from ${scope.title}.`,
	];
	if (receipt.skipped.length > 0) {
		parts.push(
			`${receipt.skipped.length} changed after they were counted and were left alone.`,
		);
	}
	if (receipt.pending.length > 0) {
		parts.push(
			`${receipt.pending.length} not confirmed — the connection dropped.`,
		);
	}
	return `${parts.join(" ")}${asks}`;
}

/** The receipt for an Undo, honest about a partial restore in the same way. */
export function undoReceiptSentence(
	receipt: ScopeReceipt,
	expected: number,
): string {
	if (receiptComplete(receipt, expected)) {
		return `Restored ${updates(receipt.changed.length)}.`;
	}
	const rest = expected - receipt.changed.length;
	return `Restored ${receipt.changed.length} of ${updates(expected)}. ${rest} could not be restored.`;
}
