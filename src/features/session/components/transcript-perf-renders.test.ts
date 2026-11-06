import { readFileSync } from "node:fs";
import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "@/contracts";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The scroll-jitter proof: how many rows re-render, how many markdown parses
 * happen, and how long a frame takes to commit — per streamed frame.
 *
 * WHAT IS MEASURED, AND WHY IT IS THE RIGHT THING. The relay re-sends its whole
 * transcript window on every frame (ten a second while a turn streams), so the
 * defect behind "a bit of choppiness in the mobile app scroll" is that every
 * MOUNTED row re-renders on every frame: React Native's cell renderer is a
 * `PureComponent`, and a producer that hands it a new object for an unchanged row
 * defeats the only bail-out it has. So the measurement is per frame:
 *
 *  - `TranscriptRow` renders. The probe wraps the shipped row with the SAME
 *    shallow comparator the row itself uses, so what it counts is cells whose
 *    props CHANGED — exactly the question a memoised row is asked, and exactly
 *    the work React has to do. (Wrapping WITHOUT a comparator would instrument
 *    away the very bail-out under test.)
 *  - `parseMarkdown` / `parseInline` calls, counted at the parser the renderer
 *    calls.
 *  - The wall-clock cost of committing one frame, so the budget in the pull
 *    request is reproducible from this file rather than transcribed by hand.
 *
 * WHAT THIS IS NOT. It is not frame time on a device: it is JS work per frame in
 * a Node renderer, with every row of the 300 mounted (the real list mounts a
 * screenful, so its before-figure is proportionally smaller). The PR states the
 * limit plainly: native scroll smoothness unproven; render counts and commit
 * times are the local evidence.
 */

const counts = vi.hoisted(() => ({ rows: 0, parses: 0, inlineParses: 0 }));
/** How many cells the harness mounts: a virtualiser's window, so the timing case
 *  can measure the list the device actually holds. */
const harness = vi.hoisted(() => ({ windowPt: Number.POSITIVE_INFINITY }));

let CellRenderer: (props: {
	item: TranscriptItemLike;
	index: number;
	render: (input: { item: TranscriptItemLike; index: number }) => unknown;
}) => React.ReactNode = () => null;

vi.mock("react-native", async () => {
	const React = await import("react");
	const passthrough = ({ children }: { children?: React.ReactNode }) =>
		children ?? null;
	return {
		Platform: { OS: "web" },
		View: passthrough,
		Text: passthrough,
		Pressable: passthrough,
		ScrollView: passthrough,
		StyleSheet: {
			create: (value: unknown) => value,
			flatten: (value: unknown) => value,
			absoluteFill: {},
		},
		/* The list is the harness: it renders EVERY row it is given, so "how many
		 * rows re-rendered" is answered by the row probes rather than by a
		 * virtualiser that would mount a screenful and hide the rest. */
		/* React Native's own cell renderer is a `PureComponent`: an item whose
		 *  identity did not change does not call `renderItem` again. The harness has
		 *  to reproduce that or it would measure a fan-out the device never does. */
		FlatList: React.forwardRef((props: Record<string, unknown>, ref) => {
			React.useImperativeHandle(ref, () => ({ scrollToOffset() {} }), []);
			const data = props.data as TranscriptItemLike[];
			const render = props.renderItem as (input: {
				item: TranscriptItemLike;
				index: number;
			}) => React.ReactNode;
			const keyOf = props.keyExtractor as (item: TranscriptItemLike) => string;
			const mounted = Number.isFinite(harness.windowPt)
				? data.slice(Math.max(0, data.length - harness.windowPt))
				: data;
			const Cell = CellRenderer;
			return React.createElement(
				"div",
				null,
				mounted.map((item, index) =>
					React.createElement(Cell, {
						key: keyOf(item),
						item,
						index,
						render,
					}),
				),
			);
		}),
	};
});

type TranscriptItemLike = { id: string; entry?: TranscriptEntry };

/* The harness's cell: memoised on the ITEM, exactly as React Native's
 *  `CellRenderer` is. With `reuseRows` in place an unchanged row keeps its object
 *  identity, so this bails and `renderItem` is never called for it — which is the
 *  device's behaviour and the reason a frame costs one cell rather than a window. */
