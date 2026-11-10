import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionListFrame, SessionSummary } from "@/contracts";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The sidebar's render proof: how many conversation rows re-render when a
 * sessions frame arrives (perf audit P11), in the style of
 * `transcript-perf-renders.test.ts`.
 *
 * WHAT IS MEASURED. The relay re-sends the WHOLE sessions list on every list
 * frame, as fresh objects. Before this change the store kept those fresh
 * objects and the pane rendered rows inline, so one frame re-rendered every
 * mounted row. The count here is of renders of the row's BODY — taken at
 * `AgentListRow`, which `SessionRow` renders exactly once per body render — so
 * it sits BEHIND the shipped `memo`, not in front of it:
 *
 *  - delete `memo` from `SessionRow`            -> every case that counts
 *    renders fails (measured: 4 of the 5 below), because the host repaints
 *    on each frame and nothing stops the row;
 *  - delete `reuseSessions` from the list store -> "unchanged frame", "one row
 *    changed" and "a row moved" fail (measured: 3), because every row is a
 *    new object again.
 *
 * The REAL list store and the REAL row are under test; only the leaf the row
 * draws with is replaced by a counter (it needs the native avatar pipeline and
 * `uniwind`, which Node cannot import — the same limit
 * `sidebar-footer.test.ts` records for the pane itself). The pane's own wiring
 * is asserted over its source at the end, for that reason.
 *
 * WHAT THIS IS NOT. Frame time on a device: it is React work per frame in a
 * Node renderer with every row mounted.
 */

const counts = vi.hoisted(() => ({ rows: 0, ids: [] as string[] }));

vi.mock("@/features/agent-avatar/agent-avatar-view", () => ({
	AgentListRow: (props: { title: string; testID: string }) => {
		counts.rows += 1;
		counts.ids.push(props.testID);
		return props.title;
	},
}));
vi.mock("@/features/sessions/tag-line", () => ({
	SessionTagLine: () => null,
}));

const { SessionRow } = await import("@/features/sessions/session-row");
const { createListStore, reuseSessions } = await import("@/state/list-store");

const ROWS = 40;

const summary = (at: number): SessionSummary =>
	({
		session_id: `session-${at}`,
		section: "active",
		pinned: false,
		conversation_name: `conversation ${at}`,
		cwd: `/home/me/projects/app-${at}`,
		model_label: "anthropic/claude-opus-5",
		streaming: false,
		needs_attention: false,
		unseen: false,
		pending_kind: "",
		leaving: "",
		updating: "",
		subagents_running: 0,
		subagents_queued: 0,
		todos_open: 0,
		mtime: 1_700_000_000 + at,
		completion_kind: "",
		tags: [{ id: "t1", name: "work" }],
	}) as unknown as SessionSummary;

/** One frame as the wire delivers it: EVERY row a new object. */
const frame = (
	change: (row: SessionSummary, at: number) => SessionSummary = (row) => row,
): SessionListFrame =>
	({
		sessions: Array.from({ length: ROWS }, (_, at) => change(summary(at), at)),
		degraded: null,
	}) as unknown as SessionListFrame;

const noop = () => undefined;

/** The pane's list, reduced to what decides a row's props: the store's
 *  sessions mapped to `SessionRow` with stable callbacks and primitives.
 *  `tick` re-renders the host WITHOUT a frame — the search box, a sheet, the
 *  inbox count: the pane re-rendering for a reason no row cares about. */
const Host = ({
	sessions,
	tick,
}: {
	sessions: SessionSummary[];
	tick: number;
}) =>
	createElement(
		"div",
		{ "data-tick": tick },
		sessions.map((session) =>
			createElement(SessionRow, {
				key: session.session_id,
				session,
				section: "today",
				selected: false,
				now: 1_700_000_100_000,
				reserveLeading: false,
				tagsAssignable: true,
				onActivate: noop,
				onLongPress: noop,
			}),
		),
	);

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let store = createListStore();
let tick = 0;

const paint = async () => {
	await act(async () =>
		root?.render(
			createElement(Host, { sessions: store.getState().sessions, tick }),
		),
	);
};
const apply = async (next: SessionListFrame) => {
	store.getState().applyFrame(next, 1);
	await paint();
};

