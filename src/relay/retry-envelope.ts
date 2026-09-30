/**
 * The persisted retry envelope: the rules that make a command with an UNKNOWN
 * outcome safe to replay.
 *
 * Ported, not re-derived, from `~/local-operator/docs/mobile.md`
 * §"Retry-envelope & generation-ledger lifecycle" and its source of truth
 * `local_operator/mobile/web/src/continuation-command.ts`. The invariant it
 * protects: **the UUID is the identity of the body.** A retry replays the *same*
 * bytes under the *same* `command_id`, so the runtime's durable identity ledger
 * de-duplicates an already-admitted instruction instead of running it twice;
 * re-sending under a fresh UUID after an ambiguous failure is exactly the
 * duplicate this envelope exists to prevent.
 *
 * **The table itself is NOT here.** It is `defaultEnvelopeFor` in `errors.ts`,
 * reached through `RelayError.envelope`, because a second copy of it beside the
 * taxonomy is exactly the defect this module was rebuilt to remove: the two used
 * to disagree, and the operative path cleared a typed instruction on a `503`.
 * `dispositionForOutcome` reads that one verdict and this module only stores the
 * bytes. The rows, for the reader:
 *
 * | Outcome                                       | Envelope |
 * |-----------------------------------------------|----------|
 * | `200` acknowledgement                         | clear    |
 * | `401`                                         | clear-all (scoped storage is gone with the identity) |
 * | `408`, `502`, `504`, an unreadable `2xx`      | **keep** — admission may have happened and only the acknowledgement was lost |
 * | transport failure (no response at all)        | **keep** |
 * | `503` (edge text/plain, or every gateway reason), `502` "local harness unavailable" | **keep** — see below |
 * | every other 4xx/5xx                           | clear — the relay's own pre-admission rejection |
 * | TTL (24 h) or an explicit discard             | clear    |
 * | count bound (8) exceeded                      | evict the oldest, never the active route |
 *
 * The `503` row **deliberately diverges from `contract.md` §5.1**, which puts
 * every status outside `408/502/504` in the clear column. The gateway and the
 * edge sit *upstream* of the relay's `CommandReservations` ledger
 * (`§5.3`), so their refusal proves nothing about whether an earlier attempt
 * reached the runtime; the two mistakes are not symmetric, and replaying a
 * de-duplicated id is free while discarding a typed instruction is not.
 *
 * Two deliberate differences from the web client, both because native storage is
 * not `localStorage`:
 *
 * - Persistence is behind `EnvelopeStore`, an async key/value port. The app's
 *   adapter must be DEVICE STORAGE, not `expo-secure-store`: an envelope can
 *   legitimately be megabytes (a prompt with images) and iOS rejects large
 *   SecureStore values, while nothing here is a secret. See `docs/relay-client.md`
 *   for the dependency this needs.
 * - The stored form carries `saved_at` and is bounded in characters, because a
 *   partially-written item is *possible* on native storage where `localStorage`
 *   was atomic, and a truncated envelope has no trustworthy UUID/body pairing.
 */

import type { PromptImage } from "../contracts";
import type { RelayError } from "./errors";

/** Key prefix, identical to the web client's so the two clients describe the
 *  same state in the same words. */
export const ENVELOPE_KEY_PREFIX = "lo-mobile-command:";
/** 24 h, per `docs/mobile.md` §Retry-envelope. */
export const ENVELOPE_TTL_MS = 24 * 60 * 60 * 1000;
/** The web client's bound, kept: a bigger envelope cannot be retained safely. */
export const MAX_STORED_ENVELOPE_CHARS = 4 * 1024 * 1024;
/** Bounded by COUNT, oldest evicted. */
export const MAX_PENDING_ENVELOPES = 8;

/** The two ops whose delivery can be ambiguous. A `set_model` or an
 *  `approval_answer` is not persisted: it is either answered or not, and it
 *  carries no durable identity to replay. */
export type ContinuationOp = "prompt" | "steer";

/** The exact bytes of one instruction. `images` are copied, never referenced. */
export interface ContinuationEnvelope {
	op: ContinuationOp;
	command_id: string;
	text: string;
	images?: PromptImage[];
}

/** What is written to storage. The wrapper is what makes an old item readable
 *  and a corrupt one recognisable. */
export interface StoredEnvelope {
	version: 1;
	saved_at: number;
	envelope: ContinuationEnvelope;
}

/** The persistence port. `keys()` exists so the count bound can evict the oldest
 *  without the module owning a separate index — an index and the items it points
 *  at drift the first time a write fails. */
