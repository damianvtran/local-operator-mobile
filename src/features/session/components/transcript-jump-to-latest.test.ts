import { readFileSync } from "node:fs";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "@/contracts";
import { TAIL_CLAMP_OFFSET_PT } from "@/features/session/windowing";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { TranscriptList } from "./transcript-list";

/**
 * The operator's rule (2026-11-21) at the LIST, not only in the pure decision:
 *
 *  - new output never yanks a reader who scrolled up;
 *  - that reader gets a "Jump to latest" chip exactly when new output arrived
 *    below them since they left;
 *  - pressing it — and SENDING a message — returns to the end and re-follows;
 *  - an older history page inserted above them is not new output, so no chip.
 *
 * The chip itself is mocked to a component that records its lifecycle: what
 * this file judges is the list's decision and the list's scroll calls, which is
 * where the defect would live. The chip's own visual contract (44 pt, its
 * accessible name, the narrow fallback, the short-viewport hide) is
 * `jump-to-latest-chip.test.tsx`'s.
 *
 * THE HARNESS RENDERS ITS ROWS. A FlatList that renders nothing gives the list
 * no `onLayout` and no mounted node, which is exactly the two things three of
 * these cases are about: a streamed row's height landing late (QA Q2), a reader
 * far enough up that nothing lays out at all (QA Q1), and the web anchor that
 * holds the row the reader was looking at across an older page (UX U1). Rows
 * therefore register a fake view (ref + `onLayout`), and the mocked list hands
 * back a fake web scroller for `getNativeScrollRef`.
 */
const host = vi.hoisted(() => ({
	props: null as unknown,
	scroll: vi.fn(),
	/** The height every mocked row reports; a test raises it to model a streamed
	 *  answer growing before it is asked for anything else. */
	rowHeight: 44,
	/** The web scroller react-native-web would hand back, or null (no web). */
	scroller: null as null | {
		style: Record<string, string>;
		scrollTop: number;
		getBoundingClientRect: () => {
			top: number;
			left: number;
			bottom: number;
			right: number;
			width: number;
			height: number;
		};
	},
	/** Rows mounted with their content top, so the anchor arithmetic is real. */
	rows: [] as { id: string; contentTop: number }[],
	/** Every MOVE of the fake scroller's `scrollTop`: the list's own writes and
	 *  the reader's wheel alike, since a browser has already moved the scroller by
	 *  the time `onScroll` fires. Only a change is recorded — a write that leaves
	 *  the position where it was cannot pull a reader. */
	writes: [] as number[],
}));
/* This host exercises list/anchor policy, not platform accessibility or paint.
 * Answer the preference at the same appearance boundary as the footer test. */
/* `TranscriptList` wraps the host in the keyboard-controller's gesture area on
 *  Android 11+; the real module is native source Node cannot load. */
