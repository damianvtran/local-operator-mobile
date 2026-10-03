/**
 * The sessions list, as the list stream paints it.
 *
 * One rule, from `docs/architecture.md` §State management: **replaced wholesale on
 * each push.** Every frame is a full repaint of the list (the same payload as
 * `GET /api/sessions`), so there is no merge, no diff and no per-row reconcile —
 * and no opportunity to drift out of order, because the relay sorts rows on the
 * shared catalogue key so the phone, the TUI and the desktop agree
 * (`daemon.py:351-464`). The client must NOT re-sort.
 *
 * Two things this file deliberately keeps:
 *
 * - `stale`, which is "we are showing the last good frame" — the cold-start rule
 *   from `architecture.md` §Lifecycle: the last known list renders from cache
 *   immediately, marked stale, and the first push corrects it. A blank list while
 *   a stream reconnects is the failure this flag exists to prevent.
 * - `degraded` as the relay sends it (`"sessions"` / `"attention"`), because a
 *   listing the relay could not walk is not "you have no conversations".
 */

import { createStore } from "zustand/vanilla";

import type {
	Capabilities,
	SessionListFrame,
	SessionSummary,
	UnreadBlock,
} from "../contracts";

export interface ListSnapshot {
	sessions: SessionSummary[];
	/** The relay's own markers for the durable half of the listing. Empty means
	 *  healthy; present means say so, because a partial list is not an empty one. */
	degraded: string[];
	capabilities: Capabilities;
	/** The machine's own unread aggregate, off the frame the list already
	 *  repaints from (ADR 0006 §1.1). `null` until a frame carries it: an older
	 *  relay omits the block and that absence means **unknown, never 0** — the
	 *  badge reads `count` when it is a number and shows no number otherwise. */
	unread: UnreadBlock | null;
	/** How many frames have been applied. Surfaced for diagnostics and for a test to
	 *  assert a repaint happened. */
	frameCount: number;
	/** Epoch ms of the last applied frame, or `null` before the first. */
	lastFrameAt: number | null;
	/** True while what is shown is the last good frame rather than a live one. */
	stale: boolean;
}

export interface ListActions {
	/** Applies one full frame. Wholesale replacement, by design. */
	applyFrame: (
		frame: Pick<SessionListFrame, "sessions" | "degraded"> &
			Partial<Pick<SessionListFrame, "capabilities" | "unread">>,
		at?: number,
	) => void;
	/** Marks the rendered list as no longer live. Never clears it. */
	markStale: () => void;
	/** Discards everything. Used when a route ends: the rows belong to a different
	 *  computer. */
	reset: () => void;
}

export type ListStore = ListSnapshot & ListActions;

const INITIAL: ListSnapshot = {
	sessions: [],
	degraded: [],
	capabilities: {},
	unread: null,
	frameCount: 0,
	lastFrameAt: null,
	stale: true,
};

export function createListStore(deps: { now?: () => number } = {}) {
	const now = deps.now ?? (() => Date.now());
	return createStore<ListStore>()((set, get) => ({
		...INITIAL,

		applyFrame(frame, at) {
			set({
				/* Nothing is merged: the frame IS the list. */
				sessions: frame.sessions,
				degraded: frame.degraded,
				/* A frame that carries no capabilities must not erase the ones a previous
				 * frame established: `capabilities.stt` decides whether a mic exists, and
				 * blinking it off would remove and restore a control. */
				capabilities: frame.capabilities ?? get().capabilities,
				/* The same rule, one level of subtlety more: a relay that carries the
				 * block carries it on EVERY frame, so an absent block means an older
				 * relay — erasing a block a previous frame established would forget a
				 * count the machine did give us. A frame that carries the block always
				 * WINS, including when it says `degraded` (count absent, badge darkens
				 * again). */
				unread: frame.unread ?? get().unread,
				frameCount: get().frameCount + 1,
				lastFrameAt: at ?? now(),
				stale: false,
			});
		},

		markStale() {
			if (get().sessions.length === 0 && get().frameCount === 0) {
				/* Nothing has ever been painted, so "stale" would be describing data that
				 * does not exist. The empty state is honest here. */
				return;
			}
			set({ stale: true });
		},

		reset() {
			set({ ...INITIAL });
		},
	}));
}

export type ListStoreApi = ReturnType<typeof createListStore>;

/** True when the relay said part of the listing could not be produced. The UI is
 *  expected to say so rather than rendering a short list as if it were complete. */
export function hasDegradedListing(snapshot: ListSnapshot): boolean {
	return snapshot.degraded.length > 0;
}

/**
 * The local substring search the contract asks for: case-insensitive over name,
 * id and cwd, applied to the LOADED list only. The server-side search route is for
 * *past* sessions; the live list is searched in memory because it is complete.
 */
export function searchLoadedSessions(
	sessions: readonly SessionSummary[],
	query: string,
): SessionSummary[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return [...sessions];
	return sessions.filter((session) => {
		return (
			session.conversation_name.toLowerCase().includes(needle) ||
			session.session_id.toLowerCase().includes(needle) ||
			session.cwd.toLowerCase().includes(needle)
		);
	});
}

/** The display name for a row. An empty name is "untitled", never blank. */
export function sessionTitle(
	session: Pick<SessionSummary, "conversation_name">,
): string {
	const name = session.conversation_name.trim();
	return name.length > 0 ? name : "untitled";
}
