import { afterEach, describe, expect, it } from "vitest";
import type { HistoryResponse, TranscriptEntry } from "@/contracts";
import { RelayEndpoints, RelayHttpClient } from "@/relay";
import { loadFixtures } from "../../../tools/mock-relay/fixtures";
import { createRelay, DEFAULT_PASSWORD } from "../../../tools/mock-relay/relay";
import { buildScenarios } from "../../../tools/mock-relay/scenarios";
import { completionAnchorEntry } from "./completion-ack";
import { entryComplete } from "./completion-visibility";
import { HistoryWindow } from "./history-window";
import type { TranscriptItem } from "./turn-condensing";
import {
	olderFillReady,
	showsConversation,
	UNDERFLOW_FILL_PAGES,
} from "./underflow-fill";

/**
 * The app's production history reader against the mock relay's own worlds.
 *
 * WHY THIS EXISTS. PR #207 replaced the transcript's one-page read with a
 * cursor pager, and the visual gate went red on thirty S5 cells per profile
 * while every reader unit test was green: the reader was tested against
 * synthetic journals, the worlds were only ever exercised by a 630-cell
 * browser capture, and nothing in Node joined the two. Three contracts between
 * a world and the reader had drifted (each test below names its own), and each
 * showed up only as "marker not in the DOM" half an hour into CI.
 *
 * These run the real chain — mock relay over loopback HTTP → RelayHttpClient →
 * boundary schema → RelayEndpoints.history → HistoryWindow — for the worlds
 * the failing cells open, in both orders the screen can see (frame first, page
 * first, and the frame landing while the page is in flight). It is wire
 * infrastructure, not a rendered-app claim: the capture still owns the pixels.
 *
 * WHY IT LIVES UNDER src/, NOT tools/mock-relay/. It imports the production
 * reader, whose module graph uses the app's `@/` alias and ambient types.
 * `tools/tsconfig.json` (the E2E "Type-check the harness" gate) declares no
 * paths and cannot compile that graph (PR #207 R5-1: both web-target legs went
 * red before any capture). The app config can reach into tools/, as
 * `connection/__tests__/tunnel-session-http.test.ts` already does.
 */
const rigs: ReturnType<typeof createRelay>[] = [];
afterEach(async () => {
	await Promise.all(rigs.splice(0).map((relay) => relay.shutdown()));
});

const open = async (scenario: string) => {
	const world = buildScenarios(loadFixtures())[scenario]?.world();
	const projection = Object.values(world?.projections ?? {})[0];
	if (world === undefined || projection === undefined)
		throw new Error(`${scenario} has no projection`);
	const relay = createRelay({ scenario, quiet: true });
	rigs.push(relay);
	const { url } = await relay.listen({ port: 0 });
	const login = await fetch(`${url}/login`, {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `password=${encodeURIComponent(DEFAULT_PASSWORD)}`,
	});
	const cookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
	const endpoints = new RelayEndpoints(
		new RelayHttpClient({
			baseUrl: url,
			auth: () => ({ cookie, origin: null, credentials: "omit" }),
		}),
	);
	const asked: Array<string | undefined> = [];
	/** Set to hold the next page until the test releases it (the in-flight race). */
	const gate: { hold?: Promise<void> } = {};
	const reader = new HistoryWindow(
		async (before): Promise<HistoryResponse> => {
			asked.push(before);
			const page = await endpoints.history(projection.session_id, { before });
			await gate.hold;
			return page;
		},
		() => undefined,
	);
	return { reader, projection, asked, gate, world };
};

const ORDERS = ["frame first", "page first"] as const;

