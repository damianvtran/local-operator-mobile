import { deviceStore } from "@/features/session/device-storage";
import { RetryEnvelopeStore } from "@/relay";

/**
 * ONE envelope store per session, for the whole process.
 *
 * The store is what makes a replay reuse a `command_id` instead of minting a
 * second one, and that guarantee only holds if every caller on a session shares
 * one instance. Two instances would each believe they hold the only envelope for
 * the session: the second `holdNew` would mint a NEW id for an instruction the
 * first had already persisted, and the relay would see two distinct commands for
 * one thing the reader typed. The composer is not the only possible caller — the
 * session list's "needs attention" path and a future notification action both
 * replay instructions — so the memo lives here rather than in one hook's
 * `useMemo`, which is per component instance and would bring the second store
 * back the moment a screen mounted twice.
 *
 * Keyed by session id rather than by "the current session" because a session's
 * envelope belongs to that session: switching sessions must not hand one
 * session's unresolved instruction to another, and `envelopeKey` partitions the
 * underlying storage the same way.
 *
 * The map grows by one entry per session this process opens. That is bounded by
 * the sessions a reader opens in one run, and the entries are tiny adapters over
 * the same device store — no per-session data is copied.
 */
const stores = new Map<string, RetryEnvelopeStore>();

/** The store for a session, created on first use and shared after that. */
export const envelopeStoreFor = (sessionId: string): RetryEnvelopeStore => {
	const existing = stores.get(sessionId);
	if (existing !== undefined) return existing;
	const created = new RetryEnvelopeStore({ store: deviceStore });
	stores.set(sessionId, created);
	return created;
};

/** Forgets a session's store. The storage itself is the store's own to clear, so
 *  this only drops the shared instance — the next caller gets a fresh view of the
 *  same bytes rather than a different envelope. */
export const forgetEnvelopeStore = (sessionId: string): void => {
	stores.delete(sessionId);
};
