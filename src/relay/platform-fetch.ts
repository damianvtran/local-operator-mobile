/**
 * The platform `fetch`, bound to the global it belongs to.
 *
 * Browsers brand-check `fetch`: `window.fetch` called with any receiver other than
 * the window throws `TypeError: Failed to execute 'fetch' on 'Window': Illegal
 * invocation`, synchronously and before a byte is sent. Storing the function on an
 * object and calling it as `this.fetchImpl(...)` supplies exactly that wrong
 * receiver. Node's undici `fetch` is not brand-checked, so a Node test never sees
 * it, and the failure shows up only on the web target as a `transport` error with
 * zero requests on the wire.
 *
 * Every place that falls back to the global goes through here, so the binding is
 * written once. An injected `fetchImpl` is returned untouched: it is the caller's
 * own function and may not want a receiver forced on it.
 */
export function resolveFetch(
	injected?: typeof globalThis.fetch,
): typeof globalThis.fetch {
	if (injected) return injected;
	if (typeof globalThis.fetch !== "function") {
		throw new Error(
			"no fetch on this runtime: the relay client cannot make requests",
		);
	}
	return globalThis.fetch.bind(globalThis);
}

/** Raised by `readWithDeadline` when the budget is spent before an answer was read. */
export class RequestDeadlineError extends Error {
	override readonly name = "RequestDeadlineError";
}

/**
 * One request to a host OUTSIDE the relay client — Radient's token endpoint and
 * its tunnel list — bounded from dispatch until `read` has consumed the body.
 *
 * Why it exists: the relay client (`relay/http.ts`) has carried a per-request
 * deadline since QA round 4, but the account-level calls made during sign-in did
 * not, and React Native's `fetch` has no timeout of its own. A token exchange or a
 * discovery read that stalled after the browser sheet closed left the sign-in
 * screen on "Signing you in…" with no error and no way out (TestFlight 453
 * report). The budget is TOTAL elapsed time, like the relay client's, because a
 * proxy that sends headers and then stalls the body is an ordinary shape.
 *
 * The abort is passed to `fetch` so the platform drops the socket, AND the read
 * is raced against the deadline: an implementation that ignores the signal must
 * still not hold the caller. A caller's own `signal` aborts the request too.
 */
export async function readWithDeadline<T>(
	fetchImpl: typeof globalThis.fetch,
	url: string,
	init: RequestInit,
	timeoutMs: number,
	read: (response: Response) => Promise<T>,
): Promise<{ response: Response; body: T }> {
	const controller = new AbortController();
	const external = init.signal;
	const onExternalAbort = () => controller.abort();
	/* An `abort` listener added to a signal that is ALREADY aborted never fires,
	 * so a cancelled sign-in still spent its one-time code (PR #178 R1-1). Nothing
	 * is dispatched at all: the caller has already given up on the answer. */
	if (external?.aborted) {
		// A plain Error: Hermes does not guarantee a global `DOMException`.
		const aborted = new Error("This operation was aborted");
		aborted.name = "AbortError";
		throw aborted;
	}
	external?.addEventListener("abort", onExternalAbort, { once: true });
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new RequestDeadlineError(`no answer within ${timeoutMs} ms`));
		}, timeoutMs);
	});
	try {
		return await Promise.race([
			(async () => {
				const response = await fetchImpl(url, {
					...init,
					signal: controller.signal,
				});
				return { response, body: await read(response) };
			})(),
			expired,
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		external?.removeEventListener("abort", onExternalAbort);
	}
}
