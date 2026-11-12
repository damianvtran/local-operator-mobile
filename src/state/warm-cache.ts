/**
 * The warm cache: the last frame of a few recent conversations and the last
 * session list, kept so a return to the app (or a relaunch after the OS killed
 * it) paints what the reader was looking at at once, marked not live, while the
 * streams reopen behind it.
 *
 * WHY IT EXISTS. iOS freezes the JS thread seconds after a lock or app switch and
 * the sockets die with it; the gateway rotates every stream at 60 s anyway, so a
 * held background socket is not on the table (`docs/architecture.md` "Streams").
 * What the reader experienced as "the conversation is not synced on open" was an
 * EMPTY store plus a serial reconnect chain. This module removes the empty store;
 * the resume path in `use-session.ts` / `connection-provider.tsx` trims the chain.
 *
 * CONSTRAINTS IT KEEPS
 *
 * - **`version` is never persisted.** The contract forbids comparing a frame's
 *   `version` across connections or storing it (`projection-store.ts` header,
 *   `contract.md` §6.5). A cached frame is stored without it and re-enters the
 *   store through `hydrate()`, which bypasses the fence; the first live frame of
 *   the next connection is authoritative whatever its version.
 * - **A cached entry is only ever read back under the account and computer that
 *   wrote it.** The key carries both (`WarmScope`), so a route switch can never
 *   paint another computer's transcript (`docs/architecture.md` "a route switch
 *   never shows another computer's projection").
 * - **Bounded.** At most {@link WARM_MAX_SESSIONS} conversations and
 *   {@link WARM_BUDGET_BYTES} serialized bytes across the whole family, LRU. The
 *   numbers come from the relay, not a guess: a projection frame is soft-capped
 *   at 700 KB (`local_operator/mobile/projection.py`), so 5 conversations at the
 *   cap plus a list fit in 4 MiB. Invariant: "the last-viewed conversation plus
 *   four recents survive; the family never exceeds the budget". A single entry
 *   larger than the budget is not cached at all.
 * - **Validated on the way back in.** A stored value runs through the same
 *   contract parsers as the wire. A schema miss or a read/decrypt failure is a
 *   silent cache miss: the entry is deleted and the caller continues as if
 *   nothing was cached (one `console.warn`, no UI). A cache must never be the
 *   reason a screen fails.
 * - **Pure.** No React Native import: the storage port is injected, so the Node
 *   tests drive the real module. The production binding (encrypted native store,
 *   memory-only web adapter, purge registration) is `features/session/warm-store.ts`.
 */

import type { SessionListFrame, SessionProjection } from "../contracts";
import { safeParsePayload } from "../contracts/parse";

/** The storage port: the same shape as `device-storage.ts`'s `DeviceStore`, so the
 *  native sealed store and an in-memory map both satisfy it directly. */
export interface WarmStorePort {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
	keys(): Promise<string[]>;
}

/** Who a cached value belongs to: the Radient account (or `null` for a custom
 *  tunnel, which has no account) and the durable route identity
 *  (`StartupRouteAdmission.routeKey`). Never `snapshot.revision`: that is a
 *  per-process counter and would never match after a relaunch. */
export interface WarmScope {
	accountId: string | null;
	routeKey: string;
}

export const WARM_KEY_PREFIX = "lo-mobile-warm:";
/** See the header: five conversations at the relay's 700 KB frame soft cap,
 *  plus the list, fit. */
export const WARM_MAX_SESSIONS = 5;
export const WARM_BUDGET_BYTES = 4 * 1024 * 1024;
const SCHEMA = 1;
const INDEX_KEY = `${WARM_KEY_PREFIX}index`;

export interface WarmSession {
	savedAt: number;
	projection: SessionProjection;
}

export interface WarmList {
	savedAt: number;
	frame: SessionListFrame;
}

interface IndexEntry {
	key: string;
	kind: "session" | "list";
	bytes: number;
	at: number;
}

