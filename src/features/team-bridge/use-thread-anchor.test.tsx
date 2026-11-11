import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { message, SELF } from "@/team-bridge/__tests__/fixtures";
import type { Message } from "@/team-bridge/contract";
import * as model from "@/team-bridge/model";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { DURATIONS } from "@/ui/tokens.gen";
import {
	ANCHOR_GAP,
	ANCHOR_HIGHLIGHT_MS,
	anchorPlacement,
	JUMP_PILL_CLEARANCE,
	parseThreadAnchor,
} from "./thread-anchor";
import { createThreadViewport, type ThreadViewport } from "./thread-viewport";
import {
	ANCHOR_VIEW_POSITION,
	ANCHOR_WALK_BUDGET_MS,
	ANCHOR_WALK_MAX_PAGES,
	type AnchorList,
	useThreadAnchor,
} from "./use-thread-anchor";

/**
 * A message-anchored open driven from the outside: a real reconciler, a real
 * viewport controller, and a fake list that records where it was told to
 * scroll. What it pins: the reader lands ON the message (older pages fetched
 * when needed), it is highlighted then not, the newest edge is not claimed,
 * and an anchor that is not there hands back to #208's open-at-newest.
 */
const at = (seq: number) =>
	message(seq, SELF, new Date(2026, 10, 11, 9, seq).toISOString());
const page = (from: number, to: number): Message[] =>
	Array.from({ length: to - from + 1 }, (_, i) => at(from + i));
type Thread = Parameters<typeof useThreadAnchor>[0]["thread"];
const thread = (
	messages: Message[],
	over: Partial<NonNullable<Thread>> = {},
) => ({
	messages,
	state: "ready" as const,
	hasMore: false,
	loadingOlder: false,
	olderError: null,
	...over,
});

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
let result: ReturnType<typeof useThreadAnchor>;
const list = createRef<AnchorList>() as { current: AnchorList | null };
const viewport = createRef<ThreadViewport>() as {
	current: ThreadViewport | null;
};
const scrollToIndex = vi.fn();
const scrollTo = vi.fn((offset: number) => ({
	y: offset,
	viewport: 600,
	content: 3000,
}));
const loadOlder = vi.fn();
const sync = (run: () => void) => {
	run();
	return () => {};
};

const onGone = vi.fn();
/** Mirrors the screen: its `dataReady` folds in the anchor's `pending`. */
const anchorPending = { current: false };
function Probe(props: {
	anchor: ReturnType<typeof parseThreadAnchor>;
	thread: Thread;
	fadeMs?: number;
}) {
	const items = model.threadItems(
		props.thread?.messages ?? [],
		new Date(2026, 10, 11, 12),
	);
	result = useThreadAnchor({
		anchor: props.anchor,
		conversationId: "bcv_channel_general",
		thread: props.thread,
		items,
		list,
		viewport,
		loadOlder,
		onGone,
		fadeMs: props.fadeMs,
		schedule: sync,
	});
	anchorPending.current = result.pending;
	return null;
}
const render = (
	anchor: ReturnType<typeof parseThreadAnchor>,
	t: Thread,
	fadeMs?: number,
) =>
	act(async () =>
		root.render(<Probe anchor={anchor} thread={t} fadeMs={fadeMs} />),
	);

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	list.current = { scrollToIndex, scrollToOffset: vi.fn() };
	viewport.current = createThreadViewport({
		scrollTo,
		positioned: vi.fn(),
		read: vi.fn(),
		newestSeq: () => 0,
		dataReady: () => true,
		web: true,
	});
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	vi.useRealTimers();
});

describe("parseThreadAnchor (deep link / push route params)", () => {
	it("reads a message id and/or seq", () => {
		expect(parseThreadAnchor({ messageId: "bcm_7", seq: "7" })).toEqual({
			messageId: "bcm_7",
			seq: 7,
		});
		expect(parseThreadAnchor({ seq: "12" })).toEqual({
			messageId: null,
			seq: 12,
		});
	});
	it("a malformed or absent anchor is an ordinary open", () => {
		expect(parseThreadAnchor({})).toBeNull();
		expect(parseThreadAnchor({ messageId: "../x", seq: "-1" })).toBeNull();
		expect(parseThreadAnchor({ messageId: "..", seq: "1e3" })).toBeNull();
	});
});

