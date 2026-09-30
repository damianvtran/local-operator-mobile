/**
 * Per-session projections, with the one rule that makes a reconnect safe.
 *
 * From `docs/architecture.md` §State management: a frame is accepted only if it is
 * **the first of a connection, or newer than what this store holds**. Everything
 * else about this file follows from two contract facts:
 *
 * - The relay pushes FULL snapshots (`event: projection`), never deltas, so there
 *   is no merge logic here — a frame replaces the entry's projection whole.
 * - The daemon's epoch counter can restart across a reconnection, which is a
 *   different thing from a stale frame. So the first frame after a connection opens
 *   is authoritative even if its `version` looks older, and `version` must never be
 *   compared across connections or persisted (`contract.md` §6.5).
 *
 * A dropped frame is dropped from the RENDER only: the fence's own reading of the
 * version still moves forward on anything newer, so one out-of-order frame cannot
 * wedge the store into rejecting everything after it.
 *
 * `stale beats blank` is the other half: a stream ending keeps the last projection
 * on screen and flips `connected`, so a flapping tunnel never empties a transcript
 * the user is reading.
 */

import { createStore } from "zustand/vanilla";

import type { SessionProjection } from "../contracts";
import { ProjectionFence } from "../relay";

export interface ProjectionEntry {
	/** `null` until the seed frame of the first connection arrives. */
	projection: SessionProjection | null;
	/** False while the stream is closed or reconnecting. Never a reason to clear. */
	connected: boolean;
	/** True between a connection opening and its seed frame: the state the contract
	 *  calls `awaitingSnapshot`. */
	awaitingSnapshot: boolean;
	/** The version held for the CURRENT connection, or `null`. Diagnostics only; it
	 *  is never compared across connections. */
	version: number | null;
	/** How many frames were dropped as older. Surfaced so a bug is visible rather
	 *  than silent. */
	droppedFrames: number;
}

export interface ProjectionSnapshot {
	entries: Record<string, ProjectionEntry>;
}

export interface ProjectionActions {
	/** A connection opened. The next frame is authoritative. */
	beginStream: (sessionId: string) => void;
	/** Applies one frame, subject to the fence. Returns what the fence decided, so a
	 *  caller can count or log drops without a second copy of the rule. */
	applyFrame: (
		sessionId: string,
		projection: SessionProjection,
	) => "accepted-snapshot" | "accepted-newer" | "dropped-older";
	/** The stream closed. Keeps the projection and marks it not connected. */
	endStream: (sessionId: string) => void;
	/** Forgets one session, e.g. when the relay reports a new epoch. */
	drop: (sessionId: string) => void;
	/** Forgets everything: a route end, where the projections belong to another
	 *  computer. */
	reset: () => void;
}

export type ProjectionStore = ProjectionSnapshot & ProjectionActions;

const EMPTY_ENTRY: ProjectionEntry = {
	projection: null,
	connected: false,
	awaitingSnapshot: true,
	version: null,
	droppedFrames: 0,
};

/** The fences, held OUTSIDE the store state.
 *
 * They are mutable objects with identity, and a store update that copied them
 * would hand a subscriber a fence whose position it cannot trust. Keeping them out
 * of the snapshot also keeps the snapshot serialisable, which matters for a
 * persisted cache. */
const fences = new Map<string, ProjectionFence>();

export function createProjectionStore() {
	return createStore<ProjectionStore>()((set, get) => ({
		entries: {},

		beginStream(sessionId) {
			/* A new connection: the fence restarts, which is the ONLY place
			 * `awaitingSnapshot` is set true again. */
			const fence = fences.get(sessionId) ?? new ProjectionFence();
			fence.reset();
			fences.set(sessionId, fence);
			const current = get().entries[sessionId] ?? EMPTY_ENTRY;
			set((state) => ({
				entries: {
					...state.entries,
					[sessionId]: { ...current, connected: true, awaitingSnapshot: true },
				},
			}));
		},

		applyFrame(sessionId, projection) {
			const fence = fences.get(sessionId) ?? new ProjectionFence();
			fences.set(sessionId, fence);
			const decision = fence.accept(projection.version);
			const current = get().entries[sessionId] ?? EMPTY_ENTRY;

			if (decision === "dropped-older") {
				set((state) => ({
					entries: {
						...state.entries,
						[sessionId]: {
							...current,
							connected: true,
							awaitingSnapshot: false,
							droppedFrames: current.droppedFrames + 1,
						},
					},
				}));
				return decision;
			}

			set((state) => ({
				entries: {
					...state.entries,
					[sessionId]: {
						projection,
						connected: true,
						awaitingSnapshot: false,
						version: projection.version,
						droppedFrames: current.droppedFrames,
					},
				},
			}));
			return decision;
		},

		endStream(sessionId) {
			const current = get().entries[sessionId];
			if (!current) return;
			/* `stale beats blank`: the projection stays, only the flag moves. */
			set((state) => ({
				entries: {
					...state.entries,
					[sessionId]: { ...current, connected: false },
				},
			}));
		},

		drop(sessionId) {
			fences.delete(sessionId);
			set((state) => {
				const entries = { ...state.entries };
				delete entries[sessionId];
				return { entries };
			});
		},

		reset() {
			fences.clear();
			set({ entries: {} });
		},
	}));
}

export type ProjectionStoreApi = ReturnType<typeof createProjectionStore>;

/** Reads one session's entry, defaulting to the never-connected shape so a screen
 *  never has to null-check its way through a render. */
export function readEntry(
	snapshot: ProjectionSnapshot,
	sessionId: string,
): ProjectionEntry {
	return snapshot.entries[sessionId] ?? EMPTY_ENTRY;
}

/**
 * Whether a session's view should be labelled as not live.
 *
 * The signals, in the order they are trusted:
 *
 * - the stream is not connected;
 * - the projection's own `degraded` receipt, which local-operator PR #1784 made
 *   real on the wire (`entry.projection.degraded = bool(entry.degraded)`) — before
 *   that it was never true on any published frame, which is why the contract's
 *   §6.5 warning said not to read it;
 * - the listing row's `subagents_running` flipping to `null` against a row that
 *   previously reported `0` — the relay's own "I cannot vouch for this" signal;
 * - the row's `leaving` / `updating` phrases, which are the runtime's own words.
 *
 * `ended` is deliberately NOT folded in here: it is terminal, it has its own
 * predicate and its own affordance (resume), and painting an ended session as
 * "reconnecting" would be a different lie.
 */
export function isSessionViewStale(input: {
	entry: ProjectionEntry;
	listingRow?:
		| { subagents_running: number | null; leaving: string; updating: string }
		| undefined;
}): boolean {
	if (!input.entry.connected) return true;
	if (input.entry.projection?.degraded === true) return true;
	if (input.listingRow?.subagents_running === null) return true;
	if ((input.listingRow?.leaving ?? "").length > 0) return true;
	if ((input.listingRow?.updating ?? "").length > 0) return true;
	return false;
}

/**
 * Whether the session has ended, so the view offers resume rather than a composer
 * or a reconnect.
 *
 * The receipt is the daemon's own observation of a death (PR #1784): a plain
 * durable row reports `false`, and an older relay omits the field entirely — both
 * read as "still a real session", never as ended. The projection's frame is the
 * fresher source because it is pushed, while the listing row is repainted on
 * change; either being true is enough, because both are the same fact.
 */
export function isSessionEnded(input: {
	entry: ProjectionEntry;
	listingRow?: { ended?: boolean } | undefined;
}): boolean {
	return (
		input.entry.projection?.ended === true || input.listingRow?.ended === true
	);
}
