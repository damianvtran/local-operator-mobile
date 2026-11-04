/**
 * Agent profile pictures on the phone: which row has one, what URL names it,
 * and a digest-keyed cache of the bytes.
 *
 * WHY THIS EXISTS. Local Operator lets an operator give each local agent a
 * picture (the agent-profile-picture contract in `damianvtran/local-operator`;
 * the desktop's editor lives in its Agents page, building on bbqben's
 * local-operator-ui#1517). The phone only DISPLAYS it — it has no editor — so
 * this module is read-only by construction: there is no write path here.
 *
 * THE CONTRACT IT READS, and the constraints that follow from it:
 *
 * - A session row carries `agent_id` and `avatar_sha256` (both additive). The
 *   list therefore knows WHETHER a picture exists without a request per row,
 *   and only a row that names a digest ever reaches the network.
 * - The bytes are `GET /v1/agents/{agent_id}/avatar?v=<sha>` through the relay
 *   (`RelayEndpoints.agentAvatar`, the one place that spells the path).
 *   `sha256` is the digest of the stored file, so it IS the content's identity:
 *   the cache is keyed by agent id AND digest, so a changed picture is a miss,
 *   and an unchanged one is reused while resident in the bounded cache.
 * - Everything absent reads as "draw the existing glyph": an older relay that
 *   omits the fields, a `null` digest (no picture), a remote row (another
 *   device's agent — its picture is not this relay's to serve), the relay's own
 *   404 (picture removed between frames, or a relay without the route yet).
 *
 * UI-free and React-free on purpose, so the vitest Node host exercises it.
 */

import type { Capabilities } from "@/contracts";
import { isRelayMissing, RelayError } from "@/relay/errors";

/** What a row needs to name a picture. Both halves or nothing. `size` is the
 *  relay variant to fetch (`avatarVariant`); absent means the stored original. */
export type AgentAvatarRef = { agentId: string; sha256: string; size?: number };

/* ------------------------------------------------------------- variants */

/** The square variants the relay can serve (core `agent_avatar.DERIVATIVE_SIZES`,
 *  advertised as `features.agent_avatar_sizes`). */
export const AVATAR_VARIANTS = [64, 128, 256] as const;

/**
 * The variant edge for a `dp`-sized slot at `pixelRatio`, or `undefined` for the
 * 512 px original.
 *
 * WHY. The stored picture is 512 px; a 24 dp row draws it into 72 physical px at
 * 3x, so fetching the original ships ~10x the bytes needed, while a variant
 * below dp x PixelRatio is upscaled and looks soft. The answer is the SMALLEST
 * variant whose edge covers the physical pixels, and the original only when even
 * 256 does not (past 256 physical px, e.g. 72 dp at 4x). A missing or odd ratio reads as 1.
 */
export const avatarVariant = (
	dp: number,
	pixelRatio: number,
): number | undefined => {
	const density =
		Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
	const needed = Math.ceil(dp * density);
	return AVATAR_VARIANTS.find((edge) => edge >= needed);
};

/**
 * Whether this relay honours `?size=` on the avatar route.
 *
 * The flag bag's values are version numbers, so a positive number is the claim
 * (the `libraryEnabled` rule). Gating matters even though an older relay would
 * just ignore the query: it keeps the request identical to what that relay has
 * always been sent, and keeps one cache entry per picture there.
 */
export const avatarSizesServed = (capabilities: Capabilities): boolean => {
	const value = capabilities.features?.agent_avatar_sizes;
	return typeof value === "number" && value > 0;
};

/** The digest the contract writes: lowercase hex sha256. Anything else is not a
 *  digest this client can address, so it is treated like an absent one rather
 *  than put on the wire. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The row's picture reference, or `null` for "use the glyph".
 *
 * Structural rather than typed against `SessionSummary` so the pure module does
 * not depend on the schema's parse output, and so a test can pass the bare
 * wire shape an older relay sends (fields missing entirely).
 */
