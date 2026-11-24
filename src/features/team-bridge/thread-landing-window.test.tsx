/**
 * Opening a conversation must not reveal a partial page (TestFlight: "flickers
 * between the message at the bottom and some other message from higher up").
 *
 * These render the REAL list (react-native-web's VirtualizedList, the one the
 * web export ships and the same windowing as native's) with the transcript's
 * `initialNumToRender`, then drive the viewport controller the way the screen
 * does: the rows are held hidden, the viewport measures what is mounted, and
 * the landing finishes. The defect was the measurement covering only the
 * first ten rows, so the landing finished early and later batches dragged the
 * revealed list down through older messages.
 */
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { FlatList, Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import {
	createThreadViewport,
	LANDED_RENDER_COUNT,
	landingRenderCount,
} from "./thread-viewport";

const ROW = 59; // one short message row on the web export (measured, PR body)
const WINDOW = 708; // the 390x844 phone frame's transcript height
/** The screen's FlatList prop, as written in thread-screen.tsx. */
const WIRED =
	/initialNumToRender=\{landingRenderCount\(\s*items\.length,\s*positioned,?\s*\)\}/;
const rows = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ key: `bcm_${i + 1}` }));

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

/** Mounts the list once and returns the row keys it rendered on that pass. */
async function mounted(initialNumToRender: number, count: number) {
	const seen = new Set<string>();
	await act(async () =>
		root.render(
			<FlatList
				data={rows(count)}
				keyExtractor={(item) => item.key}
				initialNumToRender={initialNumToRender}
				renderItem={({ item }) => {
					seen.add(item.key);
					return <Text>{item.key}</Text>;
				}}
			/>,
		),
	);
	return seen;
}

describe("the opening page is mounted whole before landing", () => {
	it("an unpositioned open mounts every held row, not VirtualizedList's first ten", async () => {
		const seen = await mounted(landingRenderCount(50, false), 50);
		expect(seen.size).toBe(50);
		expect(seen.has("bcm_50")).toBe(true);
	});

	it("the default window (what the screen passed before) mounts a partial page", async () => {
		// The mechanism this fix exists for, pinned against the shipping list.
		const seen = await mounted(LANDED_RENDER_COUNT, 50);
		expect(seen.size).toBe(LANDED_RENDER_COUNT);
		expect(seen.has("bcm_50")).toBe(false);
	});

	it("once positioned, ordinary windowing returns", () => {
		expect(landingRenderCount(50, true)).toBe(LANDED_RENDER_COUNT);
		expect(landingRenderCount(3, false)).toBe(LANDED_RENDER_COUNT);
		expect(landingRenderCount(150, false)).toBe(150);
	});

	/*
	 * The event order the screen produces, at the viewport seam: the content
	 * measurement is whatever the list mounted. A ten-row partial page fits the
	 * window, so the landing finished at the top with 40 rows still to come;
	 * the whole page lands at its true end in one write.
	 */
	const land = (mountedRows: number) => {
		const positioned = vi.fn();
		const writes: number[] = [];
		const total = mountedRows * ROW;
		let y = 0; // the web host's scrollTop, as `readWebHost` reads it back
		const viewport = createThreadViewport({
			scrollTo: (offset) => {
				writes.push(offset);
				y = offset;
				return { y, viewport: WINDOW, content: total };
			},
			measure: () => ({
				y,
				viewport: WINDOW,
				content: Math.max(total, WINDOW),
			}),
			positioned,
			read: vi.fn(),
			newestSeq: () => 50,
			dataReady: () => true,
			web: true,
		});
		viewport.handlers.onLayout({ nativeEvent: { layout: { height: WINDOW } } });
		viewport.handlers.onContentSizeChange(390, total);
		viewport.dataChanged();
		return { positioned, writes, total };
	};

	it("landing on the default window finishes before the page is complete (the flicker)", () => {
		const partial = land(Math.min(50, LANDED_RENDER_COUNT));
		expect(partial.positioned).toHaveBeenCalledTimes(1);
		// Landed at the top of a page whose newest row is ~2.3k px further down.
		expect(partial.writes).toEqual([]);
	});

	it("landing on the whole page writes its true end once, then reveals", () => {
		const whole = land(landingRenderCount(50, false));
		expect(whole.writes).toEqual([whole.total - WINDOW]);
		expect(whole.positioned).toHaveBeenCalledTimes(1);
	});
});

describe("the transcript is wired to it", () => {
	it("thread-screen's FlatList takes its initialNumToRender from landingRenderCount", () => {
		const screen = readFileSync(
			new URL("./thread-screen.tsx", import.meta.url),
			"utf8",
		);
		expect(screen).toMatch(WIRED);
	});
});
