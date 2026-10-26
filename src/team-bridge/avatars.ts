/**
 * Team Bridge profile photos: which bytes to ask for, and the bounded memory
 * cache that holds them.
 *
 * WHY BYTES, NOT A URL. The avatar route (`GET /v1/accounts/{id}/avatar`)
 * requires the Radient bearer, and an image view cannot be trusted to send it:
 * React Native's `Image` `source.headers` is ignored by the web target and is
 * applied unevenly by the native image loaders' own caches, and a header-less
 * retry would be a 401 that renders as a broken photo. So the hub client reads
 * the bytes with the bearer (`client.avatarBytes`) and the view is handed an
 * in-memory `data:` URI, the same shape the relay's transcript images use
 * (`src/features/session/runtime.ts`). A provider URL is never requested: the
 * hub re-encodes provider photos and serves only its own copy.
 *
 * THE CACHE CONTRACT (agent-server `docs/ACCOUNT-PROFILE.md` §8):
 *
 * - Keyed on account + content hash + size. The hash comes from the directory's
 *   hash-pinned `avatar_url`, so a new photo is a new key and the old bytes are
 *   never shown for it.
 * - One cache per signed-in account. `TeamBridgeProvider` re-creates its value
 *   (and so this cache) whenever the Radient account changes, and calls
 *   `clear()` on sign-out, so nothing decoded for one account is shown to the
 *   next. `clear()` also retires in-flight reads: a read started before it
 *   resolves into nothing.
 * - Bounded in entries AND bytes, least recently used first. A crowded list
 *   that cannot make room renders initials rather than growing the heap.
 * - A failure is remembered. A 404 (no photo, or not readable) and an
 *   undecodable answer stay failed for that hash; a network failure is retried
 *   only after a cool-down. Scrolling a list of people with no photos must not
 *   become a request per row per render.
 *
 * No account id, hash or byte is ever logged from here.
 */

import { isHubError } from "@/team-bridge/client";
import type { DirectoryMember } from "@/team-bridge/contract";
import { AVATAR_PATH } from "@/team-bridge/contract";

/** Rows use the 64 px variant, the profile card the 256 px one (§2). */
export type AvatarPixels = 64 | 256;

/**
 * The account id and content hash to read for one directory row, or `null`
 * when there is no photo to read.
 *
 * Refuses a row whose `avatar_url` names a DIFFERENT account than the row, or
 * whose profile hash disagrees with the URL's: showing one person's bytes on
 * another person's row is the failure this exists to make impossible.
 */
export function avatarVersion(
	member: DirectoryMember | undefined | null,
): { accountId: string; hash: string } | null {
	if (!member?.avatar_url) return null;
	const match = AVATAR_PATH.exec(member.avatar_url);
	if (!match) return null;
	const [, accountId, hash] = match;
	if (!accountId || !hash || accountId !== member.account_id) return null;
	const profileHash = member.profile?.avatar?.hash;
	if (profileHash && profileHash !== hash) return null;
	return { accountId, hash };
}

export const avatarKey = (
	accountId: string,
	hash: string,
	size: AvatarPixels,
): string => `${accountId}:${hash}:${size}`;

/** Why a read failed, as far as the cache's retry policy cares. */
export type AvatarFailure = "permanent" | "transient";

/**
 * A 404 (no photo / not readable), a refusal or bytes this build cannot read
 * will answer the same way next time for the same hash: permanent. No answer,
 * a rate limit or a server fault may clear: transient, retried after the
 * cool-down. An unclassified throw is treated as transient so a bug never
 * hides a photo for the rest of the session.
 */
const retryAfterOf = (error: unknown): number | null =>
	isHubError(error) ? error.retryAfterMs : null;

export function avatarFailure(error: unknown): AvatarFailure {
	if (!isHubError(error)) return "transient";
	switch (error.kind) {
		case "unreachable":
		case "rate_limited":
		case "unavailable":
		case "server":
			return "transient";
		default:
			return "permanent";
	}
}