export const avatarRefOf = (row: {
	agent_id?: string | null;
	avatar_sha256?: string | null;
	locality?: string;
}): AgentAvatarRef | null => {
	/* A remote row is another device's conversation: its agent's picture lives on
	 *  that device, and this relay's route would answer for a different (or no)
	 *  agent of the same id. The contract also forbids any cloud→local path. */
	if (row.locality === "remote") return null;
	const agentId = row.agent_id?.trim() ?? "";
	const sha256 = row.avatar_sha256?.trim().toLowerCase() ?? "";
	if (agentId === "" || !SHA256_HEX.test(sha256)) return null;
	return { agentId, sha256 };
};

/** The fetcher for one miss: the relay endpoint, injected so tests need no
 *  network. Resolves to a renderable URI (a data URI on device).
 *
 *  The route owner clears the shared cache before replacing credentials: a
 *  digest identifies bytes, not permission to reuse another account's picture. */
export type AvatarLoader = (ref: AgentAvatarRef) => Promise<string>;

/** Count and retained URI-byte bounds both matter on a phone: 48 cap-sized
 *  pictures must not retain tens of MiB merely because the roster is small. */
export const AVATAR_CACHE_LIMIT = 48;
export const AVATAR_CACHE_BYTES = 8 * 1024 * 1024;

// JSON avoids delimiter collisions in agent ids; an absent/refused agent must
// never poison a different agent that happens to name the same content hash.
// The variant is part of the identity: the row (24 dp) and the header (28 dp)
// can resolve to different variants at one density, and a 64 px body painted
// into a 128 px slot is the blur this exists to prevent.
const cacheKey = (ref: AgentAvatarRef): string =>
	JSON.stringify([ref.agentId, ref.sha256, ref.size ?? null]);
// Data URIs are ASCII, but count UTF-16 backing storage conservatively too.
const uriBytes = (value: string | null): number => (value?.length ?? 0) * 2;

/**
 * Requests in flight at once.
 *
 * Every pictured row fires on mount, and the list mounts ~10 rows at once, so
 * opening a conversation list used to put ~10 avatar requests on the tunnel
 * simultaneously — each up to 1 MiB, each becoming a data URI in the JS heap
 * (review round 1, R4). Four at a time keeps the first paint bounded and still
 * lands every picture within a couple of round trips; the queue is FIFO, so the
 * row nearest the top of the list is served first.
 */
export const AVATAR_FETCH_CONCURRENCY = 4;

/**
 * What a ref paints when it arrives or CHANGES — the settled picture for that
 * exact ref, or nothing.
 *
 * The distinction that matters is identity: the original hook held the picture
 * in state, so without asking this on every change of `(agent id, digest)` the
 * previous picture stays on screen until the new bytes arrive, and the header or
 * row shows one avatar's face under another's name (review round 1, R1). Returning
 * `null` — rather than leaving the old value — is the honest frame: nothing is
 * known about this ref's picture yet, and the glyph is what the app draws while
 * it does not know.
 */
export const paintedPicture = (
	cache: Pick<AvatarCache, "peek">,
	ref: AgentAvatarRef | null,
): string | null => (ref === null ? null : (cache.peek(ref) ?? null));

export type AvatarCache = {
	/**
	 * The picture's URI, `null` when the relay says there is none (its own 404),
	 * or a rejection for a transport failure.
	 *
	 * Concurrent callers for one agent/hash share one request. A 404 or
	 * authorization refusal (401/403) is cached as
	 * `null` — the digest is content-addressed, so a missing one stays missing
	 * until a frame names a NEW digest. A transport failure is NOT cached: the
	 * next connection/ref change retries, because "the tunnel blinked" is not a fact about the
	 * picture.
	 */
	get: (ref: AgentAvatarRef, load: AvatarLoader) => Promise<string | null>;
	/** The settled value, synchronously, so a remount paints without a frame of
	 *  glyph. `undefined` = not settled (unknown or in flight). */
	peek: (ref: AgentAvatarRef) => string | null | undefined;
	size: () => number;
	bytes: () => number;
	/** Invalidates outstanding work as well as settled bytes. */
	clear: () => void;
	revision: () => number;
	subscribe: (listener: () => void) => () => void;
};

