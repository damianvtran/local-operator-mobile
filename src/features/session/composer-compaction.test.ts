import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ComposerCompaction,
	createComposerCompaction,
	FLING_PT_PER_S,
	HOLD_MS,
	SHRINK_DISTANCE_PT,
	TAIL_BAND_PT,
	TAIL_DWELL_MS,
	TOWARD_TAIL_MIN_PT,
} from "./composer-compaction";

/* The clock and the timers are vitest's fake pair: `Date.now` is the policy's
 *  default clock, and `setTimeout` is what the dwell arms. */
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(1_000_000);
});
afterEach(() => {
	vi.useRealTimers();
});

const read = (path: string) =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** A reader's drag from `from` to `to`, mid-transcript (200 pt from the tail at
 *  the start, moving with the offset), released at `velocity` pt/s. */
const drag = (
	c: ComposerCompaction,
	{
		from = 1000,
		to,
		velocity = 0,
	}: { from?: number; to: number; velocity?: number },
) => {
	c.beginDrag(from);
	c.noteOffset(from, 500);
	c.noteOffset(to, 500 - (to - from));
	c.endDrag(velocity);
};
const flips = (c: ComposerCompaction) => {
	const seen: boolean[] = [];
	c.subscribe((value) => seen.push(value));
	return seen;
};

describe("the design values", () => {
	it("are the spec's, named", () => {
		expect([
			SHRINK_DISTANCE_PT,
			FLING_PT_PER_S,
			TAIL_BAND_PT,
			TAIL_DWELL_MS,
			HOLD_MS,
			TOWARD_TAIL_MIN_PT,
		]).toEqual([24, 1000, 16, 150, 300, 6]);
		/* The band stays under the shrink distance so one drag cannot satisfy both
		 *  rules at the boundary. */
		expect(TAIL_BAND_PT).toBeLessThan(SHRINK_DISTANCE_PT);
	});
});