const scopeId = (scope: WarmScope): string =>
	encodeURIComponent(JSON.stringify([scope.accountId, scope.routeKey]));
const sessionKey = (scope: WarmScope, sessionId: string): string =>
	`${WARM_KEY_PREFIX}${scopeId(scope)}:session:${encodeURIComponent(sessionId)}`;
const listKey = (scope: WarmScope): string =>
	`${WARM_KEY_PREFIX}${scopeId(scope)}:list`;

export interface WarmCacheOptions {
	now?: () => number;
	maxSessions?: number;
	budgetBytes?: number;
	warn?: (message: string, cause?: unknown) => void;
}

export function createWarmCache(
	store: WarmStorePort,
	options: WarmCacheOptions = {},
) {
	const now = options.now ?? Date.now;
	const maxSessions = options.maxSessions ?? WARM_MAX_SESSIONS;
	const budget = options.budgetBytes ?? WARM_BUDGET_BYTES;
	const warn =
		options.warn ??
		((message: string, cause?: unknown) => console.warn(message, cause));
	/* Index mutations are read-modify-write over one key; two saves racing (a
	 * turn end and a background in the same tick) would otherwise lose an entry
	 * from the index and leak its bytes past the budget. One chain serialises
	 * them; a failed step never wedges the next. */
	let chain: Promise<unknown> = Promise.resolve();
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const next = chain.then(work, work);
		chain = next.catch(() => undefined);
		return next;
	};

	async function readIndex(): Promise<IndexEntry[]> {
		try {
			const raw = await store.get(INDEX_KEY);
			if (raw === null) return [];
			const parsed = JSON.parse(raw) as { schema?: number; entries?: unknown };
			if (parsed.schema !== SCHEMA || !Array.isArray(parsed.entries)) return [];
			return parsed.entries.filter(
				(entry): entry is IndexEntry =>
					typeof entry === "object" &&
					entry !== null &&
					typeof (entry as IndexEntry).key === "string" &&
					typeof (entry as IndexEntry).bytes === "number" &&
					typeof (entry as IndexEntry).at === "number" &&
					((entry as IndexEntry).kind === "session" ||
						(entry as IndexEntry).kind === "list"),
			);
		} catch (cause) {
			warn("[warm-cache] the index could not be read; starting empty", cause);
			return [];
		}
	}

	/** Writes `value` under `key` and records it most-recent-first, then evicts
	 *  down to the bounds. The entry just written is never its own victim. */
	function put(key: string, kind: IndexEntry["kind"], value: string) {
		return serial(async () => {
			const bytes = value.length;
			if (bytes > budget) {
				warn(`[warm-cache] a ${kind} of ${bytes} bytes exceeds the budget`);
				return false;
			}
			await store.set(key, value);
			const index = (await readIndex()).filter((entry) => entry.key !== key);
			index.unshift({ key, kind, bytes, at: now() });
			const keep: IndexEntry[] = [];
			const evict: IndexEntry[] = [];
			let sessions = 0;
			let total = 0;
			for (const entry of index) {
				const overCount = entry.kind === "session" && sessions >= maxSessions;
				if (overCount || total + entry.bytes > budget) {
					evict.push(entry);
					continue;
				}
				if (entry.kind === "session") sessions += 1;
				total += entry.bytes;
				keep.push(entry);
			}
			await store.set(
				INDEX_KEY,
				JSON.stringify({ schema: SCHEMA, entries: keep }),
			);
			for (const entry of evict) await store.remove(entry.key).catch(() => {});
			return true;
		});
	}

	async function forget(key: string): Promise<void> {
		await serial(async () => {
			await store.remove(key).catch(() => {});
			const index = await readIndex();
			const next = index.filter((entry) => entry.key !== key);
			if (next.length !== index.length)
				await store.set(
					INDEX_KEY,
					JSON.stringify({ schema: SCHEMA, entries: next }),
				);
		}).catch(() => {});
	}

	/** Reads and validates one record. Anything wrong — unreadable, undecryptable,
	 *  wrong schema, a frame the contract refuses — is a miss and the entry goes. */
	async function load<T>(
		key: string,
		validate: (record: Record<string, unknown>) => T | null,
	): Promise<T | null> {
		let raw: string | null;
		try {
			raw = await store.get(key);
		} catch (cause) {
			warn(
				"[warm-cache] an entry could not be read; treating it as a miss",
				cause,
			);
			await forget(key);
			return null;
		}
		if (raw === null) return null;
		try {
			const record = JSON.parse(raw) as Record<string, unknown>;
			if (record.schema !== SCHEMA || typeof record.savedAt !== "number")
				throw new Error("unknown warm-cache schema");
			const value = validate(record);
			if (value === null)
				throw new Error("the cached frame failed the contract");
			return value;
		} catch (cause) {
			warn("[warm-cache] a cached entry was invalid and was dropped", cause);
			await forget(key);
			return null;
		}
	}

	return {
		/** Stores the last frame of a conversation, without its `version`. Never
		 *  throws: a failed save is a cache that stays cold, not an error. */
		async saveSession(
			scope: WarmScope,
			sessionId: string,
			projection: SessionProjection,
		): Promise<boolean> {
			const { version: _version, ...rest } = projection;
			const value = JSON.stringify({
				schema: SCHEMA,
				savedAt: now(),
				projection: rest,
			});
			return put(sessionKey(scope, sessionId), "session", value).catch(
				(cause) => {
					warn("[warm-cache] a conversation could not be saved", cause);
					return false;
				},
			);
		},

		async loadSession(
			scope: WarmScope,
			sessionId: string,
		): Promise<WarmSession | null> {
			return load(sessionKey(scope, sessionId), (record) => {
				/* `version: 0` only so the frame satisfies the wire schema; it never
				 * reaches a fence (`hydrate()` does not consult one) and the store
				 * records `version: null` for a hydrated entry. */
				const parsed = safeParsePayload("sessionProjection", {
					...(record.projection as object),
					version: 0,
				});
				return parsed.ok
					? { savedAt: record.savedAt as number, projection: parsed.data }
					: null;
			});
		},

		async saveList(
			scope: WarmScope,
			frame: SessionListFrame,
		): Promise<boolean> {
			const value = JSON.stringify({ schema: SCHEMA, savedAt: now(), frame });
			return put(listKey(scope), "list", value).catch((cause) => {
				warn("[warm-cache] the session list could not be saved", cause);
				return false;
			});
		},

		async loadList(scope: WarmScope): Promise<WarmList | null> {
			return load(listKey(scope), (record) => {
				const parsed = safeParsePayload("sessionListFrame", record.frame);
				return parsed.ok
					? { savedAt: record.savedAt as number, frame: parsed.data }
					: null;
			});
		},

		/** Every warm key, every scope. The sign-out / rejected-login purge. */
		async clear(): Promise<void> {
			await serial(async () => {
				for (const key of await store.keys())
					if (key.startsWith(WARM_KEY_PREFIX)) await store.remove(key);
			});
		},

		/** Resolves once every queued write has settled; tests and the purge use it. */
		settled(): Promise<void> {
			return chain.then(() => undefined);
		},
	};
}

export type WarmCache = ReturnType<typeof createWarmCache>;

/** The web adapter: memory only, by design. `localStorage` is ~5 MB per origin
 *  and one frame can be 700 KB, so persisting there would push drafts and retry
 *  envelopes into their own memory fallback (`device-storage.ts`). */
export function memoryWarmStore(): WarmStorePort & { size(): number } {
	const map = new Map<string, string>();
	return {
		get: async (key) => map.get(key) ?? null,
		set: async (key, value) => {
			map.set(key, value);
		},
		remove: async (key) => {
			map.delete(key);
		},
		keys: async () => [...map.keys()],
		size: () => map.size,
	};
}
