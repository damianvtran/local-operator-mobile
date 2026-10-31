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
 *   the cache is keyed by it, a changed picture arrives as a new digest (a miss),
 *   and an unchanged one is never fetched twice in a process lifetime.
 * - Everything absent reads as "draw the existing glyph": an older relay that
 *   omits the fields, a `null` digest (no picture), a remote row (another
 *   device's agent — its picture is not this relay's to serve), the relay's own
 *   404 (picture removed between frames, or a relay without the route yet).
 *
 * UI-free and React-free on purpose, so the vitest Node host exercises it.
 */

import { isRelayMissing } from "@/relay/errors";

/** What a row needs to name a picture. Both halves or nothing. */
export type AgentAvatarRef = { agentId: string; sha256: string };

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
 *  Passed PER CALL rather than fixed at construction because the cache is
 *  process-wide while the relay client is not: the reader can switch
 *  computers, and the current one is whichever relay the caller holds now.
 *  Sharing across computers is sound because the key is the content digest —
 *  the same digest is the same bytes whichever relay served them. */
export type AvatarLoader = (ref: AgentAvatarRef) => Promise<string>;

/**
 * Entries kept, keyed by digest — so this is "how many distinct pictures" a
 * reader can scroll back through without a re-download.
 *
 * 24 was the first guess and it is smaller than the population it caches: a
 * workspace's sessions are attended by its agents, and a roster of a few dozen
 * agents is ordinary, so more than 24 distinct pictures in one list re-fetched on
 * scroll-back — the miss flashes the glyph, the exact artefact `peek` exists to
 * prevent (review round 1, R4). 48 covers a few dozen agents. The worst case is
 * bounded but not small: a picture is ≤ 1 MiB by the contract's cap, ~1.37 MiB as
 * a base64 data URI, so 48 entries of pathological pictures would be ~66 MiB. Real
 * pictures are tens of KB (the two in the mock relay are 99 bytes), and a phone
 * does not hold 48 agents' pictures at the cap at once. Anything beyond the bound
 * is still evicted LRU-first and re-fetched on scroll-back.
 */
export const AVATAR_CACHE_LIMIT = 48;

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
 * The distinction that matters is identity: `useAgentAvatarUri` holds the picture
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
	 * Concurrent callers for one digest share one request. A 404 is cached as
	 * `null` — the digest is content-addressed, so a missing one stays missing
	 * until a frame names a NEW digest. A transport failure is NOT cached: the
	 * next render retries, because "the tunnel blinked" is not a fact about the
	 * picture.
	 */
	get: (ref: AgentAvatarRef, load: AvatarLoader) => Promise<string | null>;
	/** The settled value, synchronously, so a remount paints without a frame of
	 *  glyph. `undefined` = not settled (unknown or in flight). */
	peek: (ref: AgentAvatarRef) => string | null | undefined;
	size: () => number;
};

export const createAvatarCache = (
	limit: number = AVATAR_CACHE_LIMIT,
	concurrency: number = AVATAR_FETCH_CONCURRENCY,
): AvatarCache => {
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
		settled.delete(key);
		settled.set(key, value);
		while (settled.size > limit) {
			const oldest = settled.keys().next().value;
			if (oldest === undefined) break;
			settled.delete(oldest);
		}
	};

	return {
		get: (ref, load) => {
			/* Keyed by the digest alone: two agents sharing one picture share its
			 *  bytes, and the digest is what the bytes ARE. */
			const key = ref.sha256;
			if (settled.has(key)) {
				const value = settled.get(key) ?? null;
				remember(key, value);
				return Promise.resolve(value);
			}
			const pending = inflight.get(key);
			if (pending) return pending;
			const request = withSlot(() => load(ref))
				.then(
					(uri) => {
						remember(key, uri);
						return uri as string | null;
					},
					(error: unknown) => {
						if (isRelayMissing(error)) {
							remember(key, null);
							return null;
						}
						throw error;
					},
				)
				.finally(() => {
					inflight.delete(key);
				});
			inflight.set(key, request);
			return request;
		},
		peek: (ref) =>
			settled.has(ref.sha256) ? (settled.get(ref.sha256) ?? null) : undefined,
		size: () => settled.size,
	};
};
