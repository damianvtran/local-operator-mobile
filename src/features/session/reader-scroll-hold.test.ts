import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
	createReaderScrollHold,
	DRAG_RELEASE_MS,
	restsAtTail,
	WEB_DOWN_SAFETY_MS,
	WEB_IDLE_MS,
} from "./reader-scroll-hold";

const REST_THEN_END_DRAG =
	/observeRest\(event\);\s+scrollHold\.current\.endDrag\(\);/;
const REST_THEN_END_MOMENTUM =
	/observeRest\(event\);\s+scrollHold\.current\.endMomentum\(\);/;

/*
 * TestFlight 1139 (operator): "when trying to scroll up it anchors me back to
 * the bottom on each frame in a jitter until I apply enough scroll up force to
 * break free". The hold makes the reader's scroll off-limits to every
 * programmatic follow until it comes to rest. Shared by the Team Bridge
 * thread and the agent transcript (PR #289 N1).
 */
const harness = (web = false) => {
	// A fake clock: `advance(ms)` runs the timers that come due.
	let clock = 0;
	const timers: Array<{ run: () => void; at: number }> = [];
	const onRest = vi.fn();
	const onBegin = vi.fn();
	const hold = createReaderScrollHold({
		web,
		onRest,
		onBegin,
		schedule: (run, ms) => {
			const entry = { run, at: clock + ms };
			timers.push(entry);
			return () => {
				const i = timers.indexOf(entry);
				if (i >= 0) timers.splice(i, 1);
			};
		},
	});
	return {
		hold,
		onRest,
		onBegin,
		timers,
		advance(ms: number) {
			clock += ms;
			for (const entry of timers.filter((t) => t.at <= clock)) {
				timers.splice(timers.indexOf(entry), 1);
				entry.run();
			}
		},
	};
};

describe("reader scroll hold, native (TestFlight 1139)", () => {
	it("is active from the drag's first point until it rests", () => {
		const r = harness();
		expect(r.hold.active).toBe(false);
		r.hold.beginDrag();
		expect(r.hold.active).toBe(true);
		expect(r.onBegin).toHaveBeenCalledOnce();
		r.hold.endDrag();
		// The finger lifted, but a momentum glide may still begin.
		expect(r.hold.active).toBe(true);
		r.advance(DRAG_RELEASE_MS);
		expect(r.hold.active).toBe(false);
		expect(r.onRest).toHaveBeenCalledOnce();
	});
	it("keeps holding through momentum, and rests when it ends", () => {
		const r = harness();
		r.hold.beginDrag();
		r.hold.endDrag();
		r.hold.beginMomentum();
		r.advance(DRAG_RELEASE_MS * 10); // the end-drag grace was cancelled
		expect(r.hold.active).toBe(true);
		expect(r.onRest).not.toHaveBeenCalled();
		r.hold.endMomentum();
		expect(r.hold.active).toBe(false);
		expect(r.onRest).toHaveBeenCalledOnce();
	});
	it("a glide caught by a new drag releases when that drag ends (M1 / Q1-1)", () => {
		const r = harness();
		r.hold.beginMomentum(); // a fling still gliding
		r.hold.beginDrag(); // the reader catches it: no momentum end arrives
		r.hold.endDrag(); // lifts with no new glide
		r.advance(DRAG_RELEASE_MS);
		expect(r.hold.active).toBe(false);
		expect(r.onRest).toHaveBeenCalledOnce();
	});
	it("a new drag during the grace keeps holding", () => {
		const r = harness();
		r.hold.beginDrag();
		r.hold.endDrag();
		r.hold.beginDrag();
		r.advance(DRAG_RELEASE_MS * 10);
		expect(r.hold.active).toBe(true);
	});
	it("scroll events do not end a native hold, and native has no web handlers", () => {
		const r = harness();
		r.hold.beginDrag();
		r.hold.scrolled();
		r.advance(WEB_DOWN_SAFETY_MS * 2);
		expect(r.hold.active).toBe(true);
		expect(r.hold.webHandlers).toEqual({});
	});
	it("dispose clears the hold and drops a pending release without resting (m2)", () => {
		const r = harness();
		r.hold.beginDrag();
		r.hold.endDrag();
		r.hold.dispose();
		expect(r.hold.active).toBe(false);
		expect(r.timers).toHaveLength(0);
		expect(r.onRest).not.toHaveBeenCalled();
		// A disposed hold that saw momentum does not carry it into the next.
		r.hold.beginMomentum();
		r.hold.dispose();
		r.hold.beginDrag();
		r.hold.endDrag();
		r.advance(DRAG_RELEASE_MS);
		expect(r.onRest).toHaveBeenCalledOnce();
	});
});