describe("shrinking", () => {
	it("starts as the card", () => {
		expect(createComposerCompaction().readShrunk()).toBe(false);
	});

	it("shrinks when a reader's drag nets 24 pt, either direction, during the drag", () => {
		for (const to of [1000 + SHRINK_DISTANCE_PT, 1000 - SHRINK_DISTANCE_PT]) {
			const c = createComposerCompaction();
			c.beginDrag(1000);
			c.noteOffset(to - Math.sign(to - 1000), 480);
			expect(c.readShrunk()).toBe(false);
			c.noteOffset(to, 480);
			expect(c.readShrunk()).toBe(true);
		}
	});

	it("does not shrink below the threshold", () => {
		const c = createComposerCompaction();
		drag(c, { to: 1000 + SHRINK_DISTANCE_PT - 1 });
		expect(c.readShrunk()).toBe(false);
	});

	it("measures NET distance: a long wander that returns does not shrink", () => {
		const c = createComposerCompaction();
		c.beginDrag(1000);
		for (const y of [1010, 1020, 1010, 1000, 990, 1000]) c.noteOffset(y, 400);
		c.endDrag(0);
		expect(c.readShrunk()).toBe(false);
	});

	it("shrinks on a release at 1000 pt/s even after a short drag, either sign", () => {
		for (const velocity of [FLING_PT_PER_S, -FLING_PT_PER_S]) {
			const c = createComposerCompaction();
			drag(c, { to: 1008, velocity });
			expect(c.readShrunk()).toBe(true);
		}
	});

	it("does not shrink on a release just under the fling speed", () => {
		const c = createComposerCompaction();
		drag(c, { to: 1008, velocity: FLING_PT_PER_S - 1 });
		expect(c.readShrunk()).toBe(false);
	});

	it("ignores a fling that ends at the tail (nowhere to go; the dwell would undo it)", () => {
		const c = createComposerCompaction();
		c.beginDrag(2000);
		c.noteOffset(2004, 4);
		c.endDrag(FLING_PT_PER_S * 3);
		expect(c.readShrunk()).toBe(false);
	});

	it("shrinks on a fling AWAY from the tail that starts inside the band (QA Q3)", () => {
		const c = createComposerCompaction();
		c.noteOffset(2000, 0, 700);
		c.beginDrag(2000);
		c.noteOffset(1996, 4, 700);
		/* Negative: the offset is falling, the reader is leaving the end. */
		c.endDrag(-FLING_PT_PER_S * 3);
		expect(c.readShrunk()).toBe(true);
	});

	it("does not shrink on a fling toward the tail from inside the band, bounce included (QA Q3)", () => {
		for (const [offset, distance] of [
			[1996, 4],
			[2010, -10],
		] as const) {
			const c = createComposerCompaction();
			c.noteOffset(1990, 10, 700);
			c.beginDrag(1990);
			c.noteOffset(offset, distance, 700);
			c.endDrag(FLING_PT_PER_S * 3);
			expect(c.readShrunk(), `${offset}`).toBe(false);
		}
	});

	it("ignores elastic overscroll at the tail: bounce is not travel", () => {
		const c = createComposerCompaction();
		c.beginDrag(2000);
		c.noteOffset(2000, 0);
		/* Pulled 40 pt past the end: the offset moved 40, the reader went nowhere. */
		c.noteOffset(2040, -40);
		expect(c.readShrunk()).toBe(false);
	});

	it("never shrinks from momentum alone", () => {
		const c = createComposerCompaction();
		c.setCoasting(true);
		for (let y = 1000; y > 0; y -= 40) c.noteOffset(y, 1000 - y);
		expect(c.readShrunk()).toBe(false);
		c.setCoasting(false);
		expect(c.readShrunk()).toBe(false);
	});

	it("never shrinks from a scroll the app made (tail pin, history load, reveal)", () => {
		const c = createComposerCompaction();
		/* No drag is held for any of these. */
		c.noteOffset(500, 800);
		c.noteOffset(5000, 300);
		c.noteOffset(0, 4000);
		expect(c.readShrunk()).toBe(false);
	});

	it("a new drag ends a glide it caught", () => {
		const c = createComposerCompaction();
		c.setCoasting(true);
		drag(c, { to: 1000 + SHRINK_DISTANCE_PT });
		expect(c.readShrunk()).toBe(true);
	});

	it("emits once per flip, not per event", () => {
		const c = createComposerCompaction();
		const seen = flips(c);
		c.beginDrag(1000);
		c.noteOffset(1030, 400);
		c.noteOffset(1060, 400);
		c.noteOffset(1090, 400);
		expect(seen).toEqual([true]);
	});
});

describe("the hold between scroll-driven flips", () => {
	it("refuses a second scroll-driven flip inside 300 ms and allows it after", () => {
		const c = createComposerCompaction();
		drag(c, { to: 1040 });
		expect(c.readShrunk()).toBe(true);
		/* Settle at the tail at once: the dwell is 150 ms but the hold is 300. */
		c.noteOffset(2000, 0);
		vi.advanceTimersByTime(TAIL_DWELL_MS);
		expect(c.readShrunk()).toBe(true);
		vi.advanceTimersByTime(HOLD_MS - TAIL_DWELL_MS);
		expect(c.readShrunk()).toBe(false);
	});

	it("does not drop the grow-back for good when the hold ate it", () => {
		const c = createComposerCompaction();
		drag(c, { to: 1040 });
		c.noteOffset(2000, 0);
		vi.advanceTimersByTime(1000);
		expect(c.readShrunk()).toBe(false);
	});

	it("holds a shrink that follows a scroll-driven grow", () => {
		const c = createComposerCompaction();
		drag(c, { to: 1040 });
		vi.advanceTimersByTime(HOLD_MS);
		c.noteOffset(2000, 0);
		vi.advanceTimersByTime(TAIL_DWELL_MS);
		expect(c.readShrunk()).toBe(false);
		/* The grow just happened; a drag 10 ms later waits out the hold. */
		vi.advanceTimersByTime(10);
		drag(c, { from: 2000, to: 1960 });
		expect(c.readShrunk()).toBe(false);
		vi.advanceTimersByTime(HOLD_MS);
		c.beginDrag(1960);
		c.noteOffset(1930, 100);
		expect(c.readShrunk()).toBe(true);
	});

	it("lets the reader's own intent beat the hold", () => {
		const c = createComposerCompaction();
		drag(c, { to: 1040 });
		expect(c.readShrunk()).toBe(true);
		c.grow();
		expect(c.readShrunk()).toBe(false);
	});
});

