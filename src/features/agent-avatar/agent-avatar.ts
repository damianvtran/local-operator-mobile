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
 * Entries kept. A stored picture is ≤ 1 MiB (the contract's cap), ~1.37 MiB as a
 * data URI, so this bounds the worst case near 33 MiB — and a phone's list shows
 * a handful of distinct agents, so in practice every live one stays resident.
 */
export const AVATAR_CACHE_LIMIT = 24;

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
): AvatarCache => {
	/* Insertion order is the LRU order: a hit re-inserts its key. */
	const settled = new Map<string, string | null>();
	const inflight = new Map<string, Promise<string | null>>();

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
			const request = load(ref)
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
