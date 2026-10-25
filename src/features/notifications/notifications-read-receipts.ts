/**
 * The in-view read receipt: a fail-closed engine, and the reason it exists.
 *
 * The operator's rule (brief addendum 2, decisions D8) is two-sided: never miss
 * an item, but never make them go clear something they were just looking at. An
 * automatic read is therefore a CLAIM about the reader, and every claim has to
 * be one this app can actually make on the platform it runs on:
 *
 *  - the app is in the foreground (`AppState === "active"`),
 *  - the inbox screen is the focused route (not a child view, not a screen
 *    pushed over it),
 *  - nothing covers the list (a sheet, a dialog),
 *  - the exact row — by id AND revision — has actually been rendered,
 *  - a real touch/scroll arrived AFTER that revision rendered, so the reader's
 *    gesture is evidence they were present while it was on screen,
 *  - the row stayed for `SETTLE_MS` after that gesture, which rules out a
 *    finger that swiped past the row on its way somewhere else,
 *  - and the evidence is fresh: `STALE_EVIDENCE_MS`, the same 120 s window the
 *    desktop plane's guard uses.
 *
 * If ANY of those is false or unknown, nothing is sent and the row stays unread
 * for the explicit path to clear. That asymmetry is deliberate: a false
 * "unread" costs one glance, a false "read" loses the item.
 *
 * Two more rules live here rather than in the screen, because they are the ones
 * a capture or a test has to be able to prove:
 *
 *  - a NEW revision is a new row. The map is keyed by `<id>@<revision>`, so an
 *    update that arrives after the operator's touch is not swept up by it.
 *  - one receipt per row per session: a write that succeeded is remembered, so
 *    a second touch does not re-send it (and a failed one is retried, since the
 *    caller only marks what the relay accepted).
 */

export interface InboxToken {
	id: string;
	revision: number;
}

/** The token string used for every map in here. Exported so the screen keys its
 *  own reconciliation by the same identity. */
export function reviewToken(item: { id: string; revision: number }): string {
	return `${item.id}@${item.revision}`;
}

/** How long a row must stay on screen after the touch before it counts. */
export const REVIEW_DWELL_MS = 1_000;

/** How old a touch may be and still count as evidence. Matches the server's
 *  `120 s` freshness window (`tui`/desktop guards) — a touch from ten minutes
 *  ago is not evidence that the row in front of the reader now was seen. */
export const STALE_EVIDENCE_MS = 120_000;

export interface ReceiptContext {
	/** `AppState === "active"`. A backgrounded app cannot claim the reader saw
	 *  anything; iOS may even have suspended it mid-render. */
	appActive: boolean;
	/** The inbox route is focused. A pushed detail screen means this list is
	 *  behind another view, which is exactly the "child view" the doctrine
	 *  excludes. */
	screenFocused: boolean;
	/** Something is drawn over the list (a sheet or a dialog). */
	covered: boolean;
}

export interface ReceiptClock {
	/** The last trusted gesture's timestamp (ms) on THIS screen, or `null`. */
	inputAtMs: number | null;
	inputKind: "touch" | "press" | "scroll" | "focus";
}

export class ReadReceiptTracker {
	private context: ReceiptContext = {
		appActive: false,
		screenFocused: false,
		covered: false,
	};
	private clock: ReceiptClock = { inputAtMs: null, inputKind: "touch" };
	/** `<id>@<revision>` → when that exact revision first rendered. */
	private readonly rendered = new Map<string, number>();
	/** Tokens the relay accepted; never re-sent in this session. */
	private readonly settled = new Set<string>();

	setAppActive(active: boolean): void {
		this.context = { ...this.context, appActive: active };
	}

	setScreenFocused(focused: boolean): void {
		this.context = { ...this.context, screenFocused: focused };
	}

	setCovered(covered: boolean): void {
		this.context = { ...this.context, covered };
	}

	/** A trusted gesture. `nowMs` comes from the platform event, not from a
	 *  timer's idea of when the gesture might have happened. */
	noteInput(nowMs: number, kind: ReceiptClock["inputKind"]): void {
		this.clock = { inputAtMs: nowMs, inputKind: kind };
	}

	/**
	 * Tell the tracker which rows are on screen, and when they first were.
	 *
	 * A row absent from this call has left the screen, so its render stamp goes:
	 * scrolling a row away and back must restart the dwell, otherwise a row that
	 * scrolled past the viewport would accumulate "visible" time it never had.
	 */
	render(items: ReadonlyArray<InboxToken>, nowMs: number): void {
		const visible = new Set<string>();
		for (const item of items) {
			const token = reviewToken(item);
			visible.add(token);
			if (!this.rendered.has(token)) this.rendered.set(token, nowMs);
		}
		for (const token of [...this.rendered.keys()]) {
			if (!visible.has(token)) this.rendered.delete(token);
		}
	}

	/** The evidence a receipt would carry right now, or `null` when the context
	 *  cannot support one at all. */
	evidence(
		nowMs: number,
	): { input_kind: ReceiptClock["inputKind"]; input_at_ms: number } | null {
		if (
			!this.context.appActive ||
			!this.context.screenFocused ||
			this.context.covered
		) {
			return null;
		}
		const inputAtMs = this.clock.inputAtMs;
		if (inputAtMs === null) return null;
		if (nowMs - inputAtMs > STALE_EVIDENCE_MS) return null;
		return { input_kind: this.clock.inputKind, input_at_ms: inputAtMs };
	}

	/**
	 * The rows due a receipt at `nowMs`.
	 *
	 * Each condition below is one of the header's clauses, in the order a reader
	 * would ask about them; none is implied by another.
	 */
	due(nowMs: number): InboxToken[] {
		const evidence = this.evidence(nowMs);
		if (evidence === null) return [];
		const due: InboxToken[] = [];
		for (const [token, renderedAtMs] of this.rendered) {
			if (this.settled.has(token)) continue;
			/* The gesture must be LATER than the render of this exact revision: an
			 * update published after the touch was not what the touch was about. */
			if (evidence.input_at_ms < renderedAtMs) continue;
			if (nowMs - renderedAtMs < REVIEW_DWELL_MS) continue;
			const [id, revision] = splitToken(token);
			if (id === null) continue;
			due.push({ id, revision });
		}
		return due;
	}

	/** Record what the relay accepted. Only `changed` tokens are marked — a
	 *  skipped row (stale, or a live ask) stays eligible, and the next read will
	 *  re-key it if it really moved. */
	settle(accepted: ReadonlyArray<InboxToken>): void {
		for (const item of accepted) this.settled.add(reviewToken(item));
	}

	/** A new page (filter change, a full reload) starts from a blank render map:
	 *  rows re-enter the screen and must earn their dwell again. The settled set
	 *  and the clock survive, because the reader has not left. */
	resetView(): void {
		this.rendered.clear();
	}
}

function splitToken(token: string): [string, number] | [null, null] {
	const at = token.lastIndexOf("@");
	if (at <= 0) return [null, null];
	const id = token.slice(0, at);
	const revision = Number(token.slice(at + 1));
	if (!Number.isFinite(revision)) return [null, null];
	return [id, revision];
}
