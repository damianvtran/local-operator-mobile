import { readFileSync } from "node:fs";
import type React from "react";
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "@/contracts";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * A row fold's open state, owned by the LIST (review round 1: Q5 / U6 / m4,
 * U2, U4). Three reader-facing promises, each driven through the real
 * `TranscriptList` → `TranscriptRow` → `CollapsedRow` path with a stub host:
 *
 *  - a fold the reader opened is still open after windowing unmounts and
 *    remounts its row;
 *  - a find landing on a folded row opens it, and it stays open after the
 *    highlight moves on;
 *  - opening a fold at the tail keeps the reader's offset — they stay pinned
 *    only if the end is still inside the tail band.
 *
 * The harness `FlatList` mounts a slice of its data the test controls (the
 * windowing), records every `scrollToOffset` (the tail pin), and hands the
 * test its scroll callbacks to drive.
 */

type PressProps = {
	onPress?: () => void;
	accessibilityLabel?: string;
	accessibilityRole?: string;
	accessibilityState?: { expanded?: boolean };
	style?: { minHeight?: number; minWidth?: number };
};

const harness = vi.hoisted(() => ({
	/** The mounted slice: `[from, to)` of the list's data. */
	from: 0,
	to: Number.POSITIVE_INFINITY,
	/** When set, the mounted slice starts where react-native-web's first
	 *  render window does for `initialScrollIndex` at offset 0
	 *  (`_initialRenderRegion`: the index clamped into the data), instead of
	 *  at `from` — the window M-r4-1 measured. */
	maskFromInitialIndex: false,
	/** Offsets the list asked to scroll to. */
	scrolls: [] as number[],
	/** Indexes the list was asked to jump to — the find jump, and the
	 *  emulated one-time `initialScrollIndex` jump (`contentSize`). */
	indexJumps: [] as number[],
	/** The latest props the list handed its scroller. */
	props: {} as Record<string, unknown>,
	/** The latest fold pressable per accessible name. */
	folds: new Map<string, PressProps>(),
	/** The latest non-fold pressable per accessible name (the `open` route). */
	buttons: new Map<string, PressProps>(),
}));

vi.mock("react-native", async () => {
	const React = await import("react");
	const passthrough = ({ children }: { children?: React.ReactNode }) =>
		children ?? null;
	return {
		Platform: { OS: "web" },
		View: passthrough,
		Text: passthrough,
		ScrollView: passthrough,
		Pressable: (
			props: PressProps & {
				children?:
					| React.ReactNode
					| ((state: { pressed: boolean }) => React.ReactNode);
			},
		) => {
			if (props.accessibilityState?.expanded !== undefined)
				harness.folds.set(props.accessibilityLabel ?? "", props);
			else harness.buttons.set(props.accessibilityLabel ?? "", props);
			return typeof props.children === "function"
				? props.children({ pressed: false })
				: (props.children ?? null);
		},
		StyleSheet: {
			create: (value: unknown) => value,
			flatten: (value: unknown) => value,
			absoluteFill: {},
		},
		FlatList: React.forwardRef((props: Record<string, unknown>, ref) => {
			harness.props = props;
			React.useImperativeHandle(
				ref,
				() => ({
					scrollToOffset({ offset }: { offset: number }) {
						harness.scrolls.push(offset);
					},
					scrollToIndex({ index }: { index: number }) {
						harness.indexJumps.push(index);
					},
				}),
				[],
			);
			const data = props.data as { id: string }[];
			const render = props.renderItem as (input: {
				item: unknown;
				index: number;
			}) => React.ReactNode;
			const keyOf = props.keyExtractor as (item: unknown) => string;
			const initial = (props.initialScrollIndex as number | undefined) ?? 0;
			const from = harness.maskFromInitialIndex
				? Math.max(0, Math.min(data.length - 1, initial))
				: harness.from;
			return React.createElement(
				"div",
				null,
				data
					.slice(from, harness.to)
					.map((item, index) =>
						React.createElement(
							React.Fragment,
							{ key: keyOf(item) },
							render({ item, index: index + from }),
						),
					),
			);
		}),
	};
});

