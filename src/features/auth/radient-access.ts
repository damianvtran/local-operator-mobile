import type { RadientTokens } from "@/connection/radient-oauth";

/** A transport failure is not evidence that a rolling grant was revoked. */
export class RadientAccessError extends Error {
	readonly kind = "unavailable";
	override readonly name = "RadientAccessError";
}

/**
 * The provider remains the grant owner. This accessor owns only request epochs
 * and durable ordering: a late refresh cannot clear a replacement sign-in, and
 * a clear must run after any credential write already inside platform storage.
 */
export function createRadientAccess(deps: {
	current: () => RadientTokens | null;
	publish: (tokens: RadientTokens | null) => void;
	refresh: (tokens: RadientTokens) => Promise<RadientTokens>;
	write: (tokens: RadientTokens) => Promise<unknown>;
	clear: () => Promise<void>;
	invalidGrant: (error: unknown) => boolean;
	/** Shared with native credential retirement, including across provider mounts. */
	serialize: (operation: () => Promise<void>) => Promise<void>;
	now?: () => number;
}) {
	let generation = 0;
	let inFlight: Promise<string | null> | null = null;
	let rawRefresh: {
		held: RadientTokens;
		promise: Promise<RadientTokens>;
	} | null = null;
	const capture = () => {
		const epoch = generation;
		return () => epoch === generation;
	};
	function replace(tokens: RadientTokens | null) {
		generation += 1;
		inFlight = null;
		rawRefresh = null;
		deps.publish(tokens);
	}
	function persist(tokens: RadientTokens, owned = capture()): Promise<void> {
		return deps.serialize(async () => {
			if (owned()) await deps.write(tokens);
		});
	}
	function retire(clear = deps.clear): Promise<void> {
		replace(null);
		// Never skip an enqueued clear: a newer write queues behind this slot.
		return deps.serialize(clear);
	}
	function refresh(held: RadientTokens): Promise<RadientTokens> {
		// Rolling refresh tokens have one spender even when normal requests are
		// waiting on storage and device retirement cannot join that storage queue.
		if (rawRefresh?.held === held) return rawRefresh.promise;
		const flight = { held, promise: deps.refresh(held) };
		rawRefresh = flight;
		void flight.promise.catch(() => {
			if (rawRefresh === flight) rawRefresh = null;
		});
		return flight.promise;
	}
	/**
	 * Device removal must not wait on the native retirement barrier that is itself
	 * waiting for device removal. Borrow the raw refresh, never its write/clear
	 * lifecycle; final sign-out owns durable cleanup even for invalid_grant.
	 */
	async function retirementAccess(options?: {
		force?: boolean;
	}): Promise<string | null> {
		const held = deps.current();
		if (!held) return null;
		if (!options?.force && held.expires_at > (deps.now ?? Date.now)())
			return held.access;
		if (held.refresh === null) return null;
		const owned = capture();
		try {
			const next = await refresh(held);
			return owned() && next.expires_at > (deps.now ?? Date.now)()
				? next.access
				: null;
		} catch (error) {
			if (!owned() || deps.invalidGrant(error)) return null;
			throw new RadientAccessError(
				"Radient could not refresh the session. Please retry.",
				{ cause: error },
			);
		}
	}

	async function access(options?: { force?: boolean }): Promise<string | null> {
		const held = deps.current();
		if (!held) return null;
		if (!options?.force && held.expires_at > (deps.now ?? Date.now)())
			return held.access;
		if (held.refresh === null) return null;
		if (inFlight) return inFlight;
		const owned = capture();
		const request = (async () => {
			let next: RadientTokens;
			try {
				next = await refresh(held);
			} catch (error) {
				if (!owned()) return null;
				if (deps.invalidGrant(error)) {
					await retire();
					return null;
				}
				throw new RadientAccessError(
					"Radient could not refresh the session. Please retry.",
					{ cause: error },
				);
			}
			if (!owned()) return null;
			deps.publish(next);
			await persist(next, owned);
			return owned() ? next.access : null;
		})();
		inFlight = request;
		try {
			return await request;
		} finally {
			if (inFlight === request) inFlight = null;
		}
	}
	return { access, retirementAccess, replace, persist, retire, capture };
}