type Entry =
	| { state: "ready"; uri: string; bytes: number }
	| { state: "loading"; promise: Promise<string | null> }
	| { state: "failed"; retryAt: number; permanent: boolean };

/** A read waiting for a slot: run it when one frees, or settle it on `clear()`. */
type Waiter = { run: () => void; cancel: () => void };

/* `account:hash:size`, as `avatarKey` builds it; anything else has no sibling. */
const SIZED_KEY = /^(.*):(64|256)$/;
const SIZES: readonly AvatarPixels[] = [64, 256];

export interface AvatarCacheOptions {
	/** Most entries held, photos and remembered failures together. */
	maxEntries?: number;
	/** Most `data:` URI characters held across ready entries. */
	maxBytes?: number;
	/** How long a network failure is remembered before one more try. */
	transientCooldownMs?: number;
	now?: () => number;
}

/*
 * 64 px variants are ~3 KB and 256 px ones a few tens of KB (§2), ~1.33× as
 * base64. 4 MiB of URIs holds a full organization's row photos plus a handful
 * of card photos; 200 entries bounds the map itself, failures included. The
 * client refuses a body over `AVATAR_MAX_BYTES` (~1.4 MiB as a URI), so one
 * valid photo always fits; a URI over the whole budget is refused below anyway.
 */
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TRANSIENT_COOLDOWN_MS = 60_000;