describe("growing back", () => {
	const shrunk = () => {
		const c = createComposerCompaction();
		drag(c, { to: 1040 });
		vi.advanceTimersByTime(HOLD_MS);
		return c;
	};

	it("grows after settling within 16 pt of the tail for 150 ms", () => {
		const c = shrunk();
		c.noteOffset(1990, TAIL_BAND_PT);
		vi.advanceTimersByTime(TAIL_DWELL_MS - 1);
		expect(c.readShrunk()).toBe(true);
		vi.advanceTimersByTime(1);
		expect(c.readShrunk()).toBe(false);
	});

	it("does not grow just outside the band", () => {
		const c = shrunk();
		c.noteOffset(1980, TAIL_BAND_PT + 1);
		vi.advanceTimersByTime(5000);
		expect(c.readShrunk()).toBe(true);
	});

	it("restarts the dwell when the reader leaves the band", () => {
		const c = shrunk();
		c.noteOffset(1990, 5);
		vi.advanceTimersByTime(TAIL_DWELL_MS - 10);
		c.noteOffset(1900, 100);
		vi.advanceTimersByTime(1000);
		expect(c.readShrunk()).toBe(true);
	});

	it("does not grow while a finger is down or a glide is running", () => {
		const c = shrunk();
		c.beginDrag(1990);
		c.noteOffset(1995, 5);
		vi.advanceTimersByTime(5000);
		expect(c.readShrunk()).toBe(true);
		c.endDrag(0);
		c.setCoasting(true);
		vi.advanceTimersByTime(5000);
		expect(c.readShrunk()).toBe(true);
		c.setCoasting(false);
		vi.advanceTimersByTime(TAIL_DWELL_MS);
		expect(c.readShrunk()).toBe(false);
	});

	it("grows on jump-to-latest / a send / a tap on the pill (`grow`)", () => {
		const c = shrunk();
		c.noteOffset(900, 1100);
		c.grow();
		expect(c.readShrunk()).toBe(false);
	});

	it("after an intent grow the next scroll-driven shrink is not held", () => {
		const c = createComposerCompaction();
		drag(c, { to: 1040 });
		c.grow();
		drag(c, { to: 1040 });
		expect(c.readShrunk()).toBe(true);
	});
});

/* R1 (review round 1). Shrinking hands the list the dock's 56 pt, so the same
 *  finger position reads 56 pt closer to the tail on the next offset event. The
 *  tail test is made in the card's frame (raw distance + the viewport growth
 *  since the flip), so that resize alone can never grow the dock back. */