describe("useThreadAnchor", () => {
	it("lands on the anchored message in the first page, highlighted, newest not claimed", async () => {
		const messages = page(1, 30);
		await render({ messageId: "bcm_12", seq: 12 }, thread(messages));
		const items = model.threadItems(messages, new Date(2026, 10, 11, 12));
		const index = items.findIndex((i) => i.key === "bcm_12");
		expect(index).toBeGreaterThan(0);
		expect(scrollToIndex).toHaveBeenCalledWith({
			index,
			viewPosition: ANCHOR_VIEW_POSITION,
			animated: false,
		});
		expect(result.phase).toBe("landed");
		expect(result.highlightId).toBe("bcm_12");
		// Reader control: the viewport left its initial phase without
		// following, so a new message will not pull them off this one.
		expect(viewport.current?.pending).toBe(false);
		expect(viewport.current?.following).toBe(false);
		expect(viewport.current?.readSeq).toBe(0);
		expect(loadOlder).not.toHaveBeenCalled();
		// Held, then faded over `DURATIONS.draw` (D2), then cleared.
		await act(async () => vi.advanceTimersByTime(ANCHOR_HIGHLIGHT_MS));
		expect(result.highlightFading).toBe(true);
		await act(async () => vi.advanceTimersByTime(DURATIONS.draw));
		expect(result.highlightId).toBeNull();
	});

	it("fetches older pages until the anchored message is held, then lands", async () => {
		await render(
			{ messageId: null, seq: 5 },
			thread(page(51, 100), { hasMore: true }),
		);
		expect(result.pending).toBe(true);
		expect(loadOlder).toHaveBeenCalledTimes(1);
		expect(scrollToIndex).not.toHaveBeenCalled();
		await render(
			{ messageId: null, seq: 5 },
			thread(page(51, 100), { hasMore: true, loadingOlder: true }),
		);
		expect(loadOlder).toHaveBeenCalledTimes(1);
		await render(
			{ messageId: null, seq: 5 },
			thread(page(1, 100), { hasMore: false }),
		);
		expect(result.phase).toBe("landed");
		expect(result.highlightId).toBe("bcm_5");
		expect(scrollToIndex).toHaveBeenCalledTimes(1);
	});

	it("an anchor not in the thread hands back to open-at-newest", async () => {
		const dataChanged = vi.spyOn(
			viewport.current as ThreadViewport,
			"dataChanged",
		);
		// Oldest held (seq 10) is already older than the anchor: it was deleted.
		await render(
			{ messageId: "bcm_gone", seq: 40 },
			thread(page(10, 39).concat(page(41, 60)), { hasMore: true }),
		);
		expect(result.phase).toBe("none");
		expect(result.pending).toBe(false);
		expect(loadOlder).not.toHaveBeenCalled();
		expect(scrollToIndex).not.toHaveBeenCalled();
		expect(dataChanged).toHaveBeenCalled();
	});

	it("no anchor is #208's ordinary open: nothing held, nothing scrolled", async () => {
		await render(null, thread(page(1, 30)));
		expect(result.phase).toBe("none");
		expect(result.pending).toBe(false);
		expect(scrollToIndex).not.toHaveBeenCalled();
	});
});

describe("viewport after an anchored open", () => {
	it("Jump to newest resumes following at the measured tail", () => {
		const followChanged = vi.fn();
		const v = createThreadViewport({
			scrollTo,
			positioned: vi.fn(),
			read: vi.fn(),
			newestSeq: () => 30,
			dataReady: () => false,
			web: true,
			followChanged,
		});
		v.handlers.onLayout({ nativeEvent: { layout: { height: 600 } } });
		v.handlers.onContentSizeChange(0, 3000);
		v.anchored();
		expect(v.following).toBe(false);
		expect(followChanged).toHaveBeenLastCalledWith(false);
		v.jumpToNewest();
		expect(scrollTo).toHaveBeenLastCalledWith(2400);
		expect(v.following).toBe(true);
		expect(followChanged).toHaveBeenLastCalledWith(true);
	});
});

