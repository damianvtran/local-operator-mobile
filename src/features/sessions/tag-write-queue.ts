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
	/**
	 * The conversation this press belongs to. It is a REQUEST field, not the
	 * sheet's current render: a queued write outlives the closing sheet, and
	 * resolving the subject at send time sent one conversation's tags to
	 * `/api/sessions//tags`, or to whichever row opened next (review round 2,
	 * R2-1).
	 */
	sessionId: string;
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
	/** Bumped by `reset`; an answer from an older generation is not reported. */
	private generation = 0;

	constructor(private readonly handlers: TagWriteQueueHandlers) {}

	/**
	 * Drop every write not yet sent and stop reporting the in-flight one.
	 *
	 * Called when the sheet's subject changes or it closes. The queued request
	 * was pressed for a conversation that is no longer on screen; sending it to
	 * the next subject would write one conversation's tags onto another, and
	 * sending it after close would target an empty id (review round 2, R2-1).
	 * The in-flight request is already on the wire and cannot be recalled, but
	 * its answer is ignored rather than painted onto a different sheet.
	 */
	reset(): void {
		this.generation += 1;
		this.queued = null;
	}

	/** Whether a newer press is waiting behind the in-flight request. */
	hasQueued(): boolean {
		return this.queued !== null;
	}

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
		void this.run(request, this.generation);
	}

	private async run(
		request: TagWriteRequest,
		generation: number,
	): Promise<void> {
		this.inFlight = request;
		this.handlers.onStart(request);
		try {
			const answer = await this.handlers.send(request);
			if (generation === this.generation) {
				this.handlers.onSettled(request, answer);
			}
		} catch (error) {
			if (generation === this.generation) {
				this.handlers.onRefused(request, error);
			}
		} finally {
			this.inFlight = null;
			const next = this.queued;
			this.queued = null;
			if (next === null) this.handlers.onIdle();
			else void this.run(next, this.generation);
		}
	}
}