beforeEach(async () => {
	dom = installDomShim();
	root = createRoot(dom.container as Element);
	store = createListStore();
	tick = 0;
	await apply(frame());
	counts.rows = 0;
	counts.ids = [];
});

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
});

describe("sidebar rows per sessions frame", () => {
	it("mounts every row once (the harness sees the real row)", async () => {
		store = createListStore();
		await act(async () =>
			root?.render(createElement(Host, { sessions: [], tick })),
		);
		counts.rows = 0;
		await apply(frame());
		expect(counts.rows).toBe(ROWS);
	});

	it("re-renders NO row for a frame that changed nothing", async () => {
		const before = store.getState().sessions;
		for (let at = 0; at < 10; at += 1) await apply(frame());
		expect(counts.rows).toBe(0);
		// The array itself is reused, so the pane's selector does not even wake.
		expect(store.getState().sessions).toBe(before);
	});

	it("re-renders exactly the ONE row a frame changed", async () => {
		await apply(
			frame((row, at) => (at === 7 ? { ...row, streaming: true } : row)),
		);
		expect(counts.rows).toBe(1);
		expect(counts.ids).toEqual(["session-row-session-7"]);
		// And the change is on screen's data: a wrongly reused row would also
		// read as "zero renders".
		expect(store.getState().sessions[7]?.streaming).toBe(true);
	});

	it("re-renders no row when the pane re-renders without a frame", async () => {
		for (let at = 0; at < 5; at += 1) {
			tick += 1;
			await paint();
		}
		expect(counts.rows).toBe(0);
	});

	it("keeps unchanged rows' identity when a row MOVES to the top", async () => {
		const rows = frame().sessions;
		const moved = [rows[9], ...rows.slice(0, 9), ...rows.slice(10)];
		const before = store.getState().sessions;
		await apply({ ...frame(), sessions: moved } as SessionListFrame);
		const after = store.getState().sessions;
		expect(after.map((row) => row.session_id)).toEqual(
			moved.map((row) => row?.session_id),
		);
		// Same objects, new order: React moves the keyed rows, it renders none.
		expect(after[0]).toBe(before[9]);
		expect(counts.rows).toBe(0);
	});
});

describe("reuseSessions", () => {
	it("returns the frame's rows in the frame's order, never a stale field", () => {
		const held = frame().sessions;
		const next = frame((row, at) =>
			at === 3 ? { ...row, conversation_name: "renamed" } : row,
		).sessions;
		const out = reuseSessions(held, next);
		expect(out).toEqual(next);
		expect(out[3]).toBe(next[3]);
		expect(out[2]).toBe(held[2]);
	});

	it("drops rows the frame dropped and adds rows it added", () => {
		const held = frame().sessions;
		const next = [...frame().sessions.slice(1), summary(ROWS + 1)];
		const out = reuseSessions(held, next);
		expect(out).toHaveLength(ROWS);
		expect(out[0]).toBe(held[1]);
		expect(out[ROWS - 1]).toBe(next[ROWS - 1]);
	});

	it("hands the first frame through untouched", () => {
		const next = frame().sessions;
		expect(reuseSessions([], next)).toBe(next);
	});
});

describe("the pane's wiring (source)", () => {
	const PANE = readFileSync(
		new URL("./conversations-pane.tsx", import.meta.url),
		"utf8",
	);

	it("renders rows through the memoised SessionRow with a hoisted renderer", () => {
		expect(PANE).toContain("<SessionRow");
		expect(PANE).not.toContain("<AgentListRow");
		expect(PANE).toContain("renderItem={renderItem}");
		expect(PANE).toContain("keyExtractor={itemKey}");
	});

	it("does not subscribe to per-frame counters", () => {
		// `frameCount` and `lastFrameAt` change on EVERY frame; the pane reads
		// only what it paints from them.
		expect(PANE).not.toContain("useListState((state) => state.frameCount)");
		expect(PANE).not.toContain("useListState((state) => state.lastFrameAt)");
	});

	it("no longer prints the model id on every row", () => {
		expect(PANE).not.toContain("model={session.model_label}");
		const ROW = readFileSync(
			new URL("./session-row.tsx", import.meta.url),
			"utf8",
		);
		expect(ROW).not.toContain("model=");
		expect(ROW).toContain("cwd={");
	});
});