/**
 * Round-1 Q1-1 / U1-1 (MAJOR): an anchor that is not found after the
 * older-page walk. The fake host is a web scroll node: `scrollTo` moves it and
 * reads it back, and `measure` reads it in place, exactly as
 * `readWebHost` does in the screen. The viewport's `dataReady` follows the
 * anchor's `pending`, as the screen's does. What it pins: the reader ends at
 * the newest edge, the read is posted only after a scroll put them there, and
 * following is on so later re-measures keep them there.
 */
describe("a missing anchor after the walk lands at newest (Q1-1 / U1-1)", () => {
	const VIEW = 600;
	let host: { y: number; content: number };
	let read: ReturnType<typeof vi.fn<() => void>>;
	let scrolls: number[];
	let order: string[];
	const make = (opts: { web: boolean }) => {
		read = vi.fn<() => void>(() => {
			order.push(`read@${host.y}`);
		});
		scrolls = [];
		const v = createThreadViewport({
			scrollTo: (offset) => {
				host.y = Math.min(offset, Math.max(0, host.content - VIEW));
				scrolls.push(host.y);
				order.push(`scroll@${host.y}`);
				return opts.web
					? { y: host.y, viewport: VIEW, content: host.content }
					: null;
			},
			measure: opts.web
				? () => ({ y: host.y, viewport: VIEW, content: host.content })
				: undefined,
			positioned: vi.fn(),
			read,
			newestSeq: () => 80,
			dataReady: () => !anchorPending.current,
			web: opts.web,
		});
		viewport.current = v;
		return v;
	};
	beforeEach(() => {
		host = { y: 0, content: 300 };
		order = [];
		anchorPending.current = true;
	});

	it("web: the walk ends at the start of history, the reader lands at the tail, and is told once", async () => {
		const v = make({ web: true });
		v.handlers.onLayout({ nativeEvent: { layout: { height: VIEW } } });
		// The skeleton's height, measured before the anchor resolved: the stale
		// measurement the pre-fix hand-off read as "content fits".
		v.handlers.onContentSizeChange(0, 300);
		await render(
			{ messageId: "bcm_nope", seq: null },
			thread(page(31, 80), { hasMore: true }),
		);
		expect(loadOlder).toHaveBeenCalledTimes(1);
		expect(result.pending).toBe(true);
		// The older page arrives, the DOM now holds all 80 rows, and no layout
		// event has reported them yet.
		host.content = 3892;
		await render(
			{ messageId: "bcm_nope", seq: null },
			thread(page(1, 80), { hasMore: false }),
		);
		expect(result.phase).toBe("none");
		expect(scrolls.at(-1)).toBe(3892 - VIEW);
		expect(order).toEqual([`scroll@${3892 - VIEW}`, `read@${3892 - VIEW}`]);
		expect(v.readSeq).toBe(80);
		expect(v.following).toBe(true);
		expect(onGone).toHaveBeenCalledTimes(1);
		// Virtualized rows re-measure after the first landing: still followed.
		host.content = 4100;
		v.handlers.onContentSizeChange(0, 4100);
		expect(scrolls.at(-1)).toBe(4100 - VIEW);
	});

	it("native: a stale measurement does not finish the landing; the rows' own layout event does", async () => {
		const v = make({ web: false });
		v.handlers.onLayout({ nativeEvent: { layout: { height: VIEW } } });
		v.handlers.onContentSizeChange(0, 300);
		await render(
			{ messageId: "bcm_nope", seq: null },
			thread(page(31, 80), { hasMore: true }),
		);
		await render(
			{ messageId: "bcm_nope", seq: null },
			thread(page(1, 80), { hasMore: false }),
		);
		expect(result.phase).toBe("none");
		// Nothing proved the newest row on screen yet: no read, still initial.
		expect(read).not.toHaveBeenCalled();
		expect(v.pending).toBe(true);
		host.content = 3892;
		v.handlers.onContentSizeChange(0, 3892);
		expect(scrolls.at(-1)).toBe(3892 - VIEW);
		v.handlers.onScroll({
			nativeEvent: {
				contentOffset: { y: 3892 - VIEW },
				layoutMeasurement: { height: VIEW },
				contentSize: { height: 3892 },
			},
		});
		expect(order).toEqual([`scroll@${3892 - VIEW}`, `read@${3892 - VIEW}`]);
		expect(v.following).toBe(true);
	});

	it("a failed older page falls back to newest WITHOUT the toast (absence not proven)", async () => {
		const v = make({ web: true });
		v.handlers.onLayout({ nativeEvent: { layout: { height: VIEW } } });
		v.handlers.onContentSizeChange(0, 300);
		await render(
			{ messageId: "bcm_nope", seq: null },
			thread(page(31, 80), { hasMore: true }),
		);
		host.content = 2500;
		await render(
			{ messageId: "bcm_nope", seq: null },
			thread(page(31, 80), { hasMore: true, olderError: new Error("500") }),
		);
		expect(result.phase).toBe("none");
		expect(scrolls.at(-1)).toBe(2500 - VIEW);
		expect(v.readSeq).toBe(80);
		expect(onGone).not.toHaveBeenCalled();
	});

	it("seq=999 (beyond the newest) is unchanged: no walk, open at newest, no toast", async () => {
		const v = make({ web: true });
		v.handlers.onLayout({ nativeEvent: { layout: { height: VIEW } } });
		host.content = 2500;
		v.handlers.onContentSizeChange(0, 300);
		await render(
			{ messageId: "bcm_nope", seq: 999 },
			thread(page(31, 80), { hasMore: true }),
		);
		expect(loadOlder).not.toHaveBeenCalled();
		expect(result.phase).toBe("none");
		expect(scrolls.at(-1)).toBe(2500 - VIEW);
		expect(onGone).not.toHaveBeenCalled();
	});

	it("a seq walk that passes the message's place is proven gone: toast", async () => {
		make({ web: true });
		await render(
			{ messageId: null, seq: 40 },
			thread(page(10, 39).concat(page(41, 60)), { hasMore: true }),
		);
		expect(result.phase).toBe("none");
		expect(onGone).toHaveBeenCalledTimes(1);
	});
});

