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

export class DispatchClosedError extends Error {
	constructor() {
		super("dispatch is closed while sign-out completes");
		this.name = "DispatchClosedError";
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