vi.mock("@/features/session/components/turn-bar", () => ({
	TurnBar: () => null,
}));
vi.mock("@/features/session/components/quiet-group-bar", () => ({
	QuietGroupBar: () => null,
}));
vi.mock("@/features/session/components/supplement-block", () => ({
	SupplementBlock: () => null,
}));
vi.mock("@/features/session/components/tool-row", () => ({
	ToolRow: () => null,
}));
vi.mock("@/features/session/components/ask-response-row", () => ({
	AskResponseRow: () => null,
}));
vi.mock("@/features/session/components/transcript-image", () => ({
	TranscriptImage: () => null,
}));
vi.mock("@/features/session/components/imagegen-card", () => ({
	ImageGenCard: () => null,
}));
vi.mock("@/features/session/components/transcript-edge-fades", () => ({
	TranscriptEdgeFades: () => null,
}));
vi.mock("@/ui/appearance", () => ({
	useTextScale: () => ({ effectiveScale: 1, scale: 1 }),
	useTokenColor: () => "#000000",
	useReducedMotion: () => false,
	useTheme: () => ({ active: { colors: {} } }),
}));
vi.mock("@/ui/direction", () => ({ useIsRTL: () => false, LTR_TEXT: {} }));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1, scale: 1 }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: async () => true }));
vi.mock("react-native-svg", () => {
	const passthrough = ({ children }: { children?: React.ReactNode }) =>
		children ?? null;
	return {
		__esModule: true,
		default: passthrough,
		Defs: passthrough,
		LinearGradient: passthrough,
		Rect: passthrough,
		Stop: passthrough,
	};
});

const { TranscriptList } = await import(
	"@/features/session/components/transcript-list"
);
const { createScrollPresence } = await import(
	"@/features/session/transcript-presence"
);

const seed = JSON.parse(
	readFileSync(
		new URL("../../../../fixtures/relay/http/history-ok.json", import.meta.url),
		"utf8",
	),
).body.entries[0] as TranscriptEntry;

const HIDDEN = "the second line the fold hides";
const FOLD = "peer reviewer: first line of the peer message";

const row = (id: string, over: Partial<TranscriptEntry>): TranscriptEntry => ({
	...seed,
	id,
	kind: "assistant",
	text: `answer ${id}`,
	images: [],
	details: {},
	...over,
});

const ENTRIES: TranscriptEntry[] = [
	row("a0", {}),
	row("p1", {
		kind: "peer_message",
		text: `first line of the peer message\n${HIDDEN}`,
		details: {
			sender: { conversation_name: "reviewer", session_id: "peer-1" },
		},
	}),
	row("a2", {}),
	row("a3", {}),
];

type TextNode = { nodeValue?: unknown; childNodes?: TextNode[] };
const textOf = (node: TextNode): string =>
	String(node.nodeValue ?? "") + (node.childNodes ?? []).map(textOf).join("");

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let serial = 0;
let session = "";
/** The find session's landing nonce: bumped by a test to model a NEW landing
 *  (`use-find.ts` bumps it on every landing, the same id included). */
let landingNonce = 1;
let entries: TranscriptEntry[] = ENTRIES;

const listElement = (
	highlightId: string | null,
	presence?: ReturnType<typeof createScrollPresence>,
) =>
	createElement(TranscriptList, {
		sessionId: session,
		entries,
		streamingRowId: null,
		anchorId: null,
		highlightId,
		// What the screen passes: a hit is a landing, keyed by id AND nonce.
		reveal:
			highlightId === null ? null : { id: highlightId, nonce: landingNonce },
		presence,
		testID: "fold-transcript",
	});
