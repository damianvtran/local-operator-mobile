import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { message, SELF } from "@/team-bridge/__tests__/fixtures";
import type { Message } from "@/team-bridge/contract";
import * as model from "@/team-bridge/model";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { ANCHOR_HIGHLIGHT_MS, parseThreadAnchor } from "./thread-anchor";
import { createThreadViewport, type ThreadViewport } from "./thread-viewport";
import {
	ANCHOR_VIEW_POSITION,
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

function Probe(props: {
	anchor: ReturnType<typeof parseThreadAnchor>;
	thread: Thread;
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
		schedule: sync,
	});
	return null;
}
const render = (anchor: ReturnType<typeof parseThreadAnchor>, t: Thread) =>
	act(async () => root.render(<Probe anchor={anchor} thread={t} />));

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
		await act(async () => vi.advanceTimersByTime(ANCHOR_HIGHLIGHT_MS));
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