describe("the tail test does not feed on the dock's own resize (R1)", () => {
	const VIEWPORT = 700;
	const DELTA = 56;
	/** A drag AWAY from the tail from a reader parked at it, in 4 pt steps, the way
	 *  the platform reports it. Once the dock shrank, the list is `DELTA` taller:
	 *  an offset event at the same finger position reads `DELTA` closer. Returns
	 *  the signal with the finger released and `after` ms elapsed. */
	const dragAwayFromTail = (net: number, after: number) => {
		const c = createComposerCompaction();
		c.noteOffset(1000, 0, VIEWPORT);
		c.beginDrag(1000);
		let resized = false;
		for (let y = 4; y <= net; y += 4) {
			c.noteOffset(
				1000 - y,
				y - (resized ? DELTA : 0),
				VIEWPORT + (resized ? DELTA : 0),
			);
			if (c.readShrunk()) resized = true;
		}
		/* The offset event the platform sends once the list has resized. */
		if (resized) c.noteOffset(1000 - net, net - DELTA, VIEWPORT + DELTA);
		c.endDrag(0);
		vi.advanceTimersByTime(after);
		return c;
	};

	it("keeps a drag under the shrink distance a card", () => {
		expect(dragAwayFromTail(20, 1000).readShrunk()).toBe(false);
	});

	it("keeps a 30–72 pt drag shrunk after the post-resize event, the release and >450 ms", () => {
		for (const net of [28, 32, 40, 60, 72]) {
			const c = dragAwayFromTail(net, HOLD_MS + TAIL_DWELL_MS + 1);
			expect(c.readShrunk(), `drag ${net}`).toBe(true);
		}
	});

	it("keeps an 80 pt drag shrunk (it never read as the tail)", () => {
		expect(dragAwayFromTail(80, 2000).readShrunk()).toBe(true);
	});

	it("emits the shrink once and no grow for the flicker drags", () => {
		for (const net of [32, 60, 72]) {
			const c = createComposerCompaction();
			const seen = flips(c);
			c.noteOffset(1000, 0, VIEWPORT);
			c.beginDrag(1000);
			let resized = false;
			for (let y = 4; y <= net; y += 4) {
				c.noteOffset(
					1000 - y,
					y - (resized ? DELTA : 0),
					VIEWPORT + (resized ? DELTA : 0),
				);
				if (c.readShrunk()) resized = true;
			}
			c.noteOffset(1000 - net, net - DELTA, VIEWPORT + DELTA);
			c.endDrag(0);
			vi.advanceTimersByTime(2000);
			expect(seen, `drag ${net}`).toEqual([true]);
			c.dispose();
		}
	});

	it("ignores offset events from the resize's own morph (the viewport grows frame by frame)", () => {
		const c = createComposerCompaction();
		c.noteOffset(1000, 0, VIEWPORT);
		c.beginDrag(1000);
		c.noteOffset(960, 40, VIEWPORT);
		expect(c.readShrunk()).toBe(true);
		for (const grown of [14, 28, 42, 56])
			c.noteOffset(960, 40 - grown, VIEWPORT + grown);
		c.endDrag(0);
		vi.advanceTimersByTime(2000);
		expect(c.readShrunk()).toBe(true);
	});

	it("still grows when the reader genuinely returns to the tail", () => {
		/* Dragged 120 pt away (the list is 56 pt taller from here), then dragged
		 *  back down to the end of the transcript: 64 -> 0 in the pill's viewport. */
		const c = createComposerCompaction();
		c.noteOffset(1000, 0, VIEWPORT);
		c.beginDrag(1000);
		c.noteOffset(940, 60, VIEWPORT);
		c.noteOffset(880, 120 - DELTA, VIEWPORT + DELTA);
		expect(c.readShrunk()).toBe(true);
		c.endDrag(0);
		vi.advanceTimersByTime(HOLD_MS);
		c.beginDrag(880);
		c.noteOffset(940, 64 - 60, VIEWPORT + DELTA);
		c.noteOffset(944, 0, VIEWPORT + DELTA);
		c.endDrag(0);
		vi.advanceTimersByTime(TAIL_DWELL_MS - 1);
		expect(c.readShrunk()).toBe(true);
		vi.advanceTimersByTime(1);
		expect(c.readShrunk()).toBe(false);
	});

	it("still grows for a return without lifting the finger, once released", () => {
		const c = createComposerCompaction();
		c.noteOffset(1000, 0, VIEWPORT);
		c.beginDrag(1000);
		c.noteOffset(900, 100, VIEWPORT);
		expect(c.readShrunk()).toBe(true);
		c.noteOffset(900, 100 - DELTA, VIEWPORT + DELTA);
		c.noteOffset(1000, 0, VIEWPORT + DELTA);
		c.endDrag(0);
		vi.advanceTimersByTime(HOLD_MS + TAIL_DWELL_MS);
		expect(c.readShrunk()).toBe(false);
	});

	it("reads the raw distance when no viewport is reported", () => {
		const c = createComposerCompaction();
		drag(c, { to: 1040 });
		c.noteOffset(1990, 0);
		vi.advanceTimersByTime(HOLD_MS + TAIL_DWELL_MS);
		expect(c.readShrunk()).toBe(false);
	});
});

