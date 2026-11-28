import { readFileSync } from "node:fs";
import React, {
	act,
	createElement,
	Profiler,
	useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "@/contracts";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * THE STREAMING RENDER BENCHMARK (Tier 0: Node + react-dom + react-native-web
 * stubs; no simulator, no Hermes).
 *
 * WHY IT EXISTS. The operator reported that streamed text on the native app
 * "just appears in chunks" instead of fading, and that streaming feels slow.
 * The audit found two causes — nothing paces words inside a visible paragraph,
 * and a fresh `arrival` object each frame lands in `renderItem`'s dependencies
 * so every mounted virtualised cell re-runs per frame — and this file is how a
 * change to either is MEASURED rather than asserted.
 *
 * WHAT IT REPLAYS, through the shipped code and nothing hand-built in between:
 *   relay JSON text -> `decodeFrame` (JSON.parse + zod) -> the real
 *   `createProjectionStore().applyFrame` -> a host that derives what
 *   `useSessionRuntime` derives (entries, streamingRowId, arrival tail, epoch)
 *   -> the real `TranscriptList` -> real `TranscriptRow` / `Markdown`.
 * The synthetic stream is ~3.4k tokens of mixed prose, list, fenced code and
 * table at 100 ms frames (the daemon's cadence), with one 400 ms stall followed
 * by a burst. Every frame carries the WHOLE window (60 rows), as the daemon does.
 *
 * WHAT IT DOES NOT MEASURE: native frame rate, Hermes timing, or UIKit/Android
 * text layout. `FlatList` is the harness list below, which keeps React Native's
 * `PureComponent` cell contract (a cell re-runs `renderItem` only when its item,
 * index or `renderItem` identity changed) and mounts the newest 60 cells — a
 * phone's window. Counts are exact; milliseconds are Node milliseconds on a
 * shared host and are REPORTED, never gated.
 *
 * HOW TO RUN (prints one `[stream-bench]` JSON line per run):
 *   pnpm exec vitest run src/features/session/components/streaming-bench.test.tsx
 * A/B against another source tree (the baseline): point the `@` alias at an
 * extracted `git archive` of that tree's `src` with a scratch vitest config
 * (see the PR's `## Benchmark`); this file is source-agnostic by design — it
 * only calls exports both trees have.
 *
 * Time is virtual: `vi.useFakeTimers` drives the paced reveal's ticks without
 * waiting, while wall cost is read from `process.hrtime` (which is not faked).
 */

const counts = vi.hoisted(() => ({
	rowBodies: 0,
	cells: 0,
	itemChanged: 0,
	renderChanged: 0,
	perId: new Map<string, number>(),
	markdownMs: 0,
	reuseMs: 0,
	parses: 0,
}));
const harness = vi.hoisted(() => ({ windowPt: 60 }));

type TranscriptItemLike = { id: string; entry?: TranscriptEntry };
let CellRenderer: (props: {
	item: TranscriptItemLike;
	index: number;
	render: (input: { item: TranscriptItemLike; index: number }) => unknown;
}) => React.ReactNode = () => null;

vi.mock("react-native-gesture-handler", async () => {
	const { gestureHandlerModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return gestureHandlerModuleMock();
});
vi.mock("react-native-keyboard-controller", async () => {
	const { keyboardControllerModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return keyboardControllerModuleMock();
});
vi.mock("react-native", async () => {
	const React = await import("react");
	const passthrough = ({ children }: { children?: React.ReactNode }) =>
		children ?? null;
	return {
		/* NATIVE, not web: the operator's defect is native, and the web path has a
		 * word-level WAAPI fade the native one lacks. */
		Platform: { OS: "ios", select: (map: Record<string, unknown>) => map.ios },
		AppState: {
			currentState: "active",
			addEventListener: () => ({ remove() {} }),
		},
		AccessibilityInfo: {
			isReduceMotionEnabled: async () => false,
			addEventListener: () => ({ remove() {} }),
		},
		useWindowDimensions: () => ({
			width: 390,
			height: 844,
			scale: 3,
			fontScale: 1,
		}),
		Dimensions: {
			get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
		},
		I18nManager: { isRTL: false, getConstants: () => ({ isRTL: false }) },
		Linking: { openURL: async () => undefined },
		View: passthrough,
		Text: passthrough,
		Pressable: passthrough,
		ScrollView: passthrough,
		StyleSheet: {
			create: (value: unknown) => value,
			flatten: (value: unknown) => value,
			absoluteFill: {},
		},
		Animated: {
			Value: class {
				setValue() {}
			},
			View: passthrough,
			timing: () => ({ start() {}, stop() {} }),
		},
		Easing: { bezier: () => "curve" },
		FlatList: React.forwardRef((props: Record<string, unknown>, ref) => {
			React.useImperativeHandle(ref, () => ({ scrollToOffset() {} }), []);
			const data = props.data as TranscriptItemLike[];
			const render = props.renderItem as (input: {
				item: TranscriptItemLike;
				index: number;
			}) => React.ReactNode;
			const keyOf = props.keyExtractor as (item: TranscriptItemLike) => string;
			const mounted = data.slice(Math.max(0, data.length - harness.windowPt));
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

/* React Native's `CellRenderer` is a `PureComponent` over (item, index,
 * renderItem, ...): reproduced here, with a `Profiler` per cell so the per-row
 * commit count is React's own, and a plain counter of `renderItem` calls. */
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
		counts.cells += 1;
		return React.createElement(
			Profiler,
			{
				id: item.id,
				onRender: () => {
					counts.perId.set(item.id, (counts.perId.get(item.id) ?? 0) + 1);
				},
			},
			render({ item, index }) as React.ReactNode,
		);
	},
	(prev, next) => {
		/* WHY a cell re-ran, by cause: an item whose identity changed, or a
		 * `renderItem` whose identity changed (its dependency list moved). */
		if (prev.item !== next.item) counts.itemChanged += 1;
		if (prev.render !== next.render) counts.renderChanged += 1;
		return (
			prev.item === next.item &&
			prev.index === next.index &&
			prev.render === next.render
		);
	},
) as unknown as typeof CellRenderer;

vi.mock("@/features/session/projection", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/features/session/projection")>();
	return {
		...actual,
		transcriptRowTestID: (
			entry: Parameters<typeof actual.transcriptRowTestID>[0],
		) => {
			counts.rowBodies += 1;
			return actual.transcriptRowTestID(entry);
		},
	};
});
vi.mock("@/features/session/row-identity", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/features/session/row-identity")>();
	return {
		...actual,
		reuseRows: ((...args: Parameters<typeof actual.reuseRows>) => {
			const started = process.hrtime.bigint();
			const out = actual.reuseRows(...args);
			counts.reuseMs += Number(process.hrtime.bigint() - started) / 1e6;
			return out;
		}) as typeof actual.reuseRows,
	};
});
vi.mock("@/features/session/markdown", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/features/session/markdown")>();
	return {
		...actual,
		parseMarkdown: (
			text: string,
			checkpoint?: Parameters<typeof actual.parseMarkdown>[1],
			blockStart?: Parameters<typeof actual.parseMarkdown>[2],
		) => {
			const started = process.hrtime.bigint();
			const out = actual.parseMarkdown(text, checkpoint, blockStart);
			counts.markdownMs += Number(process.hrtime.bigint() - started) / 1e6;
			counts.parses += 1;
			return out;
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
	useTokenColor: () => "#1a1a1a",
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
const { decodeFrame } = await import("@/relay/sse");
const { createProjectionStore } = await import("@/state/projection-store");

const template = JSON.parse(
	readFileSync(
		new URL(
			"../../../../fixtures/relay/synthetic/sse-projection-every-entry-kind.json",
			import.meta.url,
		),
		"utf8",
	),
) as { event: string; data: Record<string, unknown> };
const seed = (
	template.data.transcript as TranscriptEntry[]
)[0] as TranscriptEntry;

/* ------------------------------------------------------------ the stream --- */

/** A deterministic PRNG: the stream must be identical on every run and in the
 *  baseline tree, or the A/B compares different workloads. */
const lcg = (seed0: number) => {
	let state = seed0 >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
};

const WORDS =
	"the relay stream decoder keeps every row in order while the projection store replaces the entry for each frame and the transcript list reuses rows whose content did not change so only the streaming answer re-renders".split(
		" ",
	);

/** Mixed markdown, ~14 KB: prose, a bullet list, a fenced code block, a table. */
const buildAnswer = (): string => {
	const rand = lcg(7);
	const sentence = () => {
		const length = 9 + Math.floor(rand() * 9);
		const words = Array.from(
			{ length },
			() => WORDS[Math.floor(rand() * WORDS.length)] as string,
		);
		words[3] = "**bold**";
		words[6] = "`code`";
		return `${words.join(" ")}.`;
	};
	const paragraph = () =>
		Array.from({ length: 4 + Math.floor(rand() * 3) }, sentence).join(" ");
	const list = () =>
		Array.from(
			{ length: 6 },
			(_, at) => `- item ${at + 1}: ${sentence()}`,
		).join("\n");
	const code = () =>
		[
			"```python",
			...Array.from(
				{ length: 14 },
				(_, at) =>
					`    value_${at} = compute(${at}, "${sentence().slice(0, 24)}")`,
			),
			"```",
		].join("\n");
	const table = () =>
		[
			"| name | status | note |",
			"| --- | --- | --- |",
			...Array.from(
				{ length: 8 },
				(_, at) => `| row ${at} | ok | ${sentence().slice(0, 40)} |`,
			),
		].join("\n");
	const blocks: string[] = [];
	for (let section = 0; section < 5; section += 1) {
		blocks.push(`## Part ${section + 1}`, paragraph(), paragraph(), list());
		if (section % 2 === 0) blocks.push(code());
		if (section % 2 === 1) blocks.push(table());
		blocks.push(paragraph());
	}
	return blocks.join("\n\n");
};

/** Token boundaries: 2–6 characters, mid-word like a real tokenizer. */
const tokenise = (text: string): number[] => {
	const rand = lcg(11);
	const ends: number[] = [];
	let at = 0;
	while (at < text.length) {
		at = Math.min(text.length, at + 2 + Math.floor(rand() * 5));
		ends.push(at);
	}
	return ends;
};

const FRAMES = 200;
const STALL_AT = 80;
const STALL_FRAMES = 4;

/** Characters the daemon has produced by the end of each 100 ms tick; the stall
 *  produces nothing for 400 ms (no frame is sent), then one burst frame. */
const schedule = (answer: string): { chars: number; send: boolean }[] => {
	const ends = tokenise(answer);
	const perFrame = Math.ceil(ends.length / (FRAMES - STALL_FRAMES));
	const rand = lcg(3);
	const out: { chars: number; send: boolean }[] = [];
	let token = 0;
	for (let frame = 0; frame < FRAMES; frame += 1) {
		const stalled = frame >= STALL_AT && frame < STALL_AT + STALL_FRAMES;
		if (!stalled) {
			const burst = frame === STALL_AT + STALL_FRAMES ? STALL_FRAMES + 1 : 1;
			token = Math.min(
				ends.length,
				token + Math.round(perFrame * burst * (0.6 + rand() * 0.8)),
			);
		}
		out.push({ chars: ends[Math.max(0, token - 1)] ?? 0, send: !stalled });
	}
	const last = out[out.length - 1];
	if (last) last.chars = answer.length;
	return out;
};

const HISTORY = 59;
const history = (): TranscriptEntry[] =>
	Array.from({ length: HISTORY }, (_, at) => ({
		...seed,
		id: `row-${at}`,
		kind: at % 2 === 0 ? "assistant" : "peer",
		text: `message ${at} — ${"detail ".repeat(8)}`,
		images: [],
		final: true,
		text_complete: true,
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

const frameJson = (
	rows: TranscriptEntry[],
	text: string,
	version: number,
	settled: boolean,
): string =>
	JSON.stringify({
		...template.data,
		session_id: "bench-session",
		version,
		streaming: !settled,
		transcript: [
			...rows,
			{
				...seed,
				id: "row-stream",
				kind: "assistant",
				text,
				images: [],
				details: {},
				final: settled,
				text_complete: settled,
			},
		],
	});

/* ------------------------------------------------------------ the host ---- */

/** What `useSessionRuntime` derives for the transcript, from the same store. */
function Host({ store }: { store: ReturnType<typeof createProjectionStore> }) {
	const read = () => store.getState().entries["bench-session"];
	const entry = useSyncExternalStore(store.subscribe, read, read);
	const projection = entry?.projection;
	const entries = (projection?.transcript ?? []) as TranscriptEntry[];
	const tail = entries[entries.length - 1];
	return createElement(TranscriptList, {
		sessionId: "bench-session",
		entries,
		streamingRowId: projection?.streaming === true && tail ? tail.id : null,
		streamArrivalEpoch: entry?.streamEpoch ?? null,
		streamArrivalTail: tail ?? null,
		anchorId: null,
		testID: "bench-transcript",
	});
}

type TextNode = { nodeValue?: unknown; childNodes?: TextNode[] };
const textOf = (node: TextNode | undefined): string =>
	node === undefined
		? ""
		: String(node.nodeValue ?? "") +
			(node.childNodes ?? []).map(textOf).join("");

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
	counts.rowBodies = 0;
	counts.cells = 0;
	counts.perId.clear();
	counts.markdownMs = 0;
	counts.reuseMs = 0;
	counts.parses = 0;
	dom = installDomShim();
	vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) =>
		setTimeout(() => cb(performance.now()), 16),
	);
	vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
	root = createRoot(dom.container as Element);
});

afterEach(async () => {
	vi.useRealTimers();
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
	vi.unstubAllGlobals();
});

const ms = (since: bigint) => Number(process.hrtime.bigint() - since) / 1e6;
const quantile = (values: number[], q: number) => {
	const sorted = [...values].sort((a, b) => a - b);
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
	);
};

describe("streaming render benchmark", () => {
	it("replays a bursty 200-frame stream through store -> TranscriptList", async () => {
		vi.useFakeTimers({
			toFake: [
				"setTimeout",
				"clearTimeout",
				"setInterval",
				"clearInterval",
				"Date",
				"performance",
			],
		});
		const answer = buildAnswer();
		const plan = schedule(answer);
		const rows = history();
		const store = createProjectionStore();
		store.getState().beginStream("bench-session");
		await act(async () => root?.render(createElement(Host, { store })));

		// Seed frame (empty answer): mounting 60 cells is not the measurement.
		const apply = async (json: string) => {
			const decoded = decodeFrame({
				event: template.event,
				data: json,
				receivedAt: 0,
			});
			if (decoded.kind !== "projection") throw new Error("bad frame");
			await act(async () => {
				store.getState().applyFrame("bench-session", decoded.data);
			});
		};
		let version = 1;
		await apply(frameJson(rows, "", version++, false));

		const per = {
			decode: [] as number[],
			apply: [] as number[],
			tick: [] as number[],
			total: [] as number[],
			markdown: [] as number[],
			reuse: [] as number[],
			cells: [] as number[],
			rows: [] as number[],
			itemChanged: [] as number[],
			renderChanged: [] as number[],
			profiled: [] as number[],
			bytes: [] as number[],
		};
		let leaf = 0;
		for (let frame = 0; frame < FRAMES; frame += 1) {
			const step = plan[frame];
			if (!step) break;
			counts.cells = 0;
			counts.itemChanged = 0;
			counts.renderChanged = 0;
			counts.rowBodies = 0;
			counts.markdownMs = 0;
			counts.reuseMs = 0;
			counts.perId.clear();
			let frameDecode = 0;
			let frameApply = 0;
			if (step.send) {
				const json = frameJson(
					rows,
					answer.slice(0, step.chars),
					version++,
					false,
				);
				per.bytes.push(json.length);
				const started = process.hrtime.bigint();
				const decoded = decodeFrame({
					event: template.event,
					data: json,
					receivedAt: 0,
				});
				frameDecode = ms(started);
				if (decoded.kind !== "projection") throw new Error("bad frame");
				const applying = process.hrtime.bigint();
				await act(async () => {
					store.getState().applyFrame("bench-session", decoded.data);
				});
				frameApply = ms(applying);
			}
			// The rest of the 100 ms: any paced-reveal ticks fire in virtual time.
			const ticking = process.hrtime.bigint();
			await act(async () => {
				await vi.advanceTimersByTimeAsync(100);
			});
			const frameTick = ms(ticking);
			per.decode.push(frameDecode);
			per.apply.push(frameApply);
			per.tick.push(frameTick);
			per.total.push(frameDecode + frameApply + frameTick);
			per.markdown.push(counts.markdownMs);
			per.reuse.push(counts.reuseMs);
			per.cells.push(counts.cells);
			per.itemChanged.push(counts.itemChanged);
			per.renderChanged.push(counts.renderChanged);
			per.rows.push(counts.rowBodies);
			per.profiled.push(
				[...counts.perId.keys()].filter((id) => id !== "row-stream").length,
			);
			if (frame > 0) leaf += counts.perId.get("row-stream") ?? 0;
		}

		// Settle: the final frame carries the whole answer, final=true.
		await apply(frameJson(rows, answer, version++, true));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		const drawn = textOf(dom?.container as TextNode);
		/* Invariant the benchmark itself relies on: nothing was dropped on the way
		 * to the screen. The WHOLE answer is compared (a tail check would pass a
		 * reveal that lost a middle chunk), by its letters only: markdown syntax
		 * (list markers, table pipes, rules) and whitespace are drawn differently
		 * from how they are written, the words are not. */
		const letters = (value: string) => value.replace(/[^\p{L}]+/gu, "");
		// The container also holds the 59 older rows, which come first; the
		// streaming answer is the tail of what is drawn.
		expect(letters(drawn).endsWith(letters(answer))).toBe(true);

		// Frame 0 is the mount (every row renders once to exist, and the first
		// frame pays lazy module init): excluded from every figure below, so the
		// numbers are steady-state streaming.
		for (const [key, list] of Object.entries(per)) {
			if (key !== "bytes") list.shift();
		}
		const virtualSeconds = ((FRAMES - 1) * 100) / 1000;
		const skipped = (list: number[]) => list.filter((n) => n > 0);
		console.log(
			`[stream-bench] ${JSON.stringify({
				frames: per.total.length,
				sentFrames: per.bytes.length,
				frameKB: Math.round(quantile(per.bytes, 0.5) / 1024),
				cellsPerFrame: {
					median: quantile(per.cells, 0.5),
					p95: quantile(per.cells, 0.95),
					total: per.cells.reduce((a, b) => a + b, 0),
				},
				cellCauses: {
					itemIdentityChangedMedian: quantile(per.itemChanged, 0.5),
					renderItemChangedMedian: quantile(per.renderChanged, 0.5),
				},
				rowBodiesPerFrame: {
					median: quantile(per.rows, 0.5),
					total: per.rows.reduce((a, b) => a + b, 0),
				},
				nonStreamingRowCommitsPerFrame: {
					median: quantile(per.profiled, 0.5),
					p95: quantile(per.profiled, 0.95),
					total: per.profiled.reduce((a, b) => a + b, 0),
				},
				streamingLeafCommitsPerSecond: Number(
					(leaf / virtualSeconds).toFixed(1),
				),
				decodeMs: {
					median: Number(quantile(skipped(per.decode), 0.5).toFixed(3)),
					p95: Number(quantile(skipped(per.decode), 0.95).toFixed(3)),
				},
				applyCommitMs: {
					median: Number(quantile(skipped(per.apply), 0.5).toFixed(3)),
					p95: Number(quantile(skipped(per.apply), 0.95).toFixed(3)),
				},
				tickMs: {
					median: Number(quantile(per.tick, 0.5).toFixed(3)),
					p95: Number(quantile(per.tick, 0.95).toFixed(3)),
				},
				frameTotalMs: {
					median: Number(quantile(per.total, 0.5).toFixed(3)),
					p95: Number(quantile(per.total, 0.95).toFixed(3)),
					sum: Number(per.total.reduce((a, b) => a + b, 0).toFixed(1)),
				},
				markdownParseMs: {
					median: Number(quantile(per.markdown, 0.5).toFixed(3)),
					p95: Number(quantile(per.markdown, 0.95).toFixed(3)),
				},
				reuseRowsMs: {
					median: Number(quantile(per.reuse, 0.5).toFixed(3)),
					p95: Number(quantile(per.reuse, 0.95).toFixed(3)),
				},
			})}`,
		);
		expect(per.total.length).toBe(FRAMES - 1);
		/* The gates: counts, never milliseconds. Skipped for a baseline run
		 * (`STREAM_BENCH_REPORT_ONLY=1`), which exists to print what the old tree
		 * does, not to pass. */
		if (!process.env.STREAM_BENCH_REPORT_ONLY) {
			// After the mount, a frame re-runs ONLY the streaming row's cell, and no
			// other row commits at all (React's own Profiler count).
			expect(Math.max(...per.cells)).toBeLessThanOrEqual(1);
			expect(per.profiled.reduce((a, b) => a + b, 0)).toBe(0);
			// The streaming leaf paces at <= 30 Hz, never per frame of the list.
			expect(leaf / virtualSeconds).toBeLessThanOrEqual(30);
		}
	}, 120_000);
});