export function createAvatarCache(options: AvatarCacheOptions = {}) {
	const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const cooldown = options.transientCooldownMs ?? DEFAULT_TRANSIENT_COOLDOWN_MS;
	const now = options.now ?? Date.now;
	/* Map iteration order is insertion order: re-inserting on use makes the
	 * first key the least recently used, which is all an LRU needs. */
	const entries = new Map<string, Entry>();
	let heldBytes = 0;
	/* Bumped by `clear()`. A read that started under an older epoch resolves
	 * to its caller but is never stored. */
	let epoch = 0;
	/*
	 * Reads refused because every slot is an outstanding read. They wait, FIFO,
	 * and one is started each time a read settles, so an organization with more
	 * photos than slots fills in as reads finish instead of leaving the overflow
	 * on initials until the screen remounts. The queue holds closures, not
	 * bytes, and only one per mounted mark.
	 */
	const waiters: Waiter[] = [];
	const wakeOne = () => {
		waiters.shift()?.run();
	};

	const remove = (key: string) => {
		const entry = entries.get(key);
		if (entry?.state === "ready") heldBytes -= entry.bytes;
		entries.delete(key);
	};

	const touch = (key: string, entry: Entry) => {
		entries.delete(key);
		entries.set(key, entry);
	};

	/** Evict settled entries, oldest first, until `incoming` more fits. */
	const makeRoom = (
		incomingEntries: number,
		incomingBytes: number,
	): boolean => {
		for (const [key, entry] of entries) {
			if (
				entries.size + incomingEntries <= maxEntries &&
				heldBytes + incomingBytes <= maxBytes
			)
				return true;
			// An outstanding read keeps its slot: evicting it would let a fast
			// scroll commission unbounded simultaneous requests.
			if (entry.state === "loading") continue;
			remove(key);
		}
		return (
			entries.size + incomingEntries <= maxEntries &&
			heldBytes + incomingBytes <= maxBytes
		);
	};

	const remember = (key: string, retryAt: number, permanent: boolean) => {
		remove(key);
		if (!makeRoom(1, 0)) return;
		entries.set(key, { state: "failed", retryAt, permanent });
	};

	/**
	 * Remember that `key` cannot be shown. Also called by the view when the
	 * image decoder rejects bytes the sniff accepted, so a corrupt photo falls
	 * back to initials once instead of being re-read on every mount.
	 *
	 * A PERMANENT failure also marks the other size of the same account and
	 * hash: the hub's 404 ("no photo, or not yours to read") does not depend on
	 * size, so the card's 256 px read after a row's 64 px 404 would only repeat
	 * it. A sibling already shown or in flight is left alone. A transient
	 * failure stays per key: one size timing out says nothing about the other.
	 *
	 * `retryAfterMs` is the hub's `Retry-After`, when it sent one: the honest
	 * cool-down for a 429, in place of the fixed one.
	 */
	const fail = (
		key: string,
		failure: AvatarFailure,
		retryAfterMs?: number | null,
	): void => {
		if (failure === "transient") {
			remember(key, now() + (retryAfterMs ?? cooldown), false);
			return;
		}
		remember(key, Number.POSITIVE_INFINITY, true);
		const sized = SIZED_KEY.exec(key);
		if (!sized) return;
		for (const size of SIZES) {
			const sibling = `${sized[1]}:${size}`;
			if (sibling === key) continue;
			const state = entries.get(sibling)?.state;
			if (state === "ready" || state === "loading") continue;
			remember(sibling, Number.POSITIVE_INFINITY, true);
		}
	};

	const load = (
		key: string,
		fetchUri: () => Promise<string>,
		classify: (error: unknown) => AvatarFailure,
	): Promise<string | null> => {
		const held = entries.get(key);
		if (held?.state === "ready") {
			touch(key, held);
			return Promise.resolve(held.uri);
		}
		if (held?.state === "loading") return held.promise;
		if (held?.state === "failed") {
			if (now() < held.retryAt) return Promise.resolve(null);
			remove(key);
		}
		if (!makeRoom(1, 0)) {
			// Every slot is an outstanding read: wait for one to settle.
			return new Promise((resolve) => {
				waiters.push({
					run: () => resolve(load(key, fetchUri, classify)),
					cancel: () => resolve(null),
				});
			});
		}
		const started = epoch;
		const promise = fetchUri()
			.then(
				(uri) => {
					if (started !== epoch) return uri;
					remove(key);
					/* A URI over the WHOLE budget is refused before anything is
					 * evicted: storing it would empty the cache and still not fit,
					 * and not remembering it would refetch it on every mount. */
					if (uri.length > maxBytes) {
						fail(key, "permanent");
						return null;
					}
					if (!makeRoom(1, uri.length)) return uri;
					heldBytes += uri.length;
					entries.set(key, { state: "ready", uri, bytes: uri.length });
					return uri;
				},
				(error: unknown) => {
					if (started !== epoch) return null;
					remove(key);
					fail(key, classify(error), retryAfterOf(error));
					return null;
				},
			)
			.finally(() => {
				if (started === epoch) wakeOne();
			});
		entries.set(key, { state: "loading", promise });
		return promise;
	};

	return {
		/** A held photo's URI, without starting a read. */
		peek(key: string): string | null {
			const entry = entries.get(key);
			if (entry?.state !== "ready") return null;
			touch(key, entry);
			return entry.uri;
		},

		/**
		 * The photo for `key`: the held one, the read already in flight, or a new
		 * read through `fetchUri`. Resolves `null` (render initials) for a
		 * remembered failure, a failed read, or a URI too large to hold. When
		 * every slot is an outstanding read it waits for one to settle.
		 *
		 * `fetchUri` rejects with a classified failure; anything that is not
		 * `"transient"` is treated as permanent for this key.
		 */
		load,

		fail,

		/** Sign-out / account change: nothing held survives, nothing in flight lands. */
		clear(): void {
			epoch += 1;
			entries.clear();
			heldBytes = 0;
			// Queued reads belong to the old account: settle them, never run them.
			for (const waiter of waiters.splice(0)) waiter.cancel();
		},

		/** For tests and diagnostics: counts only, never keys or bytes. */
		stats(): { entries: number; bytes: number } {
			return { entries: entries.size, bytes: heldBytes };
		},
	};
}

export type AvatarCache = ReturnType<typeof createAvatarCache>;
