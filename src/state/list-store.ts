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
	NotificationsBlock,
	SessionListFrame,
	SessionSummary,
	UnreadBlock,
} from "../contracts";

export interface ListSnapshot {
	/** Reset is an identity boundary, even when the same computer reconnects. */
	connectionGeneration: number;
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
	/** The inbox's counts off the same frame (`notifications`, contract §5.4).
	 *  `null` until a frame carries it — an older relay omits the block, and that
	 *  absence is UNKNOWN, never 0: the entry points draw no number. */
	notifications: NotificationsBlock | null;
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
			Partial<
				Pick<SessionListFrame, "capabilities" | "unread" | "notifications">
			>,
		at?: number,
		connectionGeneration?: number,
	) => void;
	/** Applies the inbox counts a fresher `GET /api/notifications` answer carried,
	 *  so the badge and the inbox's own count line agree at the same moment. */
	applyInboxCounts: (
		block: NotificationsBlock,
		connectionGeneration: number,
	) => void;
	/** Marks the rendered list as no longer live. Never clears it. */
	markStale: () => void;
	/** Discards everything. Used when a route ends: the rows belong to a different
	 *  computer. */
	reset: () => void;
}

export type ListStore = ListSnapshot & ListActions;

const INITIAL: ListSnapshot = {
	connectionGeneration: 0,
	sessions: [],
	degraded: [],
	capabilities: {},
	unread: null,
	notifications: null,
	frameCount: 0,
	lastFrameAt: null,
	stale: true,
};

export function createListStore(deps: { now?: () => number } = {}) {
	const now = deps.now ?? (() => Date.now());
	// Keep freshness even while a degraded frame hides the badge. Otherwise an
	// old healthy answer could revive a stale number after a newer unknown one.
	let inboxWatermark: number | undefined;
	const admitCounts = (
		held: NotificationsBlock | null,
		block: NotificationsBlock,
	): NotificationsBlock | null => {
		const known = notificationsOrNull(block);
		if (known === null) return null;
		if (
			inboxWatermark !== undefined &&
			(known.high_water === undefined || known.high_water < inboxWatermark)
		)
			return held;
		inboxWatermark = known.high_water;
		return known;
	};
	return createStore<ListStore>()((set, get) => ({
		...INITIAL,

		applyFrame(frame, at, connectionGeneration = get().connectionGeneration) {
			if (connectionGeneration !== get().connectionGeneration) return;
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
				/* Same retention rule as `unread`, for the same reason: a relay that
				 * publishes the inbox block publishes it on every frame, so absence
				 * means an older relay rather than "the counts vanished". */
				/* A PRESENT BLOCK WITH NO COUNTS IS UNKNOWN, NOT A ZERO — the core
				 * answers `{}` when its inbox store cannot be read ("unknown, never
				 * zero", `daemon.py` `_notifications_block`). Mapping it to `null`
				 * keeps the badge dark while the block is unreadable, and — because
				 * the schema now accepts the empty block — the sessions frame this
				 * list depends on is no longer dropped over it (NC5). */
				// HTTP and SSE are unordered transports. Both must use the same
				// watermark; absence retains, but a present empty block is unknown.
				notifications:
					frame.notifications === undefined
						? get().notifications
						: admitCounts(get().notifications, frame.notifications),
				frameCount: get().frameCount + 1,
				lastFrameAt: at ?? now(),
				stale: false,
			});
		},

		applyInboxCounts(block, connectionGeneration) {
			// A mounted inbox may finish IO after beginRoute resets this store.
			// Requiring its captured generation prevents counts from crossing
			// computers/accounts, including a return to the same client identity.
			if (connectionGeneration !== get().connectionGeneration) return;
			if (notificationsOrNull(block) === null) return;
			set({ notifications: admitCounts(get().notifications, block) });
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
			inboxWatermark = undefined;
			set({ ...INITIAL, connectionGeneration: get().connectionGeneration + 1 });
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

/** The block as the store keeps it: a known count is a block, anything else is
 *  `null` (unknown). One helper so the SSE path, the cold GET and a reconnect
 *  cannot read the same `{}` three ways. */
export function notificationsOrNull(
	block: NotificationsBlock | null | undefined,
): NotificationsBlock | null {
	if (block === null || block === undefined) return null;
	if (block.unread_count === undefined) return null;
	return block;
}
