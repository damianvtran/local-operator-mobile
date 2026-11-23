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
 * - An endpoint hash versions bytes, not access. Held bytes are displayable
 *   only for `ENDPOINT_PHOTO_FRESH_MS` after an authorized 200/304 for this
 *   account (this cache's epoch); past that they are only a validator for the
 *   next authorized read. A refusal (404, 401) withdraws them at once, and
 *   `clear()` on account change drops them.
 * - Visible rows can withdraw queued reads; foreground marks outrank the row
 *   queue. Concurrency and a separate rolling request budget protect the
 *   shared hub bucket even if responses arrive instantly.
 * - A failure is remembered. A 404 (no photo, or not readable) and an
 *   undecodable answer stay failed for that hash; a network failure is retried
 *   only after a cool-down. Scrolling a list of people with no photos must not
 *   become a request per row per render.
 *
 * No account id, hash or byte is ever logged from here.
 */

import { isHubError } from "@/team-bridge/client";
import type { DirectoryAgent, DirectoryMember } from "@/team-bridge/contract";
import { AVATAR_PATH, ENDPOINT_AVATAR_PATH } from "@/team-bridge/contract";

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

/**
 * An agent is an endpoint identity, never its owner's account-photo identity.
 * An omitted URL may be rebuilt from valid own metadata; an invalid-present
 * URL (the schema's null sentinel) or any disagreement refuses the image.
 */
export function endpointAvatarVersion(
	agent: DirectoryAgent | null | undefined,
): { endpointId: string; hash: string } | null {
	if (!agent?.avatar) return null;
	const { endpoint_id: endpointId, avatar } = agent;
	const canonical = `/v1/messaging/endpoints/${endpointId}/avatar?v=${avatar.hash}`;
	if (!ENDPOINT_AVATAR_PATH.test(canonical)) return null;
	if (agent.avatar_url !== undefined && agent.avatar_url !== canonical)
		return null;
	return { endpointId, hash: avatar.hash };
}

/** Separate namespace even when an account and endpoint share an opaque id. */
export const endpointAvatarKey = (
	endpointId: string,
	hash: string,
	size: AvatarPixels,
): string => `endpoint:${endpointId}:${hash}:${size}`;

// Four parts distinguish an endpoint key from an account literally named
// "endpoint". Derive retention from the identity, so queue recursion and an
// accidental legacy load() call cannot turn a private endpoint into ready cache.
const ENDPOINT_KEY = /^endpoint:[A-Za-z0-9_-]{1,128}:[0-9a-f]{16}:(64|256)$/;

export type EndpointAvatarSnapshot = {
	cache: object;
	epoch: number;
	key: string;
	uri: string | null;
};

/**
 * Check during render, not just in effect cleanup. A new principal, endpoint,
 * hash, variant or absent metadata must paint the glyph on its very first frame.
 * This pure boundary is also testable without pretending Node drives native UI.
 */
export function endpointDisplayUri(
	held: EndpointAvatarSnapshot | null,
	cache: object,
	epoch: number,
	key: string | null,
): string | null {
	return key &&
		ENDPOINT_KEY.test(key) &&
		held?.cache === cache &&
		held.epoch === epoch &&
		held.key === key
		? held.uri
		: null;
}

/** Why a read failed, as far as the cache's retry policy cares. */
export type AvatarFailure = "permanent" | "transient";

/**
 * A 404 (no photo / not readable), a refusal or bytes this build cannot read
 * will answer the same way next time for the same hash: permanent. No answer,
 * a rate limit or a server fault may clear: transient, retried after the
 * cool-down. An unclassified throw is treated as transient so a bug never
 * hides a photo for the rest of the session.
 */
/*
 * The longest the hub's `Retry-After` may hide a photo. Unbounded, a huge
 * delta-seconds value or a far-future HTTP-date would leave it on initials for
 * the whole session (review round 2, R2-2). Ten minutes is long enough to
 * respect a real rate limit, short enough that a mistake heals in one sitting.
 */
export const AVATAR_RETRY_AFTER_MAX_MS = 10 * 60_000;

/**
 * The cool-down after a transient failure: the hub's `Retry-After` clamped to
 * the ceiling above, or the default when absent. Zero (the client's clamp of a
 * negative or past value) takes the default too, because a zero wait would
 * re-request on every remount during a 429.
 */
export function transientDelay(
	retryAfterMs: number | null | undefined,
	fallbackMs: number,
): number {
	if (
		retryAfterMs == null ||
		!Number.isFinite(retryAfterMs) ||
		retryAfterMs <= 0
	)
		return fallbackMs;
	return Math.min(retryAfterMs, AVATAR_RETRY_AFTER_MAX_MS);
}

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

/**
 * Endpoint permissions can recover without changing the photo hash (rejoin,
 * resume, sign-in). Keep those negative results only for the bounded transient
 * cooldown/Retry-After, while corrupt bytes and decoder failures stay permanent.
 * The account-photo policy above is intentionally unchanged.
 */
export function endpointAvatarFailure(error: unknown): AvatarFailure {
	if (endpointRefusal(error)) return "transient";
	return avatarFailure(error);
}

/*
 * The hub's answer that this account may not (or no longer) read the endpoint's
 * photo. Access does not depend on size, so `load` also withdraws the other
 * size's display on one (review R3-1); a 5xx, 429 or timeout says nothing
 * about access and leaves the other size alone.
 */
const endpointRefusal = (error: unknown): boolean =>
	isHubError(error) &&
	error.status !== null &&
	[401, 403, 404].includes(error.status);

type Entry =
	| {
			state: "ready";
			uri: string;
			bytes: number;
			etag: string | null;
			/** When an authorized read last answered 200/304 for this key. */
			verifiedAt: number;
	  }
	| { state: "loading"; promise: Promise<string | null>; bytes: number }
	| { state: "failed"; retryAt: number; permanent: boolean };

/** A read waiting for a slot: run it when one frees, or settle it on `clear()`. */
type Waiter = { run: () => void; cancel: () => void; priority: number };
type PhotoResult = string | { uri: string; etag: string | null } | null;
type ReadOptions = {
	signal?: AbortSignal;
	row?: boolean;
	/** `fetchUri` reports each dispatched request through its `onRequest`. */
	metered?: boolean;
};
type FetchUri = (etag?: string, onRequest?: () => void) => Promise<PhotoResult>;

const READ_WINDOW_MS = 60_000;
/*
 * TestFlight 1157: 119 photo GETs exhausted the hub's 120/min read bucket.
 * Photos get half of it; the other half is the directory, settings and every
 * other foreground read (review R1-2). The budget is counted in HTTP REQUESTS,
 * each held until a full window after its read settles.
 *
 * A read may send two requests (the client's one 401-refresh retry), so it is
 * admitted only with two free and holds both while in flight; once it settles,
 * a metered read keeps only the requests it actually sent. Round 2 counted
 * every read as two (U5/D4: 30 photos a minute). Measured on that head:
 * reviewer R2 loopback, n=30 reads on a valid bearer, 30 requests (1 each,
 * median 1, max 1); QA R2's forced-401 fixture, n=30 reads, 60 requests
 * (max 2). So a valid session gets ~60 photos a minute, and the all-401
 * worst case is still capped at 60 requests, never more than half the bucket.
 * Invariant: requests reserved in any trailing window >= photo requests sent
 * in it, and <= PHOTO_REQUESTS_PER_WINDOW (avatar-fanout.test.ts).
 */
export const PHOTO_REQUESTS_PER_WINDOW = 120 / 2;
const REQUESTS_PER_READ = 2;
/*
 * How long an authorized endpoint-photo read stays displayable without a new
 * one (U5/D4: a row scrolled past and back, or a reopened drawer, sat on the
 * glyph for 51-53 s waiting for a read slot). Equal to the store's
 * `DIRECTORY_TTL_MS` (not imported: the store imports this module): the
 * directory entry that tells the phone this account may see this agent is
 * itself reused that long without re-asking, so trusting the photo read no
 * longer than that adds no staleness the list does not already have. A 404 or
 * 401 from any read of either size of the key withdraws it before then. Invariant: endpoint
 * bytes are shown only within this window of a 200/304 in the current epoch
 * (endpoint-avatars.test.ts, "displays a verified photo for the freshness
 * window only").
 */
export const ENDPOINT_PHOTO_FRESH_MS = 5 * 60_000;

/* `account:hash:size`, as `avatarKey` builds it; anything else has no sibling. */
const SIZED_KEY = /^(.*):(64|256)$/;
const SIZES: readonly AvatarPixels[] = [64, 256];

export interface AvatarCacheOptions {
	/** Most entries held, photos and remembered failures together. */
	maxEntries?: number;
	/** Most `data:` URI characters held across ready entries. */
	maxBytes?: number;
	/** Most reads outstanding at once; the rest wait their turn. */
	maxInFlight?: number;
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
/*
 * Four keeps a screenful of photos arriving within a few round trips while a
 * 100-agent organization drains as a trickle, not a burst, against the shared
 * 120/min `reads` bucket. Hub variants are a few KB, so latency, not bandwidth,
 * is what a higher number would buy.
 */
export const AVATAR_MAX_IN_FLIGHT = 4;

export function createAvatarCache(options: AvatarCacheOptions = {}) {
	const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const maxInFlight = Math.max(1, options.maxInFlight ?? AVATAR_MAX_IN_FLIGHT);
	const cooldown = options.transientCooldownMs ?? DEFAULT_TRANSIENT_COOLDOWN_MS;
	const now = options.now ?? Date.now;
	/* Map iteration order is insertion order: re-inserting on use makes the
	 * first key the least recently used, which is all an LRU needs. */
	const entries = new Map<string, Entry>();
	let heldBytes = 0;
	/* Bumped by `clear()`. A read that started under an older epoch resolves
	 * to its caller but is never stored. */
	let epoch = 0;
	/* Reads started and not yet settled, so `wakeOne` can tell whether a woken
	 * waiter took a slot. */
	let inFlight = 0;
	const waiters: Waiter[] = [];
	const reservations = new Set<{ until: number }>();
	const epochListeners = new Set<() => void>();
	let wakeTimer: ReturnType<typeof setTimeout> | undefined;
	let throttledUntil = 0;
	const nextReadAt = () => {
		const at = now();
		for (const reservation of reservations) {
			if (reservation.until <= at) reservations.delete(reservation);
		}
		// A new read needs room for its worst case; otherwise it waits until
		// enough reservations expire (Infinity: until in-flight reads settle).
		const short =
			reservations.size + REQUESTS_PER_READ - PHOTO_REQUESTS_PER_WINDOW;
		const budgetAt =
			short <= 0
				? at
				: (Array.from(reservations, (reservation) => reservation.until).sort(
						(a, b) => a - b,
					)[short - 1] ?? Number.POSITIVE_INFINITY);
		return Math.max(throttledUntil, budgetAt);
	};
	const cancelWake = () => {
		clearTimeout(wakeTimer);
		wakeTimer = undefined;
	};
	const wake = () => {
		cancelWake();
		while (waiters.length && inFlight < maxInFlight) {
			const due = nextReadAt();
			if (due > now()) {
				if (Number.isFinite(due)) wakeTimer = setTimeout(wake, due - now());
				return;
			}
			if (!makeRoom(1, 0)) return;
			waiters.shift()?.run();
		}
	};

	const remove = (key: string) => {
		const entry = entries.get(key);
		if (entry && entry.state !== "failed") heldBytes -= entry.bytes;
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
			remember(key, now() + transientDelay(retryAfterMs, cooldown), false);
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

	/*
	 * After a refusal of one size, the other size's held photo is no longer
	 * authorized either. Expire its freshness rather than dropping it: the bytes
	 * and ETag stay a validator, so the next read can still answer 304, but
	 * `peekEndpoint` and `load` no longer display them without that read
	 * (review R3-1). A sibling in flight settles on its own answer.
	 */
	const expireSibling = (key: string): void => {
		const sized = SIZED_KEY.exec(key);
		if (!sized) return;
		for (const size of SIZES) {
			const name = `${sized[1]}:${size}`;
			if (name === key) continue;
			const sibling = entries.get(name);
			if (sibling?.state === "ready")
				sibling.verifiedAt = Number.NEGATIVE_INFINITY;
		}
	};

	/* A plain boolean, not a type guard: its false branch must not narrow
	 * "ready" away from callers that still read a stale entry as a validator. */
	const fresh = (entry: Entry | undefined): boolean =>
		entry?.state === "ready" &&
		now() - entry.verifiedAt < ENDPOINT_PHOTO_FRESH_MS;

	const load = (
		key: string,
		fetchUri: FetchUri,
		classify: (error: unknown) => AvatarFailure,
		options: ReadOptions = {},
		fromQueue = false,
	): Promise<string | null> => {
		const { signal } = options;
		if (signal?.aborted) return Promise.resolve(null);
		const endpoint = ENDPOINT_KEY.test(key);
		const held = entries.get(key);
		if (held?.state === "ready" && (!endpoint || fresh(held))) {
			// Re-entering rows reuse a current authorization and spend no budget.
			touch(key, held);
			return Promise.resolve(held.uri);
		}
		if (held?.state === "loading") return held.promise;
		if (held?.state === "failed" && now() < held.retryAt)
			return Promise.resolve(null);
		if (
			(!fromQueue && waiters.length > 0) ||
			inFlight >= maxInFlight ||
			nextReadAt() > now() ||
			(held === undefined && !makeRoom(1, 0))
		) {
			return new Promise((resolve) => {
				const detach = () => signal?.removeEventListener("abort", cancel);
				const cancel = () => {
					detach();
					const index = waiters.indexOf(waiter);
					if (index !== -1) waiters.splice(index, 1);
					if (waiters.length === 0) cancelWake();
					resolve(null);
				};
				const waiter: Waiter = {
					priority: options.row ? 0 : 1,
					run: () => {
						detach();
						resolve(load(key, fetchUri, classify, options, true));
					},
					cancel,
				};
				// A newly entered band is more relevant than old queued rows.
				// Cards/threads still take precedence over speculative list work.
				const index = waiters.findIndex(
					(other) => other.priority <= waiter.priority,
				);
				waiters.splice(index < 0 ? waiters.length : index, 0, waiter);
				signal?.addEventListener("abort", cancel, { once: true });
				wake();
			});
		}
		const validator = held?.state === "ready" ? held : null;
		const started = epoch;
		const reserved = Array.from({ length: REQUESTS_PER_READ }, () => ({
			until: Number.POSITIVE_INFINITY,
		}));
		for (const reservation of reserved) reservations.add(reservation);
		let sent = 0;
		inFlight += 1;
		const promise = fetchUri(validator?.etag ?? undefined, () => {
			sent += 1;
		})
			.then(
				(result) => {
					if (started !== epoch)
						return endpoint ? null : typeof result === "string" ? result : null;
					remove(key);
					const photo =
						typeof result === "string"
							? { uri: result, etag: null }
							: (result ?? (validator?.etag ? validator : null));
					if (!photo) return null;
					const { uri, etag } = photo;
					if (uri.length > maxBytes) {
						remember(key, Number.POSITIVE_INFINITY, true);
						return null;
					}
					if (makeRoom(1, uri.length)) {
						heldBytes += uri.length;
						entries.set(key, {
							state: "ready",
							uri,
							bytes: uri.length,
							etag,
							verifiedAt: now(),
						});
					}
					return uri;
				},
				(error: unknown) => {
					if (started !== epoch) return null;
					if (isHubError(error) && error.kind === "rate_limited") {
						throttledUntil = Math.max(
							throttledUntil,
							now() + transientDelay(error.retryAfterMs, cooldown),
						);
					}
					remove(key);
					fail(key, classify(error), retryAfterOf(error));
					if (endpoint && endpointRefusal(error)) expireSibling(key);
					return null;
				},
			)
			.finally(() => {
				if (started !== epoch) return;
				// Unmetered callers cannot prove a request unused: keep both.
				const kept = options.metered
					? Math.min(sent, REQUESTS_PER_READ)
					: REQUESTS_PER_READ;
				reserved.forEach((reservation, index) => {
					if (index < kept) reservation.until = now() + READ_WINDOW_MS;
					else reservations.delete(reservation);
				});
				inFlight -= 1;
				wake();
			});
		entries.set(key, {
			state: "loading",
			promise,
			bytes: validator?.bytes ?? 0,
		});
		return promise;
	};

	return {
		/** Display state binds to this retirement generation, not just a key. */
		get epoch(): number {
			return epoch;
		},

		getEpoch: () => epoch,
		subscribeEpoch(listener: () => void) {
			epochListeners.add(listener);
			return () => {
				epochListeners.delete(listener);
			};
		},
		/** Only public-to-this-view account photos can bypass a new read. */
		peek(key: string): string | null {
			if (ENDPOINT_KEY.test(key)) return null;
			const entry = entries.get(key);
			if (entry?.state !== "ready") return null;
			touch(key, entry);
			return entry.uri;
		},

		/**
		 * An endpoint photo authorized for this account within
		 * `ENDPOINT_PHOTO_FRESH_MS`, for a row's first frame on re-entry; `null`
		 * otherwise (the row shows its glyph and asks through `loadEndpoint`).
		 */
		peekEndpoint(key: string): string | null {
			if (!ENDPOINT_KEY.test(key)) return null;
			const entry = entries.get(key);
			if (entry?.state !== "ready" || !fresh(entry)) return null;
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

		/**
		 * An endpoint photo: held bytes for this hash, the read in flight, or a
		 * new one. Refuses anything that is not an endpoint key.
		 */
		loadEndpoint(
			key: string,
			fetchUri: FetchUri,
			classify: (error: unknown) => AvatarFailure,
			options?: ReadOptions,
		): Promise<string | null> {
			if (!ENDPOINT_KEY.test(key)) return Promise.resolve(null);
			return load(key, fetchUri, classify, options);
		},

		fail,

		/** Sign-out / account change: nothing held survives, nothing in flight lands. */
		clear(): void {
			epoch += 1;
			inFlight = 0;
			entries.clear();
			heldBytes = 0;
			reservations.clear();
			throttledUntil = 0;
			cancelWake();
			// Queued reads belong to the old account: settle them, never run them.
			for (const waiter of waiters.splice(0)) waiter.cancel();
			for (const listener of epochListeners) listener();
		},

		/** For tests and diagnostics: counts only, never keys or bytes. */
		stats(): { entries: number; bytes: number } {
			return { entries: entries.size, bytes: heldBytes };
		},
	};
}

export type AvatarCache = ReturnType<typeof createAvatarCache>;