describe("a transcript with nothing to scroll (QA Q1, UX U4)", () => {
	it("does not shrink on a bounce when the content fits the viewport", () => {
		const c = createComposerCompaction();
		c.noteOffset(0, -300, 600);
		c.beginDrag(0);
		c.noteOffset(-30, -270, 600);
		expect(c.readShrunk()).toBe(false);
		c.noteOffset(-80, -220, 600);
		c.noteOffset(30, -330, 600);
		c.endDrag(0);
		expect(c.readShrunk()).toBe(false);
	});

	it("does not shrink on a fling there either, and a content exactly the viewport's tall does not scroll", () => {
		for (const [distance, velocity] of [
			[-300, FLING_PT_PER_S * 3],
			[-300, -FLING_PT_PER_S * 3],
			[0, FLING_PT_PER_S * 3],
		] as const) {
			const c = createComposerCompaction();
			c.noteOffset(0, distance, 600);
			c.beginDrag(0);
			c.noteOffset(0, distance, 600);
			c.endDrag(velocity);
			expect(c.readShrunk(), `${distance} ${velocity}`).toBe(false);
		}
	});

	it("still shrinks once the content is taller than the viewport by even a little", () => {
		const c = createComposerCompaction();
		c.noteOffset(0, 40, 600);
		c.beginDrag(0);
		c.noteOffset(30, 10, 600);
		expect(c.readShrunk()).toBe(true);
	});

	it("reads the range from the offset, so the overscroll of a bounce does not hide a scrollable list", () => {
		const c = createComposerCompaction();
		c.noteOffset(0, 1400, 600);
		c.beginDrag(0);
		/* Pulled 30 pt past the top: offset −30, the tail 30 pt farther away. */
		c.noteOffset(-30, 1430, 600);
		expect(c.readShrunk()).toBe(false);
		c.noteOffset(40, 1360, 600);
		expect(c.readShrunk()).toBe(true);
	});
});

