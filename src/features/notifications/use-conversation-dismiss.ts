import { useCallback, useRef, useState } from "react";

import type { RelayEndpoints } from "@/relay";

import {
	applyConversationOperation,
	type ConversationScope,
	DISMISS_ALL_COUNT_FAILED,
	DISMISS_ALL_NONE,
	dismissReceiptSentence,
	observeConversationScope,
	receiptComplete,
	type ScopeReceipt,
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
export type ConversationDismissPhase =
	| { kind: "idle" }
	| { kind: "counting"; title: string }
	| { kind: "confirming"; scope: ConversationScope }
	| { kind: "applying"; scope: ConversationScope }
	| {
			kind: "done";
			scope: ConversationScope;
			receipt: ScopeReceipt;
			sentence: string;
			complete: boolean;
	  }
	| { kind: "undoing"; scope: ConversationScope; receipt: ScopeReceipt }
	| { kind: "undone"; sentence: string; complete: boolean }
	| { kind: "none"; sentence: string }
	| { kind: "failed"; sentence: string };

export interface ConversationDismiss {
	phase: ConversationDismissPhase;
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
				: { kind: "confirming", scope },
		);
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
		if (current.kind !== "confirming" || client === null) return;
		const { scope } = current;
		setPhase({ kind: "applying", scope });
		const receipt = await applyConversationOperation(
			(body) => client.patchNotifications(body),
			"dismiss",
			scope.tokens,
			scope,
		);
		setPhase({
			kind: "done",
			scope,
			receipt,
			sentence: dismissReceiptSentence(receipt, scope),
			complete: receiptComplete(receipt, scope.tokens.length),
		});
		onSettled();
	}, [client, onSettled]);

	const undo = useCallback(async () => {
		const current = phaseRef.current;
		if (current.kind !== "done" || client === null) return;
		const { scope, receipt } = current;
		if (receipt.changed.length === 0) return;
		setPhase({ kind: "undoing", scope, receipt });
		const restored = await applyConversationOperation(
			(body) => client.patchNotifications(body),
			"undismiss",
			receipt.changed,
			scope,
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

	return { phase, observe, ask, askFresh, confirm, cancel, undo, clear };
}
