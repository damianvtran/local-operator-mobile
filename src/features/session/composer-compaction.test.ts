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
		]).toEqual([24, 1000, 16, 150, 300]);
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
			"compaction?.noteOffset(contentOffset.y, distance)",
			"compaction?.grow()",
		])
			expect(list).toContain(call);
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