CellRenderer = React.memo(
	function Cell({
		item,
		index,
		render,
	}: {
		item: TranscriptItemLike;
		index: number;
		render: (input: { item: TranscriptItemLike; index: number }) => unknown;
	}) {
		return render({ item, index }) as React.ReactNode;
	},
	(prev, next) =>
		prev.item === next.item &&
		prev.index === next.index &&
		prev.render === next.render,
) as unknown as typeof CellRenderer;

/* The shipped row, behind the comparator it ships with. */
vi.mock(
	"@/features/session/components/transcript-row",
	async (importOriginal) => {
		const React = await import("react");
		const actual =
			await importOriginal<
				typeof import("@/features/session/components/transcript-row")
			>();
		const Counted = React.memo(function Counted(
			props: Parameters<typeof actual.TranscriptRow>[0],
		) {
			counts.rows += 1;
			return React.createElement(actual.TranscriptRow, props);
		});
		return { TranscriptRow: Counted };
	},
);

/* The real renderer, counted at the parse it performs. */
vi.mock("@/features/session/markdown", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/features/session/markdown")>();
	return {
		...actual,
		parseMarkdown: (text: string) => {
			counts.parses += 1;
			return actual.parseMarkdown(text);
		},
		parseInline: (text: string) => {
			counts.inlineParses += 1;
			return actual.parseInline(text);
		},
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

const seed = JSON.parse(
	readFileSync(
		new URL("../../../../fixtures/relay/http/history-ok.json", import.meta.url),
		"utf8",
	),
).body.entries[0] as TranscriptEntry;

/** ~4 KB: the answer size the commit-time budget below is stated for. */
const ANSWER = `${"The answer's first paragraph explains what changed and why. ".repeat(
	70,
)}`;
const LAST = 299;

/**
 * 300 entries, and the two folds are kept out of the measurement on purpose:
 * assistant and peer only (a `user` row opens a TURN, and a completed turn
 * condenses into one bar), alternating (so the peer group fold does not swallow a
 * run of them). What is left is 300 rows that stay rows.
 */
const timeline = (): TranscriptEntry[] =>
	Array.from({ length: LAST + 1 }, (_, at) => ({
		...seed,
		id: `row-${at}`,
		kind: at === LAST || at % 2 === 0 ? "assistant" : "peer",
		text: at === LAST ? ANSWER : `message ${at} — ${"detail ".repeat(8)}`,
		images: [],
		details: {
			...seed.details,
			...(at % 2 === 1
				? {
						sender: {
							conversation_name: "peer-session",
							session_id: "peer-session-id",
						},
					}
				: {}),
		},
	}));

/** One streamed frame, as the producer really delivers it: every row a NEW
 *  object, the streaming row carrying one more sentence. That is what defeats an
 *  unchanged row's identity, and it is the case this proof has to hold for. */
const nextFrame = (rows: TranscriptEntry[], frame: number): TranscriptEntry[] =>
	rows.map((row) =>
		row.id === `row-${LAST}`
			? { ...row, text: `${row.text} frame ${frame}.` }
			: { ...row },
	);

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let serial = 0;
let session = "";

const render = async (entries: TranscriptEntry[]) => {
	await act(async () =>
		root?.render(
			createElement(TranscriptList, {
				sessionId: session,
				entries,
				streamingRowId: `row-${LAST}`,
				anchorId: `row-${LAST}`,
				testID: "perf-transcript",
			}),
		),
	);
};

beforeEach(() => {
	session = `perf-${++serial}`;
	counts.rows = 0;
	counts.parses = 0;
	counts.inlineParses = 0;
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

describe("streamed frames do not re-render the transcript", () => {
	it("mounts 300 rows, then costs at most one row and one parse per frame", async () => {
		let entries = timeline();
		await render(entries);
		expect(entries).toHaveLength(300);
		// The mount is not the measurement: every row must render once to exist.
		expect(counts.rows).toBeGreaterThanOrEqual(300);

		const frames: { rows: number; parses: number }[] = [];
		for (let frame = 1; frame <= 10; frame += 1) {
			entries = nextFrame(entries, frame);
			counts.rows = 0;
			counts.parses = 0;
			await render(entries);
			frames.push({ rows: counts.rows, parses: counts.parses });
		}

		const rows = frames.map((frame) => frame.rows);
		const parses = frames.map((frame) => frame.parses);
		console.log(
			`[transcript-perf] rows/frame ${JSON.stringify(rows)} parses/frame ${JSON.stringify(parses)}`,
		);
		expect(Math.max(...rows)).toBeLessThanOrEqual(1);
		expect(Math.max(...parses)).toBeLessThanOrEqual(1);
	});

	it("commits a frame inside the frame budget on a 4 KB answer", async () => {
		/* THE PHONE-SIZED WINDOW (`windowing.ts`'s policy), because that is the list
		 *  a device holds and the frame budget is a device's budget. On its own this
		 *  measurement does NOT prove the fix — at 30 mounted cells the commit is
		 *  dominated by the window's own bookkeeping and reads the same before and
		 *  after (verified: p50 ~1.1 ms either way) — so the row-count test above,
		 *  which mounts all 300 and counts every re-render, is the discriminating
		 *  evidence. This one guards the budget the reader actually feels. */
		harness.windowPt = 30;
		let entries = timeline();
		await render(entries);
		/* 20 warm-up frames: the first frames of a run pay for lazy module
		 *  initialisation and V8's own tiering, which is not a streamed frame. */
		for (let frame = 1; frame <= 20; frame += 1) {
			entries = nextFrame(entries, frame);
			await render(entries);
		}
		const measure = async (): Promise<number[]> => {
			const durations: number[] = [];
			for (let frame = 1; frame <= 200; frame += 1) {
				entries = nextFrame(entries, frame);
				const started = performance.now();
				await render(entries);
				durations.push(performance.now() - started);
			}
			return durations;
		};
		const stats = (durations: number[]) => {
			const sorted = [...durations].sort((a, b) => a - b);
			const at = (ratio: number) =>
				sorted[
					Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))
				] ?? 0;
			return {
				p50: at(0.5),
				p95: at(0.95),
				max: sorted[sorted.length - 1] ?? 0,
			};
		};
		/* FIVE RUNS, AND THE MEDIAN ONE IS THE VERDICT. This machine runs ~25
		 *  sessions at once, so any single 200-frame run can catch a GC pause that
		 *  has nothing to do with the transcript: the same code varies by 2x run to
		 *  run. The median run is what distinguishes this change from the one before
		 *  it (p95 27 ms, max 198 ms), and every run is printed rather than only the
		 *  winner. */
		const runs: ReturnType<typeof stats>[] = [];
		for (let run = 0; run < 5; run += 1) runs.push(stats(await measure()));
		for (const [at, run] of runs.entries()) {
			console.log(
				`[transcript-perf] run ${at + 1} commit ms p50 ${run.p50.toFixed(2)} p95 ${run.p95.toFixed(2)} max ${run.max.toFixed(2)}`,
			);
		}
		const median = [...runs].sort((a, b) => a.p95 - b.p95)[2] as ReturnType<
			typeof stats
		>;
		console.log(
			`[transcript-perf] median run commit ms p50 ${median.p50.toFixed(2)} p95 ${median.p95.toFixed(2)} max ${median.max.toFixed(2)}`,
		);
		/* The gates are stated with room for this machine, and the PR says why: the
		 *  same code measured p95 2.2 ms and p95 10.8 ms in consecutive runs on a
		 *  shared Mac, so a 4 ms p95 gate would be a coin flip and a test that lies
		 *  about what it measured. `p50` is the stable statistic; the DETERMINISTIC
		 *  proof of the fix is the row-count test above (300 -> 1). */
		expect(median.p50).toBeLessThanOrEqual(2);
		expect(median.p95).toBeLessThanOrEqual(8);
		/* The maximum is REPORTED, never gated: every frame this test drives allocates
		 *  the producer's 300 fresh entry objects (the relay really does re-send the
		 *  window), so a 200-frame run catches a GC pause sooner or later and the
		 *  pause's size belongs to the machine. Observed with this code: 4.0-6.1 ms on
		 *  a quiet machine, 113 ms once while a full suite ran beside it. */
		console.log(
			`[transcript-perf] frame max (reported, not gated) ${median.max.toFixed(2)} ms`,
		);
	});
});