const render = async (
	highlightId: string | null = null,
	presence?: ReturnType<typeof createScrollPresence>,
) => {
	await act(async () => root?.render(listElement(highlightId, presence)));
};
/** The text of the FIRST COMMITTED FRAME of a render: `flushSync` runs the
 *  render, the commit and the layout effects (and any sync re-render they
 *  cause) but leaves passive effects queued, so this is what the browser would
 *  paint before a `useEffect` could change it. */
const firstFrame = async (highlightId: string | null) => {
	let frame = "";
	await act(async () => {
		flushSync(() => root?.render(listElement(highlightId)));
		frame = drawn();
	});
	return frame;
};
const drawn = () => textOf(dom?.container as TextNode);
const press = async (label: string) => {
	const fold = harness.folds.get(label);
	expect(fold).toBeDefined();
	await act(async () => fold?.onPress?.());
};
const call = async (name: string, ...args: unknown[]) => {
	const handler = harness.props[name] as (...input: unknown[]) => void;
	await act(async () => handler(...args));
};

/** A viewport of 800 over 2000 of content, scrolled to its end: at the tail. */
const parkAtTail = async () => {
	await call("onLayout", { nativeEvent: { layout: { height: 800 } } });
	await call("onContentSizeChange", 0, 2000); // the one-time restore
	await call("onScroll", {
		nativeEvent: {
			contentOffset: { y: 1200 },
			contentSize: { height: 2000 },
			layoutMeasurement: { height: 800 },
		},
	});
	harness.scrolls.length = 0;
};

beforeEach(() => {
	session = `folds-${++serial}`;
	landingNonce = 1;
	entries = ENTRIES;
	harness.indexJumps.length = 0;
	harness.from = 0;
	harness.to = Number.POSITIVE_INFINITY;
	harness.maskFromInitialIndex = false;
	harness.scrolls.length = 0;
	harness.folds.clear();
	harness.buttons.clear();
	dom = installDomShim();
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
	vi.unstubAllGlobals();
});

describe("reasoning and harness metadata", () => {
	it("preserves a future event under its actual wire type instead of entry", async () => {
		entries = [
			row("future", {
				kind: "future_trace",
				text: `Future event summary\n${HIDDEN}`,
			}),
		];
		await render();
		expect(drawn()).toContain("future_trace");
		expect(drawn()).not.toContain(HIDDEN);
		await press("future_trace: Future event summary");
		expect(drawn()).toContain(HIDDEN);
	});
	it("names reasoning, preserves its expanded text, and never calls it entry", async () => {
		entries = [
			row("reasoning", {
				kind: "reasoning",
				text: `Checking the result\n${HIDDEN}`,
			}),
		];
		await render();
		expect(drawn()).toContain("Thinking");
		expect(drawn()).not.toContain("entry");
		expect(drawn()).not.toContain(HIDDEN);
		await press("Thinking: Checking the result");
		expect(drawn()).toContain(HIDDEN);
	});

	it("filters typed metadata before planning but retains literal user and peer quotes", async () => {
		entries = [
			row("state", {
				kind: "notice",
				custom_type: "session_state",
				text: "private harness metadata",
			}),
			row("quote", { kind: "user", text: "[session-state] quoted by me" }),
			row("peer-quote", {
				kind: "peer_message",
				text: "[session-state] quoted by peer",
			}),
		];
		await render();
		expect(drawn()).not.toContain("private harness metadata");
		expect(drawn()).toContain("quoted by me");
		expect(drawn()).toContain("quoted by peer");
	});
});

describe("a fold the reader opened", () => {
	it("survives its row leaving the window and coming back (Q5 / U6)", async () => {
		await render();
		expect(drawn()).not.toContain(HIDDEN);
		await press(FOLD);
		expect(drawn()).toContain(HIDDEN);
		// Windowing unmounts the row…
		harness.from = 2;
		await render();
		expect(drawn()).not.toContain("first line of the peer message");
		// …and remounts it, open, as the reader left it.
		harness.from = 0;
		await render();
		expect(drawn()).toContain(HIDDEN);
		expect(harness.folds.get(FOLD)?.accessibilityState?.expanded).toBe(true);
	});
});