vi.mock("react-native-keyboard-controller", async () => {
	const { keyboardControllerModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return keyboardControllerModuleMock();
});
vi.mock("@/ui/appearance", () => ({ useReducedMotion: () => true }));
vi.mock("react-native", async () => {
	const React = await import("react");
	const passthrough = ({ children }: { children?: React.ReactNode }) =>
		children ?? null;
	/* A row's position in the content comes from its index in the data, the way
	 *  the real rows stack. The mocked list provides it; the mount counter this
	 *  used to read put every row of one commit at content top 0, so no row ever
	 *  overlapped the viewport and `captureWebAnchor` could never hold an anchor
	 *  (code review round 2, M1 — the test for it passed without the fix). */
	const RowIndex = React.createContext<number | null>(null);
	return {
		Platform: { OS: "web" },
		View: React.forwardRef(
			(
				props: {
					children?: React.ReactNode;
					onLayout?: (event: {
						nativeEvent: { layout: { height: number } };
					}) => void;
				},
				ref,
			) => {
				/* One fake node per mounted view. The list's web anchor reads
				 *  `isConnected` and the node's on-screen top, so the node answers both
				 *  from the content offset and the scroller's current `scrollTop` — the
				 *  same arithmetic the browser does. Rows stand 44 pt apart. */
				const index = React.useContext(RowIndex);
				const top = (index ?? 0) * 44;
				const node = React.useMemo(
					() => ({
						isConnected: true,
						getBoundingClientRect: () => {
							const scrollTop = host.scroller?.scrollTop ?? 0;
							return {
								top: top - scrollTop,
								left: 0,
								bottom: top - scrollTop + host.rowHeight,
								right: 320,
								width: 320,
								height: host.rowHeight,
							};
						},
					}),
					[top],
				);
				React.useImperativeHandle(ref, () => node as never, [node]);
				React.useEffect(() => {
					if (index !== null && index < 64)
						host.rows[index] = { id: `view-${index}`, contentTop: top };
					props.onLayout?.({
						nativeEvent: { layout: { height: host.rowHeight } },
					});
				});
				return props.children ?? null;
			},
		),
		Text: passthrough,
		FlatList: React.forwardRef(
			(
				props: {
					data?: { id: string }[];
					renderItem?: (info: {
						item: { id: string };
						index: number;
					}) => React.ReactNode;
					ListFooterComponent?: React.ReactNode;
				},
				ref,
			) => {
				React.useImperativeHandle(
					ref,
					() => ({
						scrollToOffset: host.scroll,
						getNativeScrollRef: () => host.scroller,
					}),
					[],
				);
				host.props = props;
				const rows = (props.data ?? []).map((item, index) =>
					createElement(
						React.Fragment,
						{ key: item.id },
						createElement(
							RowIndex.Provider,
							{ value: index },
							props.renderItem?.({ item, index }) ?? null,
						),
					),
				);
				return createElement(
					React.Fragment,
					null,
					...rows,
					props.ListFooterComponent ?? null,
				);
			},
		),
	};
});
const chip = vi.hoisted(() => ({
	mounted: 0,
	press: null as null | (() => void),
}));
vi.mock("./jump-to-latest-chip", () => ({
	JumpToLatestChip: ({ onPress }: { onPress: () => void }) => {
		useEffect(() => {
			chip.mounted += 1;
			return () => {
				chip.mounted -= 1;
			};
		}, []);
		chip.press = onPress;
		return null;
	},
}));
vi.mock("@/features/session/components/transcript-edge-fades", () => ({
	TranscriptEdgeFades: () => null,
}));
vi.mock("@/features/session/components/transcript-row", () => ({
	TranscriptRow: () => null,
}));
/* The null rows cannot open a chart; leave the provider in the tree without
 * importing native SVG into this anchor/tail-policy harness. */
vi.mock("@/features/session/components/inline-ui-preview", async () => ({
	ChartDataResizeContext: (await import("react")).createContext(null),
}));
vi.mock("@/features/session/components/turn-bar", () => ({
	TurnBar: () => null,
}));
vi.mock("@/features/session/components/quiet-group-bar", () => ({
	QuietGroupBar: () => null,
}));
vi.mock("@/features/session/components/fold-bar", () => ({
	FoldBar: () => null,
}));
vi.mock("@/features/session/components/supplement-block", () => ({
	SupplementBlock: () => null,
}));
vi.mock("@/ui/components/button", () => ({
	Button: () => null,
}));
vi.mock("@/features/session/components/older-history-edge", () => ({
	OlderHistoryEdge: () => null,
}));

interface ListProps {
	onContentSizeChange: (width: number, height: number) => void;
	onLayout: (event: { nativeEvent: { layout: { height: number } } }) => void;
	onScroll: (event: {
		nativeEvent: {
			contentOffset: { y: number };
			contentSize: { height: number };
			layoutMeasurement: { height: number };
		};
	}) => void;
}
const props = () => host.props as ListProps;
let root: ReturnType<typeof createRoot> | null = null;
let dom: DomShim | null = null;
let serial = 0;
let session = "";
const seed = JSON.parse(
	readFileSync(
		new URL("../../../../fixtures/relay/http/history-ok.json", import.meta.url),
		"utf8",
	),
).body.entries[0] as TranscriptEntry;
const rows = (count: number, prefix = "jump-row"): TranscriptEntry[] =>
	Array.from({ length: count }, (_, i) => ({
		...seed,
		id: `${prefix}-${i}`,
		kind: "user",
		text: `message ${i}`,
	}));
/** The same conversation with its LAST row carrying more text: a streamed
 *  answer, or a message that arrived, as the projection sees it. */
const grown = (count: number): TranscriptEntry[] => {
	const all = rows(count);
	const last = all[all.length - 1] as TranscriptEntry;
	return [
		...all.slice(0, -1),
		{ ...last, text: `${last.text} and the answer keeps coming` },
	];
};
const VIEWPORT = 100;
const CONTENT = 1000;
interface RenderOptions {
	/** The composer's accepted-send mark; a CHANGE is a send. */
	sendMark?: number;
	loadOlder?: () => Promise<void>;
	hasOlder?: boolean;
}
async function render(entries: TranscriptEntry[], options: RenderOptions = {}) {
	await act(async () =>
		root?.render(
			createElement(TranscriptList, {
				sessionId: session,
				entries,
				streamingRowId: null,
				loadOlder: options.loadOlder,
				hasOlder: options.hasOlder ?? false,
				sendMark: options.sendMark ?? 0,
				testID: "test-transcript",
			}),
		),
	);
}
const scrollTo = (offsetY: number, content = CONTENT) => {
	/* A browser moves the scroller before it fires `onScroll`; the fake must agree
	 * with the offset it reports, or the web anchor is captured against a position
	 * the reader is not at. */
	if (host.scroller) host.scroller.scrollTop = offsetY;
	props().onScroll({
		nativeEvent: {
			contentOffset: { y: offsetY },
			contentSize: { height: content },
			layoutMeasurement: { height: VIEWPORT },
		},
	});
};
/** Mount the list settled at the tail, the state a fresh open lands in. */
async function openAtTail(
	entries: TranscriptEntry[],
	options: RenderOptions = {},
) {
	await render(entries, options);
	/* The switch effect clears the height table in the mount commit, so the rows
	 * must measure once more before the conversation is "settled": every height
	 * the bottom mark is later compared against comes from here. */
	await render(entries, options);
	await act(async () => {
		props().onLayout({ nativeEvent: { layout: { height: VIEWPORT } } });
		/* The first content change spends the tail placement; the rows have laid
		 * out by the second, so the conversation's bottom mark holds a HEIGHT —
		 * the state every later change is compared against. */
		props().onContentSizeChange(320, CONTENT);
		props().onContentSizeChange(320, CONTENT);
		// The list's first frame is the tail; the reader has not moved yet.
		scrollTo(CONTENT - VIEWPORT);
	});
	host.scroll.mockClear();
}
/** The reader scrolls up, well outside the 48 pt follow band. */
const scrollAway = (content = CONTENT) => act(async () => scrollTo(0, content));
beforeEach(() => {
	session = `jump-test-${++serial}`;
	chip.mounted = 0;
	chip.press = null;
	host.scroll.mockClear();
	host.rowHeight = 44;
	host.scroller = null;
	host.rows = [];
	host.writes = [];
	vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
		setTimeout(() => callback(), 0),
	);
	vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
		clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
	);
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
	vi.unstubAllGlobals();
});

