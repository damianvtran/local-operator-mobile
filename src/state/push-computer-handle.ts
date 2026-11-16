/**
 * The push `computer` handle each saved computer answered at registration.
 *
 * WHY IT EXISTS. Attention and completion pushes name their computer only by an
 * opaque per-account handle (ADR 0006 §3.2 `computer`). It is not a tunnel id,
 * a saved-computer id or a URL, so until core #4050 (v0.106.0) the background
 * task could not tell whether a push was about the computer the app is routed
 * to — and refreshing on a push about ANOTHER computer would spend a wake on
 * the wrong relay. A successful `POST /api/push/register` now returns the same
 * opaque value as `computer_handle`; this module remembers it per account and
 * route, so the background task (`state/warm-sync.ts` `attention`/`completion`)
 * can do a one-shot warm refresh only when the push matches the route in force.
 *
 * THE CONTRACT IT KEEPS
 *
 * - **Only what the daemon said, never an inference.** A registration that
 *   returns a handle records it (replacing any earlier one); a successful
 *   registration WITHOUT one deletes the record — the daemon has no live,
 *   current binding, so no push can be "for" this route. A registration that
 *   did not POST (deduped, refused, failed) leaves the record alone: that says
 *   nothing new about the binding.
 * - **Keyed by account AND route.** `{accountId, routeKey}` where `routeKey` is
 *   `sessionPushRouteKey` (`radient:<tunnel>` / `custom:<base url>`), the same
 *   identity the registration itself is queued and fenced by. An account switch
 *   therefore never reads another account's handle; a forgotten route drops its
 *   records through `forgetRoute`.
 * - **Purged with the warm cache.** The production binding lives in the warm
 *   cache's sealed family (`features/session/warm-store.ts`) under its own key
 *   prefix, so every path that runs `clearWarmCache` — sign-out, a rejected
 *   login, a proven owner change — erases these too, and writes go through the
 *   same private-write barrier (a write racing a sign-out is refused).
 * - **Warm-only.** Reads that fail (the sealed store's key sits in the keychain
 *   under `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, unreadable while locked) are a miss,
 *   not an error: the caller does nothing. An in-memory mirror answers a warm
 *   process without touching storage at all; it is reset with the purge.
 *
 * PURE: the storage port is injected, so Node tests drive the real module.
 */

/** The same port shape as the warm cache's (`WarmStorePort`). */
export interface HandleStorePort {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
	keys(): Promise<string[]>;
}

/** Whose registration answered: the Radient account (`null` on a custom
 *  tunnel) and `sessionPushRouteKey(route)`. */
export interface HandleScope {
	accountId: string | null;
	routeKey: string;
}

export const PUSH_HANDLE_KEY_PREFIX = "lo-mobile-push-handle:";

const keyFor = (scope: HandleScope): string =>
	`${PUSH_HANDLE_KEY_PREFIX}${encodeURIComponent(
		JSON.stringify([scope.accountId, scope.routeKey]),
	)}`;

const scopeOf = (key: string): HandleScope | null => {
	if (!key.startsWith(PUSH_HANDLE_KEY_PREFIX)) return null;
	try {
		const parsed = JSON.parse(
			decodeURIComponent(key.slice(PUSH_HANDLE_KEY_PREFIX.length)),
		) as unknown;
		if (
			Array.isArray(parsed) &&
			parsed.length === 2 &&
			(parsed[0] === null || typeof parsed[0] === "string") &&
			typeof parsed[1] === "string"
		)
			return { accountId: parsed[0], routeKey: parsed[1] };
	} catch {
		/* A key this build cannot read is not ours to interpret. */
	}
	return null;
};