describe("a find landing on a folded row (U2)", () => {
	it("opens it on the landing frame, and keeps it open after", async () => {
		await render();
		expect(drawn()).not.toContain(HIDDEN);
		/* The first painted frame, not the settled one (round 2, U10): moving
		 *  the landing into a passive effect leaves this frame folded. */
		expect(await firstFrame("p1")).toContain(HIDDEN);
		await render(null);
		expect(drawn()).toContain(HIDDEN);
	});

	it("lets the reader close the current hit, and the tail still follows (U10 / Q9 / m-r2-1)", async () => {
		await render("p1");
		await parkAtTail();
		expect(drawn()).toContain(HIDDEN);
		await press(FOLD);
		// Closed while it is still the current find hit.
		expect(drawn()).not.toContain(HIDDEN);
		expect(harness.folds.get(FOLD)?.accessibilityState?.expanded).toBe(false);
		// The close shrinks the content; the reader is still at the end.
		await call("onContentSizeChange", 0, 1990);
		harness.scrolls.length = 0;
		// A streamed growth after it still drags the tail.
		await call("onContentSizeChange", 0, 2400);
		expect(harness.scrolls.length).toBeGreaterThan(0);
	});
});

describe("a press that changes nothing (round 2, m-r2-1)", () => {
	it("arms no resize mark, so the next streamed growth still pins", async () => {
		await render();
		await parkAtTail();
		/* A stale press handler (a double tap landing before the re-render)
		 *  asks for the state the row already has. */
		const stale = harness.folds.get(FOLD);
		await press(FOLD);
		await call("onContentSizeChange", 0, 2030); // the open's own resize
		harness.scrolls.length = 0;
		await act(async () => stale?.onPress?.());
		expect(drawn()).toContain(HIDDEN);
		// No resize follows a no-op, so an armed mark would eat this growth.
		await call("onContentSizeChange", 0, 2400);
		expect(harness.scrolls.length).toBeGreaterThan(0);
	});
});

describe("opening a fold at the tail (m4 / U4)", () => {
	it("pins as usual when content arrives and the reader did nothing (control)", async () => {
		await render();
		await parkAtTail();
		await call("onContentSizeChange", 0, 2400);
		expect(harness.scrolls.length).toBeGreaterThan(0);
	});

	it("keeps the reader's offset when the body runs past the tail band", async () => {
		await render();
		await parkAtTail();
		await press(FOLD);
		await call("onContentSizeChange", 0, 2400);
		expect(harness.scrolls).toEqual([]);
		// They left the tail: the next streamed growth does not drag them either.
		await call("onContentSizeChange", 0, 2450);
		expect(harness.scrolls).toEqual([]);
	});

	it("stays pinned when the opened body still ends inside the tail band", async () => {
		await render();
		await parkAtTail();
		await press(FOLD);
		await call("onContentSizeChange", 0, 2030);
		expect(harness.scrolls.length).toBeGreaterThan(0);
	});
});