export interface EnvelopeStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
	/** Every key this module has written. */
	keys(): Promise<string[]>;
}

/** In-memory store: the default in tests, and the shape an adapter wraps. */
export function memoryEnvelopeStore(): EnvelopeStore {
	const items = new Map<string, string>();
	return {
		async get(key) {
			return items.get(key) ?? null;
		},
		async set(key, value) {
			items.set(key, value);
		},
		async remove(key) {
			items.delete(key);
		},
		async keys() {
			return [...items.keys()];
		},
	};
}

/** Raised when an instruction cannot be retained. The caller must NOT send it:
 *  an instruction it cannot persist is one whose failure it could not recover. */
export class EnvelopeStorageError extends Error {
	override readonly name = "EnvelopeStorageError";
	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
	}
}

/** What the caller should do with the stored envelope after an outcome. */
export type EnvelopeDisposition = "kept" | "cleared" | "cleared-all";

/** `lo-mobile-command:<sessionId>`. */
export function envelopeKey(sessionId: string): string {
	return `${ENVELOPE_KEY_PREFIX}${sessionId}`;
}

export function sessionIdFromKey(key: string): string | null {
	return key.startsWith(ENVELOPE_KEY_PREFIX)
		? key.slice(ENVELOPE_KEY_PREFIX.length)
		: null;
}

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A shape check for a stored envelope. It is explicit rather than a schema
 *  because it guards our own storage format, not the wire: a value that fails it
 *  is corrupt (a partial write, a quota truncation) and the only safe reading of
 *  a corrupt item is *no envelope*, never a guess at the UUID/body pairing. */
export function isValidEnvelope(value: unknown): value is ContinuationEnvelope {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<ContinuationEnvelope>;
	if (candidate.op !== "prompt" && candidate.op !== "steer") return false;
	if (
		typeof candidate.command_id !== "string" ||
		!UUID_PATTERN.test(candidate.command_id)
	)
		return false;
	if (typeof candidate.text !== "string") return false;
	if (candidate.images !== undefined) {
		if (!Array.isArray(candidate.images)) return false;
		for (const image of candidate.images) {
			if (typeof image !== "object" || image === null) return false;
			const { data_b64: data, mime_type: mime } = image as Partial<PromptImage>;
			if (typeof data !== "string" || typeof mime !== "string") return false;
		}
	}
	return true;
}

export interface RetryEnvelopeDeps {
	store: EnvelopeStore;
	/** Injected so the TTL and the eviction order are testable. */
	now?: () => number;
	/** Injected so a stored envelope's id is deterministic in a test. */
	randomUuid?: () => string;
}

/**
 * The envelope store.
 *
 * Everything here is async because native storage is async, and everything here
 * is failure-visible because the alternative — swallowing a storage error — is a
 * command that cannot be recovered and a user who is never told.
 */
export class RetryEnvelopeStore {
	private readonly store: EnvelopeStore;
	private readonly now: () => number;
	private readonly randomUuid: () => string;

	constructor(deps: RetryEnvelopeDeps) {
		this.store = deps.store;
		this.now = deps.now ?? (() => Date.now());
		this.randomUuid = deps.randomUuid ?? defaultUuid;
	}

	/**
	 * Retains `envelope` for `sessionId`, after validating it and evicting the
	 * oldest OTHER session's envelope if the count bound is reached.
	 *
	 * Eviction happens *before* the write so a new envelope can never be the one
	 * evicted — the failure the web client's own comment calls out (an envelope
	 * that evicts itself makes a retry impossible exactly when it is needed).
	 */
	async hold(sessionId: string, envelope: ContinuationEnvelope): Promise<void> {
		if (!isValidEnvelope(envelope)) {
			/* Named precisely: the caller's bug could be the op (not a continuable op),
			 * a missing text field, a malformed image, or — the one that matters most —
			 * a `command_id` that is not a UUID, because a non-UUID id would defeat the
			 * de-duplication this whole module exists for. */
			/* Read before the guard narrows `envelope` to `never`: the check for the id
			 * must happen on the value that was passed in, not on the narrowed type. */
			const candidateId =
				typeof (envelope as { command_id?: unknown }).command_id === "string"
					? (envelope as { command_id: string }).command_id
					: "";
			throw new EnvelopeStorageError(
				candidateId.length > 0 && !UUID_PATTERN.test(candidateId)
					? "command_id must be a UUID for the relay to de-duplicate a replay"
					: "this instruction cannot be retained safely for retry",
			);
		}
		const key = envelopeKey(sessionId);
		const raw = JSON.stringify({
			version: 1,
			saved_at: this.now(),
			envelope,
		} satisfies StoredEnvelope);
		if (raw.length > MAX_STORED_ENVELOPE_CHARS) {
			throw new EnvelopeStorageError(
				"this instruction is too large to retain safely for retry",
			);
		}
		await this.evictOldest(key);
		try {
			await this.store.set(key, raw);
		} catch (cause) {
			throw new EnvelopeStorageError(
				"this instruction could not be retained safely for retry",
				cause,
			);
		}
	}