describe("reader scroll hold, web", () => {
	it("a wheel holds until the list has been idle, each scroll renewing it", () => {
		const r = harness(true);
		r.hold.webHandlers.onWheel?.();
		r.advance(WEB_IDLE_MS - 10);
		r.hold.scrolled();
		r.advance(WEB_IDLE_MS - 10);
		expect(r.hold.active).toBe(true);
		r.advance(10);
		expect(r.hold.active).toBe(false);
		expect(r.onRest).toHaveBeenCalledOnce();
	});
	it("a finger held still mid-drag does not time out (M2)", () => {
		const r = harness(true);
		r.hold.webHandlers.onPointerDown?.(); // touch down (pointerType touch)
		r.hold.webHandlers.onPointerMove?.();
		r.advance(300); // the finger pauses
		expect(r.hold.active).toBe(true);
		r.hold.scrolled();
		r.advance(WEB_DOWN_SAFETY_MS - 1);
		expect(r.hold.active).toBe(true);
		r.hold.webHandlers.onPointerUp?.();
		r.advance(WEB_IDLE_MS);
		expect(r.hold.active).toBe(false);
		expect(r.onRest).toHaveBeenCalledOnce();
	});
	it("a lost pointerup cannot pin the hold forever", () => {
		const r = harness(true);
		r.hold.webHandlers.onPointerDown?.();
		r.advance(WEB_DOWN_SAFETY_MS);
		expect(r.hold.active).toBe(false);
		// The next move without a down is hover, not a scroll.
		r.hold.webHandlers.onPointerMove?.();
		expect(r.hold.active).toBe(false);
	});
	it("touch holds through capture events; its pointercancel is ignored (R2-M1)", () => {
		const r = harness(true);
		const touch = { pointerType: "touch" };
		r.hold.webHandlers.onTouchStartCapture?.();
		r.hold.webHandlers.onPointerDown?.(touch);
		r.hold.webHandlers.onTouchMoveCapture?.();
		r.hold.webHandlers.onPointerCancel?.(touch); // the browser takes the pan
		r.advance(300);
		expect(r.hold.active).toBe(true);
		r.hold.webHandlers.onTouchCancelCapture?.();
		r.advance(WEB_IDLE_MS);
		expect(r.hold.active).toBe(false);
		expect(r.onRest).toHaveBeenCalledOnce();
	});
	it("pointercancel releases like pointerup", () => {
		const r = harness(true);
		r.hold.webHandlers.onPointerDown?.();
		r.hold.webHandlers.onPointerCancel?.();
		r.advance(WEB_IDLE_MS);
		expect(r.hold.active).toBe(false);
	});
	it("scroll keys hold; keys on a control in the list do not", () => {
		const r = harness(true);
		const list = { contains: () => true };
		const button = { closest: () => ({}) };
		r.hold.webHandlers.onKeyDown?.({
			key: " ",
			target: button,
			currentTarget: list,
		});
		expect(r.hold.active).toBe(false);
		r.hold.webHandlers.onKeyDown?.({ key: "PageUp" });
		expect(r.hold.active).toBe(true);
		r.advance(WEB_IDLE_MS);
		expect(r.hold.active).toBe(false);
	});
	it("a web begin-drag with no end events still releases on idle", () => {
		const r = harness(true);
		r.hold.beginDrag();
		r.advance(WEB_IDLE_MS);
		expect(r.hold.active).toBe(false);
	});
});

describe("restsAtTail: the at-rest decision uses current geometry (Q1-2)", () => {
	it("30 pt up with 240 pt streamed in under a still finger is history", () => {
		// The last scroll event read 30 pt from the end (inside the 48 pt
		// band); 240 pt then arrived with no scroll event.
		expect(
			restsAtTail({
				offsetY: 1000 - 400 - 30,
				viewportPt: 400,
				contentPt: 1000 + 240,
				bandPt: 48,
			}),
		).toBe(false);
	});
	it("resting short of the end, even inside the band, is history (TestFlight 1157)", () => {
		// #289 pinned this reader to the end at rest: a write after the scroll
		// had already stopped, "a different position than the smooth finish".
		expect(
			restsAtTail({
				offsetY: 1000 - 400 - 30,
				viewportPt: 400,
				contentPt: 1000,
				bandPt: 48,
			}),
		).toBe(false);
	});
	it("resting at the end (within a point) is the tail", () => {
		expect(
			restsAtTail({
				offsetY: 1000 - 400 - 0.5,
				viewportPt: 400,
				contentPt: 1000,
				bandPt: 48,
			}),
		).toBe(true);
	});
});

describe("transcript wiring (m3)", () => {
	const source = readFileSync(
		new URL("./components/transcript-list.tsx", import.meta.url),
		"utf8",
	);
	it("never pins the tail while the reader's scroll holds the list", () => {
		expect(source).toContain(
			"if (!atTail.current || scrollHold.current.active) return;",
		);
	});
	it("routes native drag/momentum and web intent through the hold", () => {
		for (const call of [
			"scrollHold.current.beginDrag();",
			"scrollHold.current.endDrag();",
			"scrollHold.current.beginMomentum();",
			"scrollHold.current.endMomentum();",
			"scrollHold.current.scrolled();",
			"scrollHold.current.dispose()",
			"{...scrollHold.current.webHandlers}",
			'web: Platform.OS === "web"',
		])
			expect(source).toContain(call);
	});
	it("decides the tail at rest from current geometry and never writes (TestFlight 1157)", () => {
		const rest = source.slice(source.indexOf("restRef.current = () => {"));
		const body = rest.slice(0, rest.indexOf("\n\t};"));
		expect(body).toContain("restsAtTail({");
		expect(body).toContain("contentPt: facts.contentPt");
		expect(body).toContain("viewportPt: viewportRef.current");
		expect(body).toContain("atTail.current = atEnd;");
		// A rest is where the reader stopped: no scroll call at rest.
		expect(body).not.toContain("pinTail()");
		expect(body).not.toContain("scrollToOffset");
	});
	it("takes the rest offset from the drag/momentum end event", () => {
		expect(source).toMatch(REST_THEN_END_DRAG);
		expect(source).toMatch(REST_THEN_END_MOMENTUM);
	});
});
