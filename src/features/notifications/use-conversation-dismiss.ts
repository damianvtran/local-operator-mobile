import { useCallback, useMemo, useRef, useState } from "react";

import type { RelayEndpoints } from "@/relay";

import {
	applyConversationOperation,
	applyTokenOperation,
	type ConversationScope,
	DISMISS_ALL_COUNT_FAILED,
	DISMISS_ALL_NONE,
	dismissReceiptSentence,
	dismissSelectionLabel,
	observeConversationScope,
	receiptComplete,
	type ScopeReceipt,
	type ScopeToken,
	undoReceiptSentence,
} from "./conversation-dismiss";

/** A hung page read must end as a stated failure, never a spinner that stays
 *  (the inbox read's own bound). */
const PAGE_TIMEOUT_MS = 8_000;

/**
 * Where "Dismiss all from this conversation" is, as one state the screen paints.
 *
 * `confirming` holds the FROZEN scope: the dialog's number is that scope's
 * token count, and confirming sends exactly those tokens. `done` keeps the
 * receipt, because Undo must name the ORIGINAL tokens that changed — never a
 * re-read, which could restore a row the operator never saw dismissed.
 */
/**
 * What a dismissal is about to touch.
 *
 * `scope` is a conversation, walked page by page under a frozen boundary;
 * `tokens` is an explicit selection (or one row) the screen already holds. Both
 * get the same receipt and the same Undo — the difference is only what the write
 * names (design review D2: one word may not mean two safety levels).
 */
export type DismissTarget =
	| { kind: "scope"; scope: ConversationScope }
	| { kind: "tokens"; tokens: ScopeToken[]; title: string };

export type ConversationDismissPhase =
	| { kind: "idle" }
	| { kind: "counting"; title: string }
	| { kind: "confirming"; target: DismissTarget }
	| { kind: "applying"; target: DismissTarget }
	| {
			kind: "done";
			target: DismissTarget;
			receipt: ScopeReceipt;
			sentence: string;
			complete: boolean;
	  }
	| { kind: "undoing"; target: DismissTarget; receipt: ScopeReceipt }
	| { kind: "undone"; sentence: string; complete: boolean }
	| { kind: "none"; sentence: string }
	| { kind: "failed"; sentence: string };

export interface ConversationDismiss {
	phase: ConversationDismissPhase;
	/** The rows a target names, so the confirmation can count them. */
	count: (target: DismissTarget) => number;
	/** Dismiss an explicit selection: the confirmation first (more than one row). */
	askTargets: (tokens: ScopeToken[]) => void;
	/** Dismiss explicit tokens STRAIGHT AWAY — one row, or a single-row
	 *  selection. Still produces the receipt and its Undo. Resolves `true` when
	 *  the write landed. */
	dismissNow: (tokens: ScopeToken[]) => Promise<boolean>;
	/** Say, in the reader's own screen, that the scope could not be counted. */
	reportCountFailed: () => void;
	/** Walk one conversation's updates. `null` when the walk failed; the caller
	 *  decides whether that is a label to withhold or a sentence to show. */
	observe: (
		sessionId: string,
		title: string,
	) => Promise<ConversationScope | null>;
	/** Open the confirmation for a scope the caller already walked (the
	 *  detail's label and its dialog then show the same number). */
	ask: (scope: ConversationScope) => void;
	/** Walk, then confirm — the list row's door, which holds no count. */
	askFresh: (sessionId: string, title: string) => Promise<void>;
	confirm: () => Promise<void>;
	cancel: () => void;
	undo: () => Promise<void>;
	clear: () => void;
}

/**
 * The hook both doors share, so the detail's button and the row's
 * accessibility action cannot disagree about what the action does.
 *
 * `onSettled` runs after every write (dismiss or Undo), so the screen re-reads
 * the relay rather than editing its rows locally — the relay's answer is the
 * store's state, including any row it refused.
 */
