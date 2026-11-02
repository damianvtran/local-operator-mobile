export interface PrivateStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
	keys(): Promise<string[]>;
}
/** Scope is the auth owner's opaque generation AND route identity, never an
 * account label or guessed hostname principal. No migration fallback: old keys
 * have unknown ownership and stay quarantined until an explicit privacy purge. */
export function scopedStore(
	store: PrivateStore,
	scope: string | null,
): PrivateStore {
	const suffix = `:authorization:${encodeURIComponent(scope ?? "")}`;
	return {
		get: (key) =>
			scope === null ? Promise.resolve(null) : store.get(key + suffix),
		/* Both this and `deviceStore` register with the barrier: the scoped store is
		 *  the choke point for per-generation data, the device store for the unscoped
		 *  draft family, and a caller may hold either. Registration is idempotent. */
		set: (key, value) =>
			scope === null
				? Promise.reject(
						new Error("no admitted authorization for private storage"),
					)
				: runPrivateWrite(() => store.set(key + suffix, value)),
		remove: (key) =>
			scope === null
				? Promise.resolve()
				: runPrivateWrite(() => store.remove(key + suffix)),
		keys: async () =>
			scope === null
				? []
				: (await store.keys())
						.filter((key) => key.endsWith(suffix))
						.map((key) => key.slice(0, -suffix.length)),
	};
}

/**
 * The private-writer barrier.
 *
 * Sign-out must be able to say "nothing of the old owner survives" — and it could
 * not, because a draft or envelope write that was already awaiting its filesystem
 * call when retirement began could land AFTER the purge enumerated and deleted the
 * directory (review R1-4, reproduced with a delayed `set`: the key was gone before
 * the write and back after it). Withdrawal closes the gate for new writes and
 * awaiting the tails drains the ones in flight, so the purge sees a quiescent
 * scope. Reopening happens on admission of a new owner, never implicitly.
 */
interface WriterBarrier {
	closed: boolean;
	tails: Set<Promise<unknown>>;
}

const writers: WriterBarrier = { closed: false, tails: new Set() };

/** Every private write goes through this, so the barrier cannot be bypassed by a
 *  caller that forgot to ask. A closed barrier rejects rather than silently
 *  dropping the bytes: the caller's own failure path must report it. */
export function runPrivateWrite<T>(write: () => Promise<T>): Promise<T> {
	if (writers.closed)
		return Promise.reject(
			new Error("private storage is closed while sign-out completes"),
		);
	const operation = write();
	writers.tails.add(operation);
	const settle = () => writers.tails.delete(operation);
	operation.then(settle, settle);
	return operation;
}

/** Stop accepting private writes. Idempotent: retirement may be asked twice. */
export function withdrawPrivateWrites(): void {
	writers.closed = true;
}

/** Resolve once every write that was already running has settled. */
export async function awaitPrivateWrites(): Promise<void> {
	// A tail can schedule another write before the barrier closed; loop until the
	// set is genuinely empty rather than snapshotting once.
	while (writers.tails.size > 0) {
		await Promise.allSettled([...writers.tails]);
	}
}

/** A newly admitted owner may write again. Called from admission, not from a
 *  storage helper, so "open" always means "an authorization is in force". */
export function reopenPrivateWrites(): void {
	writers.closed = false;
}

/** Privacy cleanup cannot use the ordinary store's best-effort enumeration. */
export async function clearPrivateFamilies(store: PrivateStore): Promise<void> {
	for (const key of await store.keys()) {
		if (
			key.startsWith("lo-mobile-draft:") ||
			key.startsWith("lo-mobile-command:")
		)
			await store.remove(key);
	}
}
