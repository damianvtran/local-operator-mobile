import type { SessionTagsResponse } from "@/contracts";
import type { TagWrite } from "@/features/sessions/tags";

/**
 * One write at a time, with the newest pressed state queued behind it.
 *
 * WHY A QUEUE, and why it lives here rather than in the sheet's component. A
 * second toggle pressed while the first was unanswered used to be DROPPED
 * silently (`if (pending !== null) return`) — the checkbox did not move, nothing
 * said why, and the reader's change was simply not sent (review round 1, U2).
 * The route is idempotent and takes a whole DESIRED state, so the correct
 * behaviour is to keep accepting presses: the checkbox moves optimistically,
 * and the newest desired state replaces any older queued one, because an older
 * state would resurrect a selection the reader has already undone.
 *
 * The component still owns what a write MEANS — the optimistic draft, the
 * read-back, the refusal and its revert. This module owns only the order: never
 * two requests in flight, always send the latest press, and always come to rest
 * (an `onIdle` after either outcome) so a failed write cannot leave the sheet
 * believing one is still running.
 *
 * Nothing here imports `react-native`, so the ordering rules are testable in
 * Node — the same reason `tags.ts` is a plain module.
 */
export type TagWriteRequest = {
	/** The whole desired state (never a delta): the route's own contract. */
	desired: TagWrite;
	/**
	 * The control that asked: a tag id, or `"*"` for Remove all. It is only a
	 * display/state key — the sheet paints "Saving…" on that row — never a
	 * request field.
	 */
	key: string;
};

export type TagWriteQueueHandlers = {
	/** Sends ONE desired state. Rejection is the relay's refusal. */
	send: (request: TagWriteRequest) => Promise<SessionTagsResponse>;
	/** A request is now the one in flight. */
	onStart: (request: TagWriteRequest) => void;
	/** The relay answered canonically; paint this answer. */
	onSettled: (request: TagWriteRequest, answer: SessionTagsResponse) => void;
	/** The relay refused (or the transport failed): revert and say so. */
	onRefused: (request: TagWriteRequest, error: unknown) => void;
	/** No request is in flight and none is queued. */
	onIdle: () => void;
};

export class TagWriteQueue {
	private inFlight: TagWriteRequest | null = null;
	private queued: TagWriteRequest | null = null;

	constructor(private readonly handlers: TagWriteQueueHandlers) {}

	/**
	 * Ask for a desired state. A press while one write is in flight replaces the
	 * QUEUED state (coalescing to the newest); it never starts a second request
	 * and never disappears.
	 */
	push(request: TagWriteRequest): void {
		if (this.inFlight !== null) {
			this.queued = request;
			return;
		}
		void this.run(request);
	}

	private async run(request: TagWriteRequest): Promise<void> {
		this.inFlight = request;
		this.handlers.onStart(request);
		try {
			const answer = await this.handlers.send(request);
			this.handlers.onSettled(request, answer);
		} catch (error) {
			this.handlers.onRefused(request, error);
		} finally {
			this.inFlight = null;
			const next = this.queued;
			this.queued = null;
			if (next === null) this.handlers.onIdle();
			else void this.run(next);
		}
	}
}