	/**
	 * Creates and retains an envelope, or reuses the one already held.
	 *
	 * Reuse is the whole point: a second send while one is pending must replay the
	 * SAME UUID rather than create a second instruction.
	 */
	async holdNew(
		sessionId: string,
		op: ContinuationOp,
		text: string,
		images?: PromptImage[],
	): Promise<{ envelope: ContinuationEnvelope; reused: boolean }> {
		const existing = await this.peek(sessionId);
		/* `reused` is the signal the composer needs: returning the stored envelope
		 * is right for a double-tap or a retry, but it silently discards the `text`
		 * this call was handed, so a caller that sends a genuinely NEW draft while an
		 * earlier one is unresolved must be able to tell and say "you still have an
		 * unsent message" instead of replaying the old bytes as if they were new. */
		if (existing) return { envelope: existing, reused: true };
		const envelope: ContinuationEnvelope = {
			op,
			command_id: this.randomUuid(),
			text,
			...(images && images.length > 0
				? { images: images.map((image) => ({ ...image })) }
				: {}),
		};
		await this.hold(sessionId, envelope);
		return { envelope, reused: false };
	}

	/** The envelope held for a session, or `null`. Expired, oversized and corrupt
	 *  items are removed rather than returned. */
	async peek(sessionId: string): Promise<ContinuationEnvelope | null> {
		const key = envelopeKey(sessionId);
		let raw: string | null;
		try {
			raw = await this.store.get(key);
		} catch {
			/* A read failure is indistinguishable from an empty slot for the caller,
			 * and returning an envelope we could not verify would be worse. The item
			 * is left in place: the next read may succeed. */
			return null;
		}
		if (raw === null) return null;
		if (raw.length > MAX_STORED_ENVELOPE_CHARS) {
			await this.remove(key);
			return null;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			await this.remove(key);
			return null;
		}
		const stored = parseStored(parsed);
		if (!stored) {
			/* A pre-`version` item from an older build is accepted once and upgraded
			 * with a fresh timestamp, so it cannot get unbounded storage lifetime. */
			if (isValidEnvelope(parsed)) {
				await this.replace(key, {
					version: 1,
					saved_at: this.now(),
					envelope: parsed,
				});
				return parsed;
			}
			await this.remove(key);
			return null;
		}
		const age = this.now() - stored.saved_at;
		/* `saved_at` in the future means a clock change or a forged item; either way
		 * the TTL cannot be evaluated, so the envelope is discarded rather than
		 * granted an unbounded life. */
		if (age < 0 || age > ENVELOPE_TTL_MS) {
			await this.remove(key);
			return null;
		}
		return stored.envelope;
	}

	async has(sessionId: string): Promise<boolean> {
		return (await this.peek(sessionId)) !== null;
	}

	/** Explicit discard: the user abandoned the instruction. */
	async clear(sessionId: string): Promise<void> {
		await this.remove(envelopeKey(sessionId));
	}

	/**
	 * Clears every envelope. Called on logout, on an identity change, and on any
	 * `401` — the scoped storage belongs to an identity that no longer holds.
	 */
	async clearAll(): Promise<void> {
		let keys: string[];
		try {
			keys = await this.store.keys();
		} catch {
			return;
		}
		for (const key of keys) {
			if (key.startsWith(ENVELOPE_KEY_PREFIX)) await this.remove(key);
		}
	}

	/**
	 * Applies an outcome to the stored envelope and reports what happened, so a
	 * caller can render the receipt ladder (`docs/relay/contract.md` §5.4) without
	 * re-implementing the table.
	 *
	 * `sessionId` is omitted only for the `401` arm, which clears everything.
	 */
	async settle(
		sessionId: string | null,
		outcome: SettleOutcome,
	): Promise<EnvelopeDisposition> {
		const disposition = dispositionForOutcome(outcome);
		if (disposition === "cleared-all") {
			await this.clearAll();
			return "cleared-all";
		}
		if (disposition === "kept") return "kept";
		if (sessionId !== null) await this.clear(sessionId);
		return "cleared";
	}