describe("the walk is bounded (U1-2)", () => {
	it(`stops after ${ANCHOR_WALK_MAX_PAGES} older pages and falls back silently`, async () => {
		let held = page(951, 1000);
		await render(
			{ messageId: "bcm_nope", seq: null },
			thread(held, { hasMore: true }),
		);
		for (let n = 1; n < ANCHOR_WALK_MAX_PAGES; n += 1) {
			held = page(951 - n * 50, 1000);
			await render(
				{ messageId: "bcm_nope", seq: null },
				thread(held, { hasMore: true }),
			);
		}
		expect(loadOlder).toHaveBeenCalledTimes(ANCHOR_WALK_MAX_PAGES);
		expect(result.pending).toBe(true);
		held = page(951 - ANCHOR_WALK_MAX_PAGES * 50, 1000);
		await render(
			{ messageId: "bcm_nope", seq: null },
			thread(held, { hasMore: true }),
		);
		expect(loadOlder).toHaveBeenCalledTimes(ANCHOR_WALK_MAX_PAGES);
		expect(result.phase).toBe("none");
		expect(onGone).not.toHaveBeenCalled();
	});

	it(`stops ${ANCHOR_WALK_BUDGET_MS} ms after the first older page and falls back silently`, async () => {
		await render(
			{ messageId: "bcm_nope", seq: null },
			thread(page(51, 100), { hasMore: true }),
		);
		await render(
			{ messageId: "bcm_nope", seq: null },
			thread(page(51, 100), { hasMore: true, loadingOlder: true }),
		);
		await act(async () => vi.advanceTimersByTime(ANCHOR_WALK_BUDGET_MS - 1));
		expect(result.pending).toBe(true);
		await act(async () => vi.advanceTimersByTime(1));
		expect(result.phase).toBe("none");
		expect(onGone).not.toHaveBeenCalled();
	});
});