describe("settling at the tail after a finger run toward it (UX U2)", () => {
	const END = 1700;
	const VIEWPORT = 700;
	const DELTA = 56;
	/** A reader parked at the tail who drags `net` pt away and lets go: the list
	 *  is clamped to its new end once the dock shrinks, as a real one is. Returns
	 *  the signal and a reporter for the pill's frame. */
	const peekedAway = (net: number) => {
		const c = createComposerCompaction();
		let viewport = VIEWPORT;
		const report = (y: number) => {
			const clamped = Math.min(y, END - viewport);
			c.noteOffset(clamped, END - clamped - viewport, viewport);
			return clamped;
		};
		report(END - VIEWPORT);
		c.beginDrag(END - VIEWPORT);
		let y = END - VIEWPORT;
		for (let s = 4; s <= net; s += 4) {
			y = END - VIEWPORT - s;
			report(y);
			if (c.readShrunk() && viewport === VIEWPORT) {
				viewport += DELTA;
				report(y);
			}
		}
		c.endDrag(0);
		vi.advanceTimersByTime(HOLD_MS + TAIL_DWELL_MS + 1);
		/* The finger's own moves after the resize: unclamped, because a finger may
		 *  pull the list past its end (the elastic overscroll). */
		const push = (to: number) =>
			c.noteOffset(to, END - to - viewport, viewport);
		return { c, push, rest: Math.min(y, END - viewport), viewport };
	};
	/** A separate drag by the finger of `by` pt toward the tail in 2 pt steps. */
	const dragToward = (
		peek: ReturnType<typeof peekedAway>,
		by: number,
		from = peek.rest,
	) => {
		peek.c.beginDrag(from);
		for (let s = 2; s <= by; s += 2) peek.push(from + s);
		peek.c.endDrag(0);
		vi.advanceTimersByTime(HOLD_MS + TAIL_DWELL_MS + 1);
	};

	it("leaves a nudge away and idle a pill (the reader is reading)", () => {
		for (const net of [30, 56, 80]) {
			const peek = peekedAway(net);
			expect(peek.c.readShrunk(), `${net}`).toBe(true);
			vi.advanceTimersByTime(2000);
			expect(peek.c.readShrunk(), `${net} idle`).toBe(true);
		}
	});

	it("grows when the reader drags back toward the tail by the threshold, from every shallow peek", () => {
		for (const net of [30, 40, 56, 72, 80, 100, 150]) {
			const peek = peekedAway(net);
			dragToward(peek, net);
			expect(peek.c.readShrunk(), `${net}`).toBe(false);
		}
	});

	it("grows on a one-finger return: up 30 and back to the start in the same drag (T2c)", () => {
		const c = createComposerCompaction();
		c.noteOffset(1000, 0, VIEWPORT);
		c.beginDrag(1000);
		c.noteOffset(970, 30, VIEWPORT);
		expect(c.readShrunk()).toBe(true);
		c.noteOffset(970, 30 - DELTA, VIEWPORT + DELTA);
		for (let y = 974; y <= 1000; y += 4) c.noteOffset(y, 0, VIEWPORT + DELTA);
		c.endDrag(0);
		vi.advanceTimersByTime(HOLD_MS + TAIL_DWELL_MS + 1);
		expect(c.readShrunk()).toBe(false);
	});

	it("counts the overscroll: a pull past the end by the threshold is a run toward it", () => {
		const peek = peekedAway(40);
		peek.c.beginDrag(peek.rest);
		peek.c.noteOffset(peek.rest + 4, -4, peek.viewport);
		peek.c.noteOffset(
			peek.rest + TOWARD_TAIL_MIN_PT,
			-TOWARD_TAIL_MIN_PT,
			peek.viewport,
		);
		peek.c.endDrag(0);
		vi.advanceTimersByTime(HOLD_MS + TAIL_DWELL_MS + 1);
		expect(peek.c.readShrunk()).toBe(false);
	});

	it("needs the whole threshold: one point short stays a pill", () => {
		const peek = peekedAway(40);
		dragToward(peek, TOWARD_TAIL_MIN_PT - 1, peek.rest);
		expect(peek.c.readShrunk()).toBe(true);
	});

	it("resets on a reversal: the run is the last one, not the sum", () => {
		const peek = peekedAway(40);
		peek.c.beginDrag(peek.rest);
		peek.push(peek.rest + 4);
		peek.push(peek.rest + 2);
		peek.push(peek.rest + 5);
		peek.c.endDrag(0);
		vi.advanceTimersByTime(HOLD_MS + TAIL_DWELL_MS + 1);
		expect(peek.c.readShrunk()).toBe(true);
	});

	it("resets at the next touch: two short drags are not one run", () => {
		const peek = peekedAway(40);
		dragToward(peek, TOWARD_TAIL_MIN_PT - 2, peek.rest);
		dragToward(peek, TOWARD_TAIL_MIN_PT - 2, peek.rest);
		expect(peek.c.readShrunk()).toBe(true);
	});

	it("is not fed by offsets the app made: a tail pin outside a drag does not grow a nudge", () => {
		const peek = peekedAway(40);
		for (let s = 1; s <= 20; s++) peek.push(peek.rest + s);
		vi.advanceTimersByTime(2000);
		expect(peek.c.readShrunk()).toBe(true);
	});

	it("does not bring back the flicker: a 24–72 pt drag away stays shrunk after the post-resize event", () => {
		for (const net of [24, 28, 40, 56, 72]) {
			const peek = peekedAway(net);
			vi.advanceTimersByTime(2000);
			expect(peek.c.readShrunk(), `${net}`).toBe(true);
		}
	});
});