describe("the rail and the list's own scrolls (U3 / m2 / Q4)", () => {
	const scrollTo = (y: number) =>
		call("onScroll", {
			nativeEvent: {
				contentOffset: { y },
				contentSize: { height: 4000 },
				layoutMeasurement: { height: 800 },
			},
		});

	it("stays down while the tail pin follows a streaming turn", async () => {
		const presence = createScrollPresence();
		await render(null, presence);
		await parkAtTail();
		for (let growth = 1; growth <= 20; growth += 1) {
			await call("onContentSizeChange", 0, 2000 + growth * 40);
			// The platform reports the pin's own offset back through onScroll.
			await scrollTo(1200 + growth * 40);
		}
		expect(harness.scrolls.length).toBeGreaterThan(0); // it did follow
		expect(presence.readVisible()).toBe(false);
		presence.dispose();
	});

	it("comes up for the reader's fast drag and holds through its momentum", async () => {
		/* An injected clock: the presence summons the rail on SPEED
		 *  (`RAIL_FAST_PT_PER_MS`, TestFlight 578), so two offsets need a real
		 *  interval between them — 300 pt in 16 ms is a flick. */
		let clock = 0;
		const presence = createScrollPresence(() => clock);
		await render(null, presence);
		await call("onScrollBeginDrag");
		await scrollTo(1200);
		clock += 16;
		await scrollTo(900);
		expect(presence.readVisible()).toBe(true);
		await call("onScrollEndDrag");
		await call("onMomentumScrollBegin");
		await scrollTo(600);
		expect(presence.readVisible()).toBe(true);
		await call("onMomentumScrollEnd");
		presence.dispose();
	});
});

describe("a folded subagent row's `open` route (round 2, D10 / U12)", () => {
	it("is its own button, named for the agent, on a touch-floor box", async () => {
		const opened: string[] = [];
		await act(async () =>
			root?.render(
				createElement(TranscriptList, {
					sessionId: session,
					entries: [
						row("s1", {
							kind: "subagent_message",
							text: `subagent summary line\n${HIDDEN}`,
							details: { job_id: "job-7", label: "auditor" },
						}),
					],
					streamingRowId: null,
					anchorId: null,
					highlightId: null,
					onOpenAgent: (job: string) => opened.push(job),
					testID: "fold-transcript",
				}),
			),
		);
		// The row did fold, so this is the folded bar's control.
		expect(harness.folds.size).toBe(1);
		expect(drawn()).not.toContain(HIDDEN);
		const open = harness.buttons.get("Open auditor");
		expect(open?.accessibilityRole).toBe("button");
		expect(open?.style?.minHeight).toBeGreaterThanOrEqual(44);
		expect(open?.style?.minWidth).toBeGreaterThanOrEqual(44);
		await act(async () => open?.onPress?.());
		expect(opened).toEqual(["job-7"]);
		// Its own target: pressing it opened the agent, not the fold.
		expect(drawn()).not.toContain(HIDDEN);
	});
});

describe("re-landing on a hit the reader closed (round 3, U14 / m-r3-1)", () => {
	it("opens it again: the landing is the nonce, not the id", async () => {
		await render("p1");
		expect(drawn()).toContain(HIDDEN);
		await press(FOLD);
		expect(drawn()).not.toContain(HIDDEN);
		// Same frame re-rendered, same landing: the reader's close stands.
		await render("p1");
		expect(drawn()).not.toContain(HIDDEN);
		// One hit: Next wraps onto the same message — a new landing.
		landingNonce += 1;
		await render("p1");
		expect(drawn()).toContain(HIDDEN);
	});
});

describe("a session switch on a reused list (round 3, Q11)", () => {
	it("closes the previous conversation's folds", async () => {
		await render();
		await press(FOLD);
		expect(drawn()).toContain(HIDDEN);
		// `router.navigate` swaps props on the mounted list; ids may collide.
		session = `${session}-next`;
		await render();
		expect(drawn()).not.toContain(HIDDEN);
	});

	it("clears BEFORE recording a landing that arrives with the switch", async () => {
		await render();
		session = `${session}-next`;
		landingNonce += 1;
		/* The first committed frame: the reset is a layout effect declared
		 *  before the landing's, so the landing survives it. Declared after
		 *  (or made passive), the reset wipes the landing it arrived with. */
		expect(await firstFrame("p1")).toContain(HIDDEN);
		await render("p1");
		expect(drawn()).toContain(HIDDEN);
	});
});

