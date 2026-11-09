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
 *  - Renders of the REAL row body (`TranscriptRowImpl`), counted at a call it
 *    makes exactly once per render (`transcriptRowTestID`), so the count sits
 *    BEHIND the shipped `memo` rather than in front of it. Round 1 counted in a
 *    memoised wrapper, which bailed whether or not the shipped row did:
 *    deleting the row's `memo` left that suite green (review R1-4, QA Q1).
 *  - The streaming row's rendered TEXT, every frame. A count alone cannot see a
 *    row that stopped rendering because it was wrongly reused — zero renders
 *    reads as "fast" — so the frame's new sentence must be on screen.
 *  - `parseMarkdown` / `parseInline` calls, counted at the parser the renderer
 *    calls.
 *  - The wall-clock cost of committing one frame, PRINTED and never gated: on a
 *    shared host the same code measured p50 1.3 ms alone and 3.2 ms under a
 *    load average of ~133 (QA round 1, Q7), so a timing gate turns the suite
 *    red without a product change. The deterministic counts and the text are
 *    the gate; the timings are the reproducible report the PR quotes.
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
 *  `CellRenderer` is. It does NOT bail on a streamed frame: the condense plan
 *  builds a fresh `{ kind: "entry", id, entry }` item per row per frame, so every
 *  mounted cell re-runs `renderItem` (measured by QA round 1: 300 of 300). What
 *  keeps a frame at one row is `reuseRows` keeping the ENTRY's identity and
 *  `memo(TranscriptRow)` bailing on it — the two things this file guards. */
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

/* The real row, counted INSIDE its body: `transcriptRowTestID` is called once
 *  per `TranscriptRowImpl` render and nowhere else in the app, so the count is
 *  of renders the shipped `memo` let through — remove the memo and it is 300. */
vi.mock("@/features/session/projection", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/features/session/projection")>();
	return {
		...actual,
		transcriptRowTestID: (
			entry: Parameters<typeof actual.transcriptRowTestID>[0],
		) => {
			counts.rows += 1;
			return actual.transcriptRowTestID(entry);
		},
	};
});

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

type TextNode = { nodeValue?: unknown; childNodes?: TextNode[] };
/** Every string in the rendered tree, in order. */
const textOf = (node: TextNode | undefined): string =>
	node === undefined
		? ""
		: String(node.nodeValue ?? "") +
			(node.childNodes ?? []).map(textOf).join("");
const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

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
	it("mounts 300 rows, then costs exactly one row and at most one parse per frame, and draws the new text", async () => {
		let entries = timeline();
		await render(entries);
		expect(entries).toHaveLength(300);
		// The mount is not the measurement: every row must render once to exist.
		expect(counts.rows).toBeGreaterThanOrEqual(300);

		const frames: { rows: number; parses: number }[] = [];
		const drawn: boolean[] = [];
		for (let frame = 1; frame <= 10; frame += 1) {
			entries = nextFrame(entries, frame);
			counts.rows = 0;
			counts.parses = 0;
			await render(entries);
			frames.push({ rows: counts.rows, parses: counts.parses });
			/* The streaming row's text as this frame delivered it. Whitespace is
			 *  normalised on both sides because markdown owns line breaking; the
			 *  tail is what a stale row (wrongly reused, or memo'd shut) lacks. */
			const want = squash(entries[LAST]?.text ?? "").slice(-160);
			drawn.push(squash(textOf(dom?.container as TextNode)).includes(want));
		}

		const rows = frames.map((frame) => frame.rows);
		const parses = frames.map((frame) => frame.parses);
		console.log(
			`[transcript-perf] rows/frame ${JSON.stringify(rows)} parses/frame ${JSON.stringify(parses)}`,
		);
		// EXACTLY one: zero would mean the streaming row itself did not render.
		expect(rows).toEqual(Array(10).fill(1));
		expect(Math.max(...parses)).toBeLessThanOrEqual(1);
		expect(drawn).toEqual(Array(10).fill(true));
	});

	it("reports the commit time of a frame on a 4 KB answer (printed, not gated)", async () => {
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
		/* REPORTED, NEVER GATED (QA round 1, Q7). The same code measured p50 1.3 ms
		 *  alone, 1.6 ms in CI and 2.8-3.2 ms beside a full suite on a host at load
		 *  ~133, so any wall-clock threshold turns `pnpm test` red for a reason that
		 *  belongs to the machine. The gate is the deterministic proof above (one row
		 *  render and at most one parse per frame, with the new text drawn); these
		 *  numbers are what the PR quotes, reproducible from this file. The only
		 *  assertion is that a measurement happened. */
		expect(median.p50).toBeGreaterThan(0);
	});
});