export const createAvatarCache = (
	limit: number = AVATAR_CACHE_LIMIT,
	concurrency: number = AVATAR_FETCH_CONCURRENCY,
	byteLimit: number = AVATAR_CACHE_BYTES,
): AvatarCache => {
	if (limit < 1 || concurrency < 1 || byteLimit < 1) {
		throw new RangeError("Avatar cache bounds must be positive");
	}
	let generation = 0;
	let bytes = 0;
	const listeners = new Set<() => void>();
	/* Insertion order is the LRU order: a hit re-inserts its key. */
	const settled = new Map<string, string | null>();
	const inflight = new Map<string, Promise<string | null>>();
	/* The fetch queue: at most `concurrency` loads run at once, the rest wait in
	 *  arrival order. One queue per cache, so a second cache (a test's) is not
	 *  throttled by this one. */
	const waiting: Array<() => void> = [];
	let running = 0;
	const withSlot = <T>(load: () => Promise<T>): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			const start = () => {
				running += 1;
				let started: Promise<T>;
				try {
					/* Called SYNCHRONOUSLY when a slot is free, so a caller that already holds
					 *  one behaves exactly as it did before this queue existed. */
					started = load();
				} catch (error) {
					started = Promise.reject(error);
				}
				started.then(resolve, reject).finally(() => {
					running -= 1;
					waiting.shift()?.();
				});
			};
			if (running < concurrency) start();
			else waiting.push(start);
		});

	const remember = (key: string, value: string | null) => {
		bytes -= uriBytes(settled.get(key) ?? null);
		settled.delete(key);
		// An oversized image is a settled negative result, not a download on every
		// remount; its new content hash may be tried normally.
		const retained = uriBytes(value) > byteLimit ? null : value;
		settled.set(key, retained);
		bytes += uriBytes(retained);
		while (settled.size > limit || bytes > byteLimit) {
			const oldest = settled.keys().next().value;
			if (oldest === undefined) break;
			bytes -= uriBytes(settled.get(oldest) ?? null);
			settled.delete(oldest);
		}
	};

	return {
		get: (ref, load) => {
			const key = cacheKey(ref);
			const startedIn = generation;
			if (settled.has(key)) {
				const value = settled.get(key) ?? null;
				remember(key, value);
				return Promise.resolve(value);
			}
			const pending = inflight.get(key);
			if (pending) return pending;
			const request = withSlot(() =>
				startedIn === generation ? load(ref) : Promise.resolve(null),
			)
				.then(
					(uri) => {
						if (startedIn !== generation) return null;
						remember(key, uri);
						return settled.get(key) ?? null;
					},
					(error: unknown) => {
						if (startedIn !== generation) return null;
						if (
							isRelayMissing(error) ||
							(error instanceof RelayError &&
								(error.status === 401 || error.status === 403))
						) {
							remember(key, null);
							return null;
						}
						throw error;
					},
				)
				.finally(() => {
					if (startedIn === generation) inflight.delete(key);
				});
			inflight.set(key, request);
			return request;
		},
		peek: (ref) =>
			settled.has(cacheKey(ref))
				? (settled.get(cacheKey(ref)) ?? null)
				: undefined,
		size: () => settled.size,
		bytes: () => bytes,
		clear: () => {
			generation += 1;
			settled.clear();
			inflight.clear();
			bytes = 0;
			for (const listener of listeners) listener();
		},
		revision: () => generation,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
};

/** Shared by the route owner and renderers; no credentials or transport here. */
export const agentAvatarCache = createAvatarCache();