describe("the landed highlight holds, then fades (D2)", () => {
	it("holds for ANCHOR_HIGHLIGHT_MS, fades over fadeMs, then clears", async () => {
		await render({ messageId: "bcm_12", seq: 12 }, thread(page(1, 30)), 120);
		expect(result.highlightId).toBe("bcm_12");
		expect(result.highlightFading).toBe(false);
		await act(async () => vi.advanceTimersByTime(ANCHOR_HIGHLIGHT_MS));
		expect(result.highlightId).toBe("bcm_12");
		expect(result.highlightFading).toBe(true);
		expect(result.fadeMs).toBe(120);
		await act(async () => vi.advanceTimersByTime(120));
		expect(result.highlightId).toBeNull();
	});
});

describe("Jump to newest is retired once the reader reaches newest (R1-3 / D4)", () => {
	it("shows after landing, hides at the tail, and stays hidden on a later scroll-up", async () => {
		await render({ messageId: "bcm_12", seq: 12 }, thread(page(1, 30)));
		await act(async () => result.followChanged(false));
		expect(result.showJump).toBe(true);
		await act(async () => result.followChanged(true));
		expect(result.showJump).toBe(false);
		await act(async () => result.followChanged(false));
		expect(result.showJump).toBe(false);
	});
});

describe("anchor placement clears the Jump pill (D3 / U1-4 / Q1-3)", () => {
	it("an ordinary row keeps the upper-third placement", () => {
		expect(anchorPlacement(60, 700)).toEqual({
			viewPosition: ANCHOR_VIEW_POSITION,
			viewOffset: 0,
		});
		expect(anchorPlacement(null, 700).viewPosition).toBe(ANCHOR_VIEW_POSITION);
	});
	it("a row that would reach under the pill is raised until it clears it", () => {
		// 0.3 * (700 - 620) + 620 = 644 > 700 - 56 - 8 = 636: under the pill.
		const view = 700;
		const row = 620;
		const { viewPosition, viewOffset } = anchorPlacement(row, view);
		expect(viewPosition).toBeLessThan(ANCHOR_VIEW_POSITION);
		const bottom = viewPosition * (view - row) + viewOffset + row;
		expect(bottom).toBeCloseTo(view - JUMP_PILL_CLEARANCE - ANCHOR_GAP);
	});
	it("a row taller than the band is top-aligned 8 px under the header", () => {
		expect(anchorPlacement(640, 700)).toEqual({
			viewPosition: 0,
			viewOffset: ANCHOR_GAP,
		});
	});
	it("the landed row's measured height re-places a tall row once", async () => {
		const v = createThreadViewport({
			scrollTo,
			positioned: vi.fn(),
			read: vi.fn(),
			newestSeq: () => 30,
			dataReady: () => true,
			web: true,
		});
		v.handlers.onLayout({ nativeEvent: { layout: { height: 700 } } });
		viewport.current = v;
		await render({ messageId: "bcm_12", seq: 12 }, thread(page(1, 30)));
		expect(scrollToIndex).toHaveBeenCalledTimes(1);
		const index = scrollToIndex.mock.calls[0]?.[0].index;
		await act(async () => result.measureRow("bcm_12", 640));
		expect(scrollToIndex).toHaveBeenCalledTimes(2);
		expect(scrollToIndex).toHaveBeenLastCalledWith({
			index,
			viewPosition: 0,
			viewOffset: ANCHOR_GAP,
			animated: false,
		});
		// Later re-measures are the reader's business.
		await act(async () => result.measureRow("bcm_12", 700));
		expect(scrollToIndex).toHaveBeenCalledTimes(2);
	});
});