	private async replace(key: string, stored: StoredEnvelope): Promise<void> {
		try {
			await this.store.set(key, JSON.stringify(stored));
		} catch {
			/* Only reached while upgrading a legacy item; leaving the legacy item in
			 * place is correct, because it is still readable as-is. */
		}
	}

	private async remove(key: string): Promise<void> {
		try {
			await this.store.remove(key);
		} catch {
			/* Best-effort: a failed removal is retried by the next `peek`, which
			 * re-evaluates the TTL, and every removal path is idempotent. */
		}
	}

	/** Evicts the oldest envelope when the count bound would be exceeded, skipping
	 *  `keepKey` (the one about to be written) so an active route's envelope is
	 *  never the one evicted. */
	private async evictOldest(keepKey: string): Promise<void> {
		let keys: string[];
		try {
			keys = (await this.store.keys()).filter((key) =>
				key.startsWith(ENVELOPE_KEY_PREFIX),
			);
		} catch {
			return;
		}
		if (keys.length < MAX_PENDING_ENVELOPES) return;
		const candidates: { key: string; savedAt: number }[] = [];
		for (const key of keys) {
			if (key === keepKey) continue;
			candidates.push({ key, savedAt: await this.savedAt(key) });
		}
		candidates.sort((left, right) => left.savedAt - right.savedAt);
		/* Remove enough that the new write lands at or under the bound. */
		const excess = keys.length - MAX_PENDING_ENVELOPES + 1;
		for (const candidate of candidates.slice(0, Math.max(0, excess))) {
			await this.remove(candidate.key);
		}
	}

	private async savedAt(key: string): Promise<number> {
		try {
			const raw = await this.store.get(key);
			if (raw === null) return Number.POSITIVE_INFINITY;
			const parsed: unknown = JSON.parse(raw);
			const stored = parseStored(parsed);
			if (stored) return stored.saved_at;
			/* A legacy or corrupt item has no trustworthy age; treat it as newest so a
			 * well-formed envelope is evicted first, and let `peek` prune it. */
			return Number.POSITIVE_INFINITY;
		} catch {
			return Number.POSITIVE_INFINITY;
		}
	}
}

/** Everything that can happen to a command: it was acknowledged, or it failed
 *  with a classified `RelayError`.
 *
 *  There is deliberately no status-keyed arm. The envelope disposition is a
 *  property of the ERROR (`RelayError.envelope`, decided once in `errors.ts`), not
 *  of a bare status: `503` alone cannot say whether the connector is absent
 *  (delivery unknown) or refusing (never forwarded), and a second table keyed on
 *  status is exactly what let the two disagree. */
export type SettleOutcome =
	| { kind: "ack" }
	| { kind: "failed"; error: RelayError };

export function dispositionForOutcome(
	outcome: SettleOutcome,
): EnvelopeDisposition {
	if (outcome.kind === "ack") return "cleared";
	switch (outcome.error.envelope) {
		case "keep":
			return "kept";
		case "clear-all":
			return "cleared-all";
		case "clear":
			return "cleared";
	}
}

/** Reads a stored item, tolerant of the wrapper's absence. Returns `null` when
 *  the wrapper is present but malformed — a wrapping without a valid envelope is
 *  corrupt, never a legacy item. */
function parseStored(value: unknown): StoredEnvelope | null {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value as Partial<StoredEnvelope>;
	if (candidate.version !== 1) return null;
	if (
		typeof candidate.saved_at !== "number" ||
		!Number.isFinite(candidate.saved_at)
	)
		return null;
	if (!isValidEnvelope(candidate.envelope)) return null;
	return {
		version: 1,
		saved_at: candidate.saved_at,
		envelope: candidate.envelope,
	};
}

/** `crypto.randomUUID` where it exists (Node 19+, Hermes with the polyfill the
 *  app ships), with a clear failure where it does not rather than a predictable
 *  id — a non-random command id would defeat the de-duplication it exists for. */
function defaultUuid(): string {
	const cryptoObject = (globalThis as { crypto?: Crypto }).crypto;
	if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
		return cryptoObject.randomUUID();
	}
	throw new EnvelopeStorageError(
		"no crypto.randomUUID on this runtime: a command id cannot be generated safely for retry",
	);
}
