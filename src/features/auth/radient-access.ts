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
	const capture = () => {
		const epoch = generation;
		return () => epoch === generation;
	};
	function replace(tokens: RadientTokens | null) {
		generation += 1;
		inFlight = null;
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
				next = await deps.refresh(held);
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
	return { access, replace, persist, retire, capture };
}