describe("the first expand after opening a conversation (round 3, Q-RF1)", () => {
	/* Both VirtualizedLists' one-time initial jump, as the platform runs it
	 *  BEFORE the list's own `onContentSizeChange` prop
	 *  (react-native-web's vendored `_onContentSizeChange`,
	 *  `@react-native/virtualized-lists`' `_maybeScrollToInitialScrollIndex`):
	 *  it jumps on the first content change that sees the index `> 0`, and
	 *  only then latches. */
	let latched = false;
	const contentSize = async (width: number, height: number) => {
		const index = harness.props.initialScrollIndex as number | undefined;
		if (width > 0 && height > 0 && index != null && index > 0 && !latched) {
			harness.indexJumps.push(index);
			latched = true;
		}
		await call("onContentSizeChange", width, height);
	};
	const atOffset = (y: number, content: number) =>
		call("onScroll", {
			nativeEvent: {
				contentOffset: { y },
				contentSize: { height: content },
				layoutMeasurement: { height: 300 },
			},
		});
	/* Sixteen rows: the whole conversation fits the 844 pt pre-layout
	 *  estimate's first screenful (index 0), and the real 300 pt viewport's
	 *  does not (index 4) — the order QA measured on web. */
	const LONG = [
		...Array.from({ length: 12 }, (_, i) => row(`x${i}`, {})),
		...ENTRIES,
	];

	beforeEach(() => {
		latched = false;
		entries = LONG;
	});

	it("does not replay the list's initial jump, so the reader's offset holds", async () => {
		await render();
		expect(harness.props.initialScrollIndex).toBe(0);
		await contentSize(400, 2000); // first layout: index 0, nothing latched
		await call("onLayout", { nativeEvent: { layout: { height: 300 } } });
		await atOffset(1700, 2000); // at the tail
		harness.scrolls.length = 0;
		await press(FOLD);
		await contentSize(400, 2400); // the fold's first height change
		// No jump to an index, and no offset move: the header stays put.
		expect(harness.indexJumps).toEqual([]);
		expect(harness.scrolls).toEqual([]);
		// A streamed row after it cannot replay it either.
		await contentSize(400, 2450);
		expect(harness.indexJumps).toEqual([]);
	});

	it("still opens at the tail when the index is live at first layout (control)", async () => {
		await render();
		await call("onLayout", { nativeEvent: { layout: { height: 300 } } });
		expect(harness.props.initialScrollIndex).toBe(4);
		await contentSize(400, 2000); // the intended open: one jump
		expect(harness.indexJumps).toEqual([4]);
		await atOffset(1700, 2000);
		await press(FOLD);
		await contentSize(400, 2400);
		expect(harness.indexJumps).toEqual([4]);
	});
});

describe("a session switch after the initial index froze (round 4, M-r4-1)", () => {
	it("hands the next conversation its own index, so its first row mounts", async () => {
		harness.maskFromInitialIndex = true;
		// A: 300 rows, opened at its tail; the first layout freezes its index.
		entries = Array.from({ length: 300 }, (_, i) => row(`x${i}`, {}));
		await render();
		await call("onLayout", { nativeEvent: { layout: { height: 300 } } });
		await call("onContentSizeChange", 400, 30000);
		const frozenA = harness.props.initialScrollIndex as number;
		expect(frozenA).toBeGreaterThan(250);
		// B: ten rows on the same mounted list (`router.navigate`).
		session = `${session}-short`;
		entries = Array.from({ length: 10 }, (_, i) => row(`b${i}`, {}));
		await render();
		// B's own live value (it fits one screenful), not A's frozen one.
		expect(harness.props.initialScrollIndex).toBe(0);
		expect(drawn()).toContain("answer b0");
		// B freezes its own value at its first layout and keeps it.
		await call("onContentSizeChange", 400, 1000);
		await render();
		expect(harness.props.initialScrollIndex).toBe(0);
		expect(drawn()).toContain("answer b0");
	});
});