describe("the jump-to-latest chip", () => {
	it("stays down until output arrives below a reader who left the end, and never pulls them", async () => {
		await openAtTail(rows(20));
		await scrollAway();
		expect(chip.mounted).toBe(0);

		/* A new message lands below the reader. The list must announce it and MUST
		 * NOT scroll: this is the "never yank" half of the rule. */
		await render(rows(21));
		await act(async () => props().onContentSizeChange(320, CONTENT + 44));
		expect(chip.mounted).toBe(1);
		expect(host.scroll).not.toHaveBeenCalled();
	});

	it("returns to the end when pressed, and retires itself", async () => {
		await openAtTail(rows(20));
		await scrollAway();
		await render(rows(21));
		await act(async () => props().onContentSizeChange(320, CONTENT + 44));
		expect(chip.mounted).toBe(1);

		await act(async () => chip.press?.());
		expect(host.scroll).toHaveBeenCalledWith({
			offset: TAIL_CLAMP_OFFSET_PT,
			animated: false,
		});
		expect(chip.mounted).toBe(0);
	});

	it("retires as soon as the reader is back at the end by their own scroll", async () => {
		await openAtTail(rows(20));
		await scrollAway();
		await render(rows(21));
		await act(async () => props().onContentSizeChange(320, CONTENT + 44));
		expect(chip.mounted).toBe(1);

		await act(async () => scrollTo(CONTENT + 44 - VIEWPORT, CONTENT + 44));
		expect(chip.mounted).toBe(0);
	});

	it("does not raise a chip for an older page inserted above the reader", async () => {
		await openAtTail(rows(20));
		await scrollAway();
		/* Ten OLDER messages land at the top: the last row is unchanged, which is
		 * the fact the decision reads (`jump-cue.ts`). */
		await render([...rows(10, "older"), ...rows(20)]);
		await act(async () => props().onContentSizeChange(320, CONTENT + 10 * 44));
		expect(chip.mounted).toBe(0);
		expect(host.scroll).not.toHaveBeenCalled();
	});

	/* QA round 1, Q2. The answer streams while the reader follows, so the bottom
	 * row's new height lands in the list's measurements; the reader then leaves,
	 * and an older page arrives. The chip was raised by that insert alone
	 * (measured 2/2 runs) because the bottom mark still held the height from
	 * BEFORE the growth: the content-size event that carried the growth had run
	 * before the row's own layout did. */
	it("does not raise a chip for an older page after the answer grew at the tail", async () => {
		await openAtTail(rows(20));
		// The streamed answer grows; only the row measurement carries it.
		host.rowHeight = 74;
		await render(rows(20));
		await scrollAway();

		await render([...rows(10, "older-page"), ...rows(20)]);
		await act(async () => props().onContentSizeChange(320, CONTENT + 10 * 44));
		expect(chip.mounted).toBe(0);
	});

	/* QA round 1, Q1. Measured: the answer went `pass 2` → `pass 77` while the
	 * reader was 1648 pt up and the content height never moved — the streaming
	 * row was unmounted, so no layout, no content-size event, no chip. The wire
	 * still changed, and that is what announces now. */
	it("raises the chip for a far reader when the streamed answer grows with no layout", async () => {
		await openAtTail(rows(20));
		await scrollAway();

		await render(grown(20));
		expect(chip.mounted).toBe(1);
		expect(host.scroll).not.toHaveBeenCalled();
	});

	/* UX round 1, U1. The reader wheels to the top edge of a SHORT conversation,
	 * which loads an older page and — on web — holds the row they are looking at
	 * (`holdWebAnchor`). Sending then snapped the list to the end, and the held
	 * anchor's next restore put `scrollTop` back on that row: measured on the web
	 * target, 103 → `-28` (clamped to 0) 18 ms later, the sent message below the
	 * fold and no chip. A deliberate move to the end ends the anchor's claim.
	 *
	 * WHAT MAKES THIS FAIL WITHOUT THE FIX (code review round 2, M1: it used to
	 * pass either way). The scroller's `scrollTop` is an accessor, so every MOVE is
	 * recorded and clamped like the DOM's, and the reader's own wheel moves it, so
	 * a row really is under the viewport when `captureWebAnchor` looks and an
	 * anchor is HELD. Without the release, that anchor restores the reader's old
	 * place in the same flush as the snap (measured here: back to 0, tail 900), and
	 * the `overflow-anchor` the hold took from the browser is never handed back. */
	it("sending from away drops the web anchor, so the snap is not undone", async () => {
		let position = 0;
		host.scroller = {
			style: {},
			get scrollTop() {
				return position;
			},
			set scrollTop(next: number) {
				const clamped = Math.max(0, Math.min(next, CONTENT - VIEWPORT));
				if (clamped === position) return;
				position = clamped;
				host.writes.push(clamped);
			},
			getBoundingClientRect: () => ({
				top: 0,
				left: 0,
				bottom: VIEWPORT,
				right: 320,
				width: 320,
				height: VIEWPORT,
			}),
		};
		host.scroll.mockImplementation(({ offset }: { offset: number }) => {
			if (host.scroller) host.scroller.scrollTop = offset;
		});
		const loadOlder = vi.fn(async () => {});
		const options = { loadOlder, hasOlder: true };
		await openAtTail(rows(20), options);
		/* The reader's own wheel into the top band: `requestOlder` holds the anchor
		 *  on the row they are looking at, exactly as the web path does. */
		await scrollAway();
		expect(loadOlder).toHaveBeenCalledTimes(1);

		await render(rows(20), { ...options, sendMark: 1 });
		expect(host.scroll).toHaveBeenCalledWith({
			offset: TAIL_CLAMP_OFFSET_PT,
			animated: false,
		});
		/* The snap LANDS and stays landed: a held anchor restores its row in the
		 *  same flush, which left the reader at 0 while the tail is 900. */
		expect(host.scroller?.scrollTop).toBe(CONTENT - VIEWPORT);
		const afterSnap = host.writes.length;
		/* The echo lands and every row re-measures — the commit the stale anchor also
		 *  wrote on. */
		await render(rows(20), { ...options, sendMark: 1 });
		await act(async () => props().onContentSizeChange(320, CONTENT + 40));
		expect(host.writes.slice(afterSnap)).toEqual([]);
		/* The anchor is gone: the browser's own anchoring is back, which only
		 *  `releaseWebAnchor` with a HELD anchor does. */
		expect(host.scroller?.style).toMatchObject({ overflowAnchor: "" });
	});

	it("snaps to the end when the reader sends, without waiting for the echo", async () => {
		await openAtTail(rows(20));
		await scrollAway();
		await render(rows(20), { sendMark: 1 });
		expect(host.scroll).toHaveBeenCalledWith({
			offset: TAIL_CLAMP_OFFSET_PT,
			animated: false,
		});
	});

	/* Code review round 1, R2 / round 2, m1. The mark is a CHANGE, not a state:
	 * Approve/Deny, an ask answer, a retry and a slash TAP all set `sending` — the
	 * flag this list used to read — and none of them is a message leaving. Which
	 * of them touch `sendMark` is pinned against the real hook
	 * (`use-composer-echo.test.ts`, "the send mark"); what the list can prove is
	 * that a render carrying the SAME mark is not another send, even after one. */
	it("does not move a reader who is away on a render that carries no new send", async () => {
		await openAtTail(rows(20));
		await scrollAway();
		await render(rows(20), { sendMark: 1 });
		expect(host.scroll).toHaveBeenCalledWith({
			offset: TAIL_CLAMP_OFFSET_PT,
			animated: false,
		});
		host.scroll.mockClear();
		await scrollAway();
		// The same accepted-send mark, re-rendered: not a new send.
		await render(rows(20), { sendMark: 1 });
		expect(host.scroll).not.toHaveBeenCalled();
	});

	it("opens with the chip from the capture hook's `away` state", async () => {
		vi.stubGlobal("location", { search: "?lo-scroll=away" });
		await render(rows(20));
		expect(chip.mounted).toBe(1);
	});
});
