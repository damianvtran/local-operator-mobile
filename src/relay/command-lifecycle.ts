/**
 * The command lifecycle barrier: the dispatch-side twin of the private-writer one.
 *
 * Storage writes were not the only thing a sign-out could race. A command's
 * envelope is deleted by `clearAuthorizationData` while `client.command` is still
 * on the wire, and its settlement — success or lost reply — lands afterwards. That
 * is two failures in one: a command the relay accepted can vanish from the retry
 * ledger, and a command whose outcome nobody knows becomes untracked ambiguity
 * instead of the same-ID envelope the reader can replay (review round 2, R1-4).
 *
 * So the unit of work here is the WHOLE operation — envelope hold, HTTP, settle —
 * not the individual storage write inside it. Withdrawal refuses new dispatch and
 * `awaitCommandOperations()` resolves only after every accepted operation has
 * settled. The purge runs between those two, which is the only order in which it
 * can honestly say the old owner left nothing behind.
 *
 * Reopening is deliberately NOT automatic at the end of a purge: it belongs to
 * admission, so "dispatch is open" always means "an authorization is in force".
 */

/**
 * A REFUSAL TO START, expressed in the app's one error vocabulary.
 *
 * It extends `RelayError` rather than `Error` so it can travel through the same
 * non-rejecting `Settled` channel as every other outcome without a second error
 * type: `envelope: "clear"` is the honest classification — nothing reached the
 * wire, so there is nothing to replay and no ambiguity to preserve — and `retry:
 * "never"` keeps a doomed replay from looking like progress.
 */
import { RelayError } from "./errors";

export class DispatchClosedError extends RelayError {
	constructor() {
		super(
			"rejected",
			"Sign-out is in progress, so this message was not sent.",
			{
				diagnostic: "dispatch is closed while sign-out completes",
				/* A stable machine name: the class is the ergonomic check, and this is what
				 * a log or a diagnostic line can carry without instanceof. */
				code: "dispatch-closed",
				retry: "never",
				envelope: "clear",
			},
		);
	}
}

let closed = false;
const operations = new Set<Promise<unknown>>();

/** True once sign-out has withdrawn dispatch. Callers that must distinguish a
 *  refusal-to-start from a delivery failure switch on this class. */
export function isDispatchClosed(error: unknown): error is DispatchClosedError {
	return error instanceof DispatchClosedError;
}

/**
 * Registers a command operation for its WHOLE life. Refuses to start one while the
 * barrier is closed — the caller must not send under an identity that is going away.
 */
export function runCommandOperation<T>(
	operation: () => Promise<T>,
): Promise<T> {
	if (closed) return Promise.reject(new DispatchClosedError());
	const running = operation();
	operations.add(running);
	const settle = () => operations.delete(running);
	running.then(settle, settle);
	return running;
}

/** Whether the barrier is currently closed. Distinct from `isDispatchClosed`,
 *  which narrows an already-thrown error. */
export function isDispatchWithdrawn(): boolean {
	return closed;
}

/** Stop accepting new command operations. Idempotent. */
export function withdrawDispatch(): void {
	closed = true;
}

/** Resolve once every accepted operation has reached its final settle. A tail can
 *  start nothing new while closed, so one pass drains the set; the loop is kept for
 *  the same reason as the writer barrier — a settle may schedule bookkeeping. */
export async function awaitCommandOperations(): Promise<void> {
	while (operations.size > 0) {
		await Promise.allSettled([...operations]);
	}
}

/** A newly admitted owner may dispatch again. Called from admission only. */
export function reopenDispatch(): void {
	closed = false;
}