describe("the mock worlds the S5 cells open, through the production reader", () => {
	for (const order of ORDERS) {
		it(`long-transcript (${order}): all 520 rows are held and searchable, and the read settles`, async () => {
			const { reader, projection, asked } = await open("long-transcript");
			expect(projection.transcript).toHaveLength(520);
			if (order === "frame first") reader.accept(projection);
			// The screen's mount read (`use-session.ts`: `historyWindow.load(true)`).
			await reader.load(true);
			reader.accept(structuredClone(projection));
			// The list's own older read, as it fires while `hasMore` holds.
			while (reader.hasMore && !reader.error) await reader.load();
			expect(reader.error).toBeNull();
			expect(reader.read).toBe("ok");
			expect(reader.visibleRows.map((row) => row.id)).toEqual(
				projection.transcript.map((row) => row.id),
			);
			// `S5/find-hit` presses this row's result; `lo-expand` opens turn 00.
			expect(reader.visibleRows.map((row) => row.id)).toContain(
				"m-conv-03-user",
			);
			expect(reader.visibleRows[0]?.id).toBe("m-conv-00-user");
			// The whole conversation is held: the find caveat must stay silent
			// (`olderThanLoaded` in use-session.ts reads exactly these facts).
			expect(reader.hasMore).toBe(false);
			expect(reader.hasGap).toBe(false);
			// The beginning was established by a `before` page, never inferred.
			expect(reader.olderState).toBe("end");
			expect(asked.at(-1)).not.toBeUndefined();
		});
	}

	it("long-transcript-history: a frame with no rows opens on the newest history page, older state still open", async () => {
		const { reader, projection, asked, world } = await open(
			"long-transcript-history",
		);
		expect(projection.transcript).toHaveLength(0);
		reader.accept(projection);
		await reader.load(true);
		// The reopened-conversation shape: the page IS the transcript. Rendering
		// `session-transcript-empty` here is the defect S5/find-caveat caught.
		// 79 of the page's 80: the page happens to open on a user row, which the
		// reader's legacy rule for a flagless no-cursor render reads as a pinned
		// opener and holds back as context until an older page reaches it.
		expect(reader.visibleRows.map((row) => row.id)).toEqual(
			(world.history ?? []).slice(-79).map((row) => row.id),
		);
		expect(reader.error).toBeNull();
		expect(reader.read).toBe("ok");
		expect(asked).toEqual([undefined]);
		// One incomplete page: the cursor is its oldest row and the beginning is
		// NOT claimed, which is what makes the find scope line carry its caveat.
		expect(reader.cursor).toBe(reader.visibleRows[0]?.id);
		expect(reader.olderState).toBe("unknown");
		expect(reader.hasMore).toBe(true);
	});

	for (const order of ORDERS)
		it(`peer-tail-history (${order}): the first-window fill pages to the conversation and the completion it anchors (#322)`, async () => {
			const { reader, projection, asked } = await open("peer-tail-history");
			const attention =
				projection.attention && "anchor_id" in projection.attention
					? projection.attention
					: null;
			const anchorId = attention?.anchor_id ?? null;
			// The reported shape: a full live frame with no conversation row in it,
			// and the anchored answer absent from it.
			expect(projection.transcript).toHaveLength(80);
			const asItems = (rows: readonly TranscriptEntry[]): TranscriptItem[] =>
				rows.map((row) => ({ kind: "entry", id: row.id, entry: row }));
			expect(showsConversation(asItems(projection.transcript))).toBe(false);
			expect(projection.transcript.some((row) => row.id === anchorId)).toBe(
				false,
			);
			// Either order opens on a window with no conversation row: the frame,
			// or the mount read's page, whichever the reader sees first.
			if (order === "frame first") reader.accept(projection);
			await reader.load(true);
			reader.accept(structuredClone(projection));
			expect(showsConversation(asItems(reader.visibleRows))).toBe(false);
			expect(reader.hasMore).toBe(true);
			const ready = () =>
				olderFillReady({
					read: reader.read,
					loading: reader.loading,
					hasMore: reader.hasMore,
					olderState: reader.olderState,
					frameRows: projection.transcript.length,
					frameHeadPinned: projection.transcript_head_pinned,
				});
			// The list's automatic walk, minus the geometry: page while ready and no
			// conversation row is held, within the budget.
			let pages = 0;
			while (
				ready() &&
				!showsConversation(asItems(reader.visibleRows)) &&
				pages < UNDERFLOW_FILL_PAGES
			) {
				await reader.load();
				pages += 1;
			}
			expect(reader.error).toBeNull();
			expect(pages).toBeGreaterThan(0);
			expect(pages).toBeLessThanOrEqual(UNDERFLOW_FILL_PAGES);
			expect(asked).toHaveLength(pages + 1);
			expect(showsConversation(asItems(reader.visibleRows))).toBe(true);
			// The anchor now resolves from the rendered rows, complete — the gate's
			// `completionComplete` fact — while the live frame still lacks it.
			const anchor = completionAnchorEntry(
				anchorId,
				reader.visibleRows,
				projection.transcript,
			);
			expect(anchor?.id).toBe(anchorId);
			expect(anchor !== undefined && entryComplete(anchor)).toBe(true);
		});

	for (const scenario of ["rich-rows", "store-diff"]) {
		it(`${scenario}: a frame landing while the page is in flight keeps each row's own body`, async () => {
			const { reader, projection, gate } = await open(scenario);
			let release!: () => void;
			gate.hold = new Promise<void>((resolve) => {
				release = resolve;
			});
			// The screen's real order: the mount read starts, the stream's seed
			// frame lands, then the page settles.
			const read = reader.load(true);
			reader.accept(projection);
			release();
			await read;
			gate.hold = undefined;
			// Asserted BEFORE any older read: a later page re-serves the bodies and
			// would heal the frame the screen has already painted.
			expect(reader.visibleRows.map((row) => row.text)).toEqual(
				projection.transcript.map((row) => row.text),
			);
			while (reader.hasMore && !reader.error) await reader.load();
			expect(reader.error).toBeNull();
			expect(reader.visibleRows.map((row) => row.text)).toEqual(
				projection.transcript.map((row) => row.text),
			);
			// What `session-rich-rows` is derived from: a fenced assistant row.
			expect(
				reader.visibleRows.filter(
					(row) => row.kind === "assistant" && row.text.includes("```"),
				).length,
			).toBe(
				projection.transcript.filter(
					(row) => row.kind === "assistant" && row.text.includes("```"),
				).length,
			);
		});
	}

	it("a `before` naming the oldest row is the terminal page, not the newest one again", async () => {
		const { reader, projection, asked } = await open("idle");
		reader.accept(projection);
		const held = reader.visibleRows.map((row) => row.id);
		// The opening read is the newest durable page even with a frame held
		// (history-window.ts, "THE OPENING READ IS THE NEWEST PAGE TOO"); the
		// older read after it names the oldest row.
		await reader.load(true);
		await reader.load();
		expect(asked).toEqual([undefined, reader.cursor]);
		expect(reader.olderState).toBe("end");
		expect(reader.visibleRows.map((row) => row.id)).toEqual(held);
	});
});