export function useConversationDismiss(
	client: RelayEndpoints | null,
	onSettled: () => void,
): ConversationDismiss {
	const [phase, setPhase] = useState<ConversationDismissPhase>({
		kind: "idle",
	});
	/* The latest phase for the async continuations: a confirm that resolves
	 *  after the reader cancelled must not resurrect the dialog. */
	const phaseRef = useRef(phase);
	phaseRef.current = phase;

	const observe = useCallback(
		async (sessionId: string, title: string) => {
			if (client === null) return null;
			try {
				return await observeConversationScope(
					(request) =>
						client.notifications(
							{
								state: request.state,
								session_id: request.session_id,
								limit: request.limit,
								through_seq: request.through_seq,
								cursor: request.cursor,
							},
							AbortSignal.timeout(PAGE_TIMEOUT_MS),
						),
					{ sessionId, title },
				);
			} catch {
				return null;
			}
		},
		[client],
	);

	const ask = useCallback((scope: ConversationScope) => {
		setPhase(
			scope.tokens.length === 0
				? { kind: "none", sentence: DISMISS_ALL_NONE }
				: { kind: "confirming", target: { kind: "scope", scope } },
		);
	}, []);

	const count = useCallback((target: DismissTarget) => {
		return target.kind === "scope"
			? target.scope.tokens.length
			: target.tokens.length;
	}, []);

	const askTargets = useCallback((tokens: ScopeToken[]) => {
		setPhase(
			tokens.length === 0
				? { kind: "none", sentence: DISMISS_ALL_NONE }
				: {
						kind: "confirming",
						target: { kind: "tokens", tokens, title: "" },
					},
		);
	}, []);

	/** One shared path for every dismiss, so the receipt and the Undo cannot
	 *  drift between the doors. */
	const run = useCallback(
		async (target: DismissTarget) => {
			if (client === null) return false;
			setPhase({ kind: "applying", target });
			const receipt =
				target.kind === "scope"
					? await applyConversationOperation(
							(body) => client.patchNotifications(body),
							"dismiss",
							target.scope.tokens,
							target.scope,
						)
					: await applyTokenOperation(
							(body) => client.patchNotifications(body),
							"dismiss",
							target.tokens,
						);
			const expected = count(target);
			const sentence =
				target.kind === "scope"
					? dismissReceiptSentence(receipt, target.scope)
					: `${dismissSelectionLabel(receipt.changed.length)}${
							receipt.changed.length === expected
								? ""
								: ` ${expected - receipt.changed.length} were left alone.`
						}`;
			setPhase({
				kind: "done",
				target,
				receipt,
				sentence,
				complete: receiptComplete(receipt, expected),
			});
			onSettled();
			return receipt.changed.length > 0;
		},
		[client, count, onSettled],
	);

	const dismissNow = useCallback(
		async (tokens: ScopeToken[]) => {
			if (tokens.length === 0) return false;
			return run({ kind: "tokens", tokens, title: "" });
		},
		[run],
	);

	const reportCountFailed = useCallback(() => {
		setPhase({ kind: "failed", sentence: DISMISS_ALL_COUNT_FAILED });
	}, []);

	const askFresh = useCallback(
		async (sessionId: string, title: string) => {
			setPhase({ kind: "counting", title });
			const scope = await observe(sessionId, title);
			if (phaseRef.current.kind !== "counting") return;
			if (scope === null) {
				setPhase({ kind: "failed", sentence: DISMISS_ALL_COUNT_FAILED });
				return;
			}
			ask(scope);
		},
		[ask, observe],
	);

	const confirm = useCallback(async () => {
		const current = phaseRef.current;
		if (current.kind !== "confirming") return;
		await run(current.target);
	}, [run]);

	const undo = useCallback(async () => {
		const current = phaseRef.current;
		if (current.kind !== "done" || client === null) return;
		const { target, receipt } = current;
		const scope = target.kind === "scope" ? target.scope : null;
		if (receipt.changed.length === 0) return;
		setPhase({ kind: "undoing", target, receipt });
		const restored = scope
			? await applyConversationOperation(
					(body) => client.patchNotifications(body),
					"undismiss",
					receipt.changed,
					scope,
				)
			: await applyTokenOperation(
					(body) => client.patchNotifications(body),
					"undismiss",
					receipt.changed,
				);
		const expected = receipt.changed.length;
		setPhase({
			kind: "undone",
			sentence: undoReceiptSentence(restored, expected),
			complete: receiptComplete(restored, expected),
		});
		onSettled();
	}, [client, onSettled]);

	const cancel = useCallback(() => {
		const current = phaseRef.current;
		if (current.kind === "confirming" || current.kind === "counting") {
			setPhase({ kind: "idle" });
		}
	}, []);

	const clear = useCallback(() => setPhase({ kind: "idle" }), []);

	/* MEMOISED, and that is load-bearing rather than an optimisation: this object
	 *  is a dependency of the screens' callbacks, and a fresh identity every render
	 *  made the detail's `load` re-run in a loop — the screen sat in `loading`
	 *  forever, which the capture caught as "not measurable" (round-2 self-caught
	 *  regression). */
	return useMemo(
		() => ({
			phase,
			count,
			observe,
			ask,
			askTargets,
			askFresh,
			dismissNow,
			reportCountFailed,
			confirm,
			cancel,
			undo,
			clear,
		}),
		[
			phase,
			count,
			observe,
			ask,
			askTargets,
			askFresh,
			dismissNow,
			reportCountFailed,
			confirm,
			cancel,
			undo,
			clear,
		],
	);
}