describe("pins", () => {
	it("refuse a shrink while pinned", () => {
		const c = createComposerCompaction();
		c.setPinned(true);
		drag(c, { to: 1100, velocity: 5000 });
		expect(c.readShrunk()).toBe(false);
	});

	it("grow a shrunk dock back at once when one appears, hold or not", () => {
		const c = createComposerCompaction();
		drag(c, { to: 1040 });
		expect(c.readShrunk()).toBe(true);
		c.setPinned(true);
		expect(c.readShrunk()).toBe(false);
	});

	it("do not shrink the dock again when released; only a new gesture does", () => {
		const c = createComposerCompaction();
		drag(c, { to: 1040 });
		c.setPinned(true);
		c.setPinned(false);
		expect(c.readShrunk()).toBe(false);
		vi.advanceTimersByTime(HOLD_MS);
		drag(c, { to: 1040 });
		expect(c.readShrunk()).toBe(true);
	});
});

describe("disabled (screen reader, tablet or split, short landscape)", () => {
	it("never shrinks and rests at the card", () => {
		const c = createComposerCompaction();
		c.setEnabled(false);
		drag(c, { to: 1200, velocity: 5000 });
		expect(c.readShrunk()).toBe(false);
	});

	it("grows a shrunk dock back the moment it is switched off (a screen reader starts)", () => {
		const c = createComposerCompaction();
		drag(c, { to: 1040 });
		c.setEnabled(false);
		expect(c.readShrunk()).toBe(false);
		c.setEnabled(true);
		expect(c.readShrunk()).toBe(false);
	});
});

describe("the signal", () => {
	it("tells a late subscriber the current answer and stops after unsubscribe", () => {
		const c = createComposerCompaction({ initialShrunk: true });
		expect(c.readShrunk()).toBe(true);
		const seen: boolean[] = [];
		const off = c.subscribe((value) => seen.push(value));
		c.grow();
		off();
		drag(c, { to: 1040 });
		expect(seen).toEqual([false]);
	});

	it("dispose clears a pending dwell and every listener", () => {
		const c = createComposerCompaction();
		const seen = flips(c);
		drag(c, { to: 1040 });
		c.noteOffset(2000, 0);
		c.dispose();
		vi.advanceTimersByTime(5000);
		expect(seen).toEqual([true]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("takes an injected clock for the hold", () => {
		let t = 0;
		const c = createComposerCompaction({ now: () => t });
		drag(c, { to: 1040 });
		c.grow();
		t = 10;
		drag(c, { to: 1040 });
		expect(c.readShrunk()).toBe(true);
	});
});

describe("wiring (source pins: the list and the screen have no renderer test)", () => {
	const list = read("src/features/session/components/transcript-list.tsx");
	const screen = read("app/(app)/session/[id].tsx");
	const composer = read("src/features/session/components/composer.tsx");

	it("the list reports the reader's drag, glide and offsets, and grows on a snap", () => {
		for (const call of [
			"compaction?.beginDrag(",
			"compaction?.endDrag(",
			"compaction?.setCoasting(true)",
			"compaction?.setCoasting(false)",
			"compaction?.noteOffset(",
			"compaction?.grow()",
		])
			expect(list).toContain(call);
		/* The viewport rides along: it is what keeps the tail test independent of
		 *  the dock's own height change (R1). */
		expect(list).toMatch(
			/noteOffset\(\s*contentOffset\.y,\s*distance,\s*layoutMeasurement\.height,?\s*\)/,
		);
		/* Points per MILLISECOND from the platform, points per second to the policy. */
		expect(list).toContain("velocity?.y ?? 0) * 1000");
	});

	it("the screen owns one signal and hands it to the list and the composer", () => {
		expect(screen).toContain("createComposerCompaction()");
		expect(screen).toContain("compaction={composerCompaction}");
		expect(screen.match(/compaction=\{composerCompaction\}/g)).toHaveLength(2);
		expect(screen).toContain("composerCompaction.dispose()");
	});

	it("the composer is a pill for the scroll only under every allow rule", () => {
		for (const rule of [
			"compact === null",
			'layout.sizeClass === "compact"',
			"!layout.split",
			"!screenReader",
		])
			expect(composer).toContain(rule);
		/* The Textarea stays ONE mounted node across card and pill: no key, no
		 *  second instance, and it is outside both `presentation.expanded` arms. */
		expect(composer.match(/<Textarea\b/g)).toHaveLength(1);
	});
});