export function createPushHandleStore(port: HandleStorePort) {
	/* `undefined` = not known in this process (ask storage); `null` = known
	 * absent. Successful reads and this module's own writes populate it. */
	const memory = new Map<string, string | null>();
	let generation = 0;
	const routeGeneration = new Map<string, number>();
	/* Records for one key are written in call order; a later registration's
	 * answer must never be overtaken by an earlier one's slower write. */
	let chain: Promise<unknown> = Promise.resolve();
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const next = chain.then(work, work);
		chain = next.catch(() => undefined);
		return next;
	};

	const handles = {
		/**
		 * Record what one successful registration answered. `handle` absent or
		 * empty deletes. `isCurrent` is re-checked when the write is admitted, so
		 * an account switch or route change while queued writes nothing. Never
		 * throws; a refused or failed write keeps the in-memory answer, which is
		 * what the warm process that just registered will consult anyway.
		 */
		async record(
			scope: HandleScope,
			handle: string | null | undefined,
			isCurrent: () => boolean = () => true,
		): Promise<void> {
			const value =
				typeof handle === "string" && handle.length > 0 ? handle : null;
			const key = keyFor(scope);
			// Remember even a queued route so removing the custom slot can fence
			// registrations that have not reached their first private write yet.
			if (!routeGeneration.has(scope.routeKey))
				routeGeneration.set(scope.routeKey, 0);
			const epoch = generation;
			const routeEpoch = routeGeneration.get(scope.routeKey);
			await serial(async () => {
				if (
					!isCurrent() ||
					epoch !== generation ||
					routeEpoch !== routeGeneration.get(scope.routeKey)
				)
					return;
				memory.set(key, value);
				try {
					if (value === null) await port.remove(key);
					else await port.set(key, JSON.stringify({ v: 1, handle: value }));
				} catch {
					/* Locked device or a closed private-write barrier: memory holds. */
				}
			});
		},

		/** The recorded handle for this account and route, or `null`. Never throws. */
		async lookup(scope: HandleScope): Promise<string | null> {
			const key = keyFor(scope);
			const epoch = generation;
			const routeEpoch = routeGeneration.get(scope.routeKey);
			const known = memory.get(key);
			if (known !== undefined) return known;
			try {
				const raw = await port.get(key);
				if (
					raw === null ||
					epoch !== generation ||
					routeEpoch !== routeGeneration.get(scope.routeKey)
				)
					return null;
				const parsed = JSON.parse(raw) as { v?: unknown; handle?: unknown };
				const value =
					parsed.v === 1 &&
					typeof parsed.handle === "string" &&
					parsed.handle.length > 0
						? parsed.handle
						: null;
				// A registration may have answered while this storage read waited.
				// Its in-memory answer is newer, even when its persist was locked.
				if (memory.has(key)) return memory.get(key) ?? null;
				memory.set(key, value);
				return value;
			} catch {
				// Unreadable (locked, undecryptable, malformed) is a miss: NoData.
				return null;
			}
		},

		/** Drop every account's record for a route the reader forgot. Never throws. */
		async forgetRoute(routeKey: string): Promise<void> {
			routeGeneration.set(routeKey, (routeGeneration.get(routeKey) ?? 0) + 1);
			for (const key of memory.keys())
				if (scopeOf(key)?.routeKey === routeKey) memory.set(key, null);
			await serial(async () => {
				let keys: string[] = [];
				try {
					keys = await port.keys();
				} catch {
					return;
				}
				for (const key of keys) {
					if (scopeOf(key)?.routeKey !== routeKey) continue;
					// Known-absent in memory too, so a failed remove still reads as gone.
					memory.set(key, null);
					await port.remove(key).catch(() => undefined);
				}
			});
		},

		/** There is one custom-route slot; forgetting it must also invalidate an
		 * unreadable slot, without needing credentials to recover its old URL. */
		async forgetCustomRoutes(): Promise<void> {
			// Fence known/queued routes BEFORE awaiting storage enumeration.
			const known = new Set(
				[
					...routeGeneration.keys(),
					...[...memory.keys()].flatMap((key) => {
						const route = scopeOf(key)?.routeKey;
						return route ? [route] : [];
					}),
				].filter((route) => route.startsWith("custom:")),
			);
			const pending = [...known].map((route) => handles.forgetRoute(route));
			for (const key of await port.keys().catch(() => [])) {
				const route = scopeOf(key)?.routeKey;
				if (route?.startsWith("custom:") && !known.has(route))
					pending.push(handles.forgetRoute(route));
			}
			await Promise.all(pending);
		},

		/** Forget the in-memory mirror; the purge clears storage itself. */
		forgetMemory(): void {
			generation += 1;
			memory.clear();
		},

		/** Resolves once queued writes settle (tests). */
		settled(): Promise<void> {
			return chain.then(() => undefined);
		},
	};
	return handles;
}

export type PushHandleStore = ReturnType<typeof createPushHandleStore>;
