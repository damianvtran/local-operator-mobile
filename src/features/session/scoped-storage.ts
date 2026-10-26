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
		set: (key, value) =>
			scope === null
				? Promise.reject(
						new Error("no admitted authorization for private storage"),
					)
				: store.set(key + suffix, value),
		remove: (key) =>
			scope === null ? Promise.resolve() : store.remove(key + suffix),
		keys: async () =>
			scope === null
				? []
				: (await store.keys())
						.filter((key) => key.endsWith(suffix))
						.map((key) => key.slice(0, -suffix.length)),
	};
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
