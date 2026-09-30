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
