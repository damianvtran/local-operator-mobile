import { describe, expect, it } from "vitest";

import {
	REVIEW_DWELL_MS,
	ReadReceiptTracker,
	reviewToken,
	STALE_EVIDENCE_MS,
} from "@/features/notifications/notifications-read-receipts";

/**
 * The in-view receipt's gate, exercised as the matrix decisions D8 names.
 *
 * Every NEGATIVE here is a case the operator asked for by name ("scrolled-up,
 * modal-covered, child-view, unrendered anchor, activity in another pane/app,
 * long-idle return, new revision racing a receipt"). They are the tests that
 * matter: the positive is one test, and the negatives are what stop an automatic
 * path from clearing work the reader never saw.
 */

const ROW = { id: "n_audit", revision: 2 };
const T0 = 1_000_000;

/** A tracker in the one context a receipt is legal in: foreground, focused,
 *  uncovered, with one row rendered at T0. */
function ready() {
	return build({});
}

function build(options: {
	appActive?: boolean;
	focused?: boolean;
	covered?: boolean;
	renderedAt?: number;
	rows?: { id: string; revision: number }[];
}) {
	const tracker = new ReadReceiptTracker();
	tracker.setAppActive(options.appActive ?? true);
	tracker.setScreenFocused(options.focused ?? true);
	tracker.setCovered(options.covered ?? false);
	tracker.render(options.rows ?? [ROW], options.renderedAt ?? T0);
	return tracker;
}

describe("an in-view receipt is only sent when every fact holds", () => {
	it("sends nothing on a mount alone: no gesture means no claim", () => {
		const tracker = ready();
		/* Ten seconds of the row sitting on screen — a reader who has not touched
		 * anything may not even be there. */
		expect(tracker.due(T0 + 10_000)).toEqual([]);
	});

	it("sends nothing while the app is backgrounded", () => {
		const tracker = ready();
		tracker.setAppActive(false);
		tracker.noteInput(T0 + 100, "touch");
		expect(tracker.due(T0 + REVIEW_DWELL_MS + 1)).toEqual([]);
	});

	it("sends nothing when the inbox is not the focused route (a child view on top)", () => {
		const tracker = ready();
		tracker.setScreenFocused(false);
		tracker.noteInput(T0 + 100, "touch");
		expect(tracker.due(T0 + REVIEW_DWELL_MS + 1)).toEqual([]);
	});

	it("sends nothing when a sheet covers the list", () => {
		const tracker = ready();
		tracker.setCovered(true);
		tracker.noteInput(T0 + 100, "touch");
		expect(tracker.due(T0 + REVIEW_DWELL_MS + 1)).toEqual([]);
	});

	it("does not clear a row that scrolled OUT of view before the gesture", () => {
		const tracker = ready();
		/* The row left the screen… */
		tracker.render([], T0 + 10);
		/* …and the reader touched the list afterwards. */
		tracker.noteInput(T0 + 200, "touch");
		expect(tracker.due(T0 + REVIEW_DWELL_MS + 300)).toEqual([]);
	});

	it("does not clear a row that scrolled away and came back (dwell restarts)", () => {
		const tracker = ready();
		tracker.render([], T0 + 10);
		tracker.render([ROW], T0 + 20);
		tracker.noteInput(T0 + 30, "touch");
		/* Only 100 ms of visible time since it came back. */
		expect(tracker.due(T0 + 130)).toEqual([]);
		expect(tracker.due(T0 + 20 + REVIEW_DWELL_MS + 1)).toEqual([
			{ id: "n_audit", revision: 2 },
		]);
	});

	it("does not clear a row whose gesture arrived BEFORE it rendered", () => {
		const tracker = ready();
		tracker.noteInput(T0 - 1, "touch");
		expect(tracker.due(T0 + REVIEW_DWELL_MS + 1)).toEqual([]);
	});

	it("treats activity in another pane as no evidence: only this screen's gestures count", () => {
		/* `noteInput` is called by THIS screen's handlers, so a touch elsewhere
		 * never reaches the tracker. The absence is the proof, and it is what this
		 * test pins: a fresh tracker with no input sends nothing. */
		const tracker = ready();
		expect(tracker.evidence(T0 + 5_000)).toBeNull();
	});

	it("drops evidence that has gone stale (a long-idle return)", () => {
		const tracker = ready();
		tracker.noteInput(T0 + 100, "touch");
		expect(tracker.due(T0 + 100 + STALE_EVIDENCE_MS + 1)).toEqual([]);
	});

	it("does not sweep a NEW revision with the old revision's gesture", () => {
		const tracker = ready();
		tracker.noteInput(T0 + 100, "touch");
		/* An update lands: new revision, rendered after the gesture. */
		tracker.render([{ id: "n_audit", revision: 3 }], T0 + 200);
		expect(tracker.due(T0 + REVIEW_DWELL_MS + 300)).toEqual([]);
	});

	it("sends exactly one receipt for the row, and never re-sends an accepted one", () => {
		const tracker = ready();
		tracker.noteInput(T0 + 100, "touch");
		const due = tracker.due(T0 + REVIEW_DWELL_MS + 200);
		expect(due).toEqual([{ id: "n_audit", revision: 2 }]);
		tracker.settle(due);
		expect(tracker.due(T0 + REVIEW_DWELL_MS + 400)).toEqual([]);
	});

	it("keeps a skipped row eligible, so a refused receipt is retried", () => {
		const tracker = ready();
		tracker.noteInput(T0 + 100, "touch");
		/* The relay skipped it (a stale revision), so nothing is settled. */
		expect(tracker.due(T0 + REVIEW_DWELL_MS + 200)).toHaveLength(1);
		expect(tracker.due(T0 + REVIEW_DWELL_MS + 300)).toHaveLength(1);
	});

	it("carries the gesture's own kind as the evidence", () => {
		const tracker = ready();
		tracker.noteInput(T0 + 100, "scroll");
		expect(tracker.evidence(T0 + 200)).toEqual({
			input_kind: "scroll",
			input_at_ms: T0 + 100,
		});
	});

	it("keys the token by id and revision so two rows cannot collide", () => {
		expect(reviewToken({ id: "a@b", revision: 7 })).toBe("a@b@7");
	});
});
