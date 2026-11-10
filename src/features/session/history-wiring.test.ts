import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HistoryResponse } from "@/contracts";
import { Button } from "@/ui/components/button";
import { anchoredScrollTop, historyTopReached } from "./history-scroll";

// Rendering `Button` in Node: the appearance hook reads the native colour
// scheme, which this Node host does not have (same seam as checkpoint-rail).
vi.mock("@/ui/appearance", () => ({
	useTokenColor: (role: string) => `token:${role}`,
}));

import { HistoryWindow } from "./history-window";
import { type ProjectionOwner, sameProjectionOwner } from "./session-content";

const RELOAD_DECLARATION =
	/const reloadHistory = useCallback\([\s\S]*?\[historyWindow\],?\s*\);/;
const NON_READER_MUTATIONS =
	/reloadToken|privateData|openStream|router|setText|setImages|send|queue/;

const runtime = readFileSync(
	new URL("./use-session.ts", import.meta.url),
	"utf8",
);
const list = readFileSync(
	new URL("./components/transcript-list.tsx", import.meta.url),
	"utf8",
);
const screen = readFileSync(
	new URL("../../../app/(app)/session/[id].tsx", import.meta.url),
	"utf8",
);

/** Execute the production reader factory with controlled hook dependencies.
 * This is a source/lifecycle seam, NOT mounted Native or rendered-app evidence. */
function readerFactory() {
	const start = runtime.indexOf("const historyWindow = useMemo(() => {");
	const end = runtime.indexOf(
		"\n\tuseEffect(() => {\n\t\thistoryWindow.activate();",
		start,
	);
	if (start < 0 || end < start)
		throw new Error("History factory source seam changed");
	const factory = runtime.slice(start, end);
	let previous: unknown[] | undefined;
	let cached: HistoryWindow | undefined;
	return (
		identity: ProjectionOwner,
		currentIdentity: { current: ProjectionOwner },
		endpoints: { history: ReturnType<typeof vi.fn> },
	) =>
		vm.runInNewContext(`${factory}\nhistoryWindow`, {
			HistoryWindow,
			identity,
			currentIdentity,
			sessionId: identity.sessionId,
			sameProjectionOwner,
			endpoints,
			historyChanged: () => {},
			useMemo: (create: () => HistoryWindow, dependencies: unknown[]) => {
				if (
					!previous ||
					previous.some((value, at) => value !== dependencies[at])
				) {
					previous = dependencies;
					cached = create();
				}
				return cached;
			},
		}) as HistoryWindow;
}
const owner = (
	sessionId = "synthetic-session",
	revision = 1,
	tunnelId = "synthetic-computer",
): ProjectionOwner => ({ sessionId, revision, tunnelId });

describe("history reader production wiring", () => {
	it.each([
		["session", owner("other-session")],
		["account/route revision", owner("synthetic-session", 2)],
		["computer", owner("synthetic-session", 1, "other-computer")],
	] as const)(
		"allocates an empty reader in the next render on %s change, before cleanup",
		async (_, nextOwner) => {
			const create = readerFactory();
			const identity = owner();
			const current = { current: identity };
			const endpoints = {
				history: vi.fn(
					async (): Promise<HistoryResponse> => ({
						entries: [],
						has_more: false,
					}),
				),
			};
			const old = create(identity, current, endpoints);
			await old.load();
			current.current = nextOwner;
			const next = create(nextOwner, current, endpoints);
			expect(next).not.toBe(old);
			expect(next.read).toBe("unknown");
			expect(next.rows).toEqual([]);
			// Even before effect cleanup, the old factory cannot ask the new route.
			await old.load(true);
			expect(endpoints.history).toHaveBeenCalledTimes(1);
			expect(old.error).toBe("failed");
		},
	);

	it("fences endpoint/client changes and preserves an unchanged render's reader", () => {
		const create = readerFactory();
		const identity = owner();
		const current = { current: identity };
		const endpoints = { history: vi.fn() };
		const first = create(identity, current, endpoints);
		expect(create(identity, current, endpoints)).toBe(first);
		expect(create(identity, current, { history: vi.fn() })).not.toBe(first);
	});

	it("executes the production reader-only reload without recreating the session or mutating composer state", async () => {
		const create = readerFactory();
		const identity = owner();
		const current = { current: identity };
		const endpoints = {
			history: vi.fn(async () => ({ entries: [], has_more: false })),
		};
		const historyWindow = create(identity, current, endpoints);
		const composer = {
			text: "draft",
			images: ["image"],
			uuid: "retained",
			queue: ["queued"],
		};
		const before = JSON.stringify(composer);
		const declaration = runtime.match(RELOAD_DECLARATION)?.[0];
		expect(declaration).toBeTruthy();
		const reloadHistory = vm.runInNewContext(`${declaration}\nreloadHistory`, {
			historyWindow,
			useCallback: (callback: () => Promise<void>) => callback,
		});
		await reloadHistory();
		expect(create(identity, current, endpoints)).toBe(historyWindow);
		expect(endpoints.history).toHaveBeenCalledExactlyOnceWith(
			identity.sessionId,
			{ before: undefined },
		);
		expect(JSON.stringify(composer)).toBe(before);
		expect(declaration).not.toMatch(NON_READER_MUTATIONS);
		// The list no longer offers the destructive reload for a disconnected
		// gap: the gap heals itself and its quiet row continues the fill.
		expect(screen).not.toContain("reloadHistory={runtime.reloadHistory}");
		expect(list).not.toContain("reloadHistory");
	});

	it("the gap row's Load continues the fill and keeps the reader's anchor and tail state", async () => {
		const start = list.indexOf("const requestHeal = useCallback(");
		const end = list.indexOf("\n\t/* The viewport", start);
		const webAnchor = { current: { offset: 1200 } as unknown };
		const atTail = { current: false };
		const scrollPlaces = new Map([
			["synthetic-session", { offset: 1200, atTail: false }],
		]);
		const setOpenElsewhere = vi.fn();
		const pinTail = vi.fn();
		const healHistory = vi.fn(async () => {});
		// PR #217 R1-2: a reader up-thread pressing Load gets the same web anchor
		// an older page does; the missing rows land above them.
		const holdWebAnchor = vi.fn();
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const action = vm.runInNewContext(
			`${list.slice(start, end)}\nrequestHeal`,
			{
				webAnchor,
				atTail,
				scrollPlaces,
				setOpenElsewhere,
				pinTail,
				healHistory,
				holdWebAnchor,
				sessionId: "synthetic-session",
				useCallback: (callback: () => void) => callback,
			},
		);
		action();
		await Promise.resolve();
		expect(healHistory).toHaveBeenCalledOnce();
		expect(holdWebAnchor).toHaveBeenCalledOnce();
		// A reader pinned to the tail stays pinned; no anchor to hold there.
		atTail.current = true;
		action();
		expect(holdWebAnchor).toHaveBeenCalledOnce();
		atTail.current = false;
		expect(webAnchor.current).toEqual({ offset: 1200 });
		expect(atTail.current).toBe(false);
		expect(setOpenElsewhere).not.toHaveBeenCalled();
		expect(scrollPlaces.get("synthetic-session")).toEqual({
			offset: 1200,
			atTail: false,
		});
		expect(pinTail).not.toHaveBeenCalled();
	});

	it("the session screen heals automatically and resumes through one debounced gate", () => {
		expect(runtime).toContain("{ autoHeal: true },");
		expect(runtime).toContain(
			'historyGap: historyWindow.hasGap && historyWindow.healState !== "healing",',
		);
		expect(runtime).toContain("healHistory,");
		expect(screen).toContain("healHistory={runtime.healHistory}");
		const foreground =
			runtime.match(
				/AppState\.addEventListener\("change", \(state\) => \{[\s\S]*?\n\t\t\}\);/,
			)?.[0] ?? "";
		// The gate dedupes only the history read; the stream always re-opens
		// (PR #217 R1-4).
		expect(foreground).toContain("const readHistory = resumeGate.current();");
		expect(foreground).not.toContain("if (!resumeGate.current()) return;");
		expect(foreground).toContain("reconnectRef.current();");
		expect(foreground).toContain("rereadRef.current(readHistory);");
		expect(runtime).toContain(
			"const readHistory = history\n\t\t\t\t? historyWindow.load(true)\n\t\t\t\t: Promise.resolve();",
		);
		// A drop, a stall or a transient error arms the recovery re-read; the
		// first frame after it spends it through the same gate.
		expect(runtime).toContain(
			'if (status.lastEnd === "error" || status.state === "stalled")',
		);
		expect(runtime).toContain(
			"if (resumeGate.current()) void historyRef.current.load(true);",
		);
	});

	it("threads the actual runtime action and all states to the list, with explicit accessible fallback", () => {
		for (const property of [
			"loadOlder",
			"healHistory",
			"loadingOlder",
			"hasOlder",
			"historyError",
			"historyGap",
			"retryHistory",
			"historyErrorScope",
			"historyGapBefore",
		]) {
			expect(screen).toContain(`${property}={runtime.${property}}`);
		}
		expect(list).toContain("testID={CONTROL.transcriptLoadEarlier}");
		expect(list).toContain(
			"onPress={olderRetry ? requestRetry : requestOlder}",
		);
		expect(list).toContain("historyTopReached(");
		expect(list).not.toContain("onStartReached=");
		expect(runtime).toContain("return () => historyWindow.retire();");
		expect(runtime).toContain(
			"if (ownsProjection) historyWindow.accept(projection);",
		);
		expect(runtime).toContain(
			"ownsProjection ? historyWindow.visibleRows : EMPTY_HISTORY",
		);
	});
});

describe("history retry targets the read that failed (PR #207 R2)", () => {
	/** Execute the list's production retry decision with controlled props. A
	 * source seam like the reload action above, not a mounted Native press. */
	const retrySeam = (props: {
		historyError: "failed" | "stalled" | null;
		historyErrorScope: "newest" | "older" | null;
		hasOlder: boolean;
	}) => {
		const start = list.indexOf("const newestFailed =");
		const end = list.indexOf("\n\t/** The capture hook", start);
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const retryHistory = vi.fn(async () => {});
		const requestOlder = vi.fn();
		const { canRetry, requestRetry } = vm.runInNewContext(
			`${list.slice(start, end)}\n({ canRetry, requestRetry })`,
			{
				...props,
				loadingOlder: false,
				retryHistory,
				requestOlder,
				useCallback: (callback: () => void) => callback,
			},
		);
		return { canRetry, requestRetry, retryHistory, requestOlder };
	};

	it("a failed newest refresh at the beginning still offers a retry, and it refreshes", () => {
		const seam = retrySeam({
			historyError: "failed",
			historyErrorScope: "newest",
			hasOlder: false,
		});
		expect(seam.canRetry).toBe(true);
		seam.requestRetry();
		expect(seam.retryHistory).toHaveBeenCalledOnce();
		expect(seam.requestOlder).not.toHaveBeenCalled();
	});

	it("a failed newest refresh with older pages remaining refreshes, not an older page", () => {
		const seam = retrySeam({
			historyError: "failed",
			historyErrorScope: "newest",
			hasOlder: true,
		});
		seam.requestRetry();
		expect(seam.retryHistory).toHaveBeenCalledOnce();
		expect(seam.requestOlder).not.toHaveBeenCalled();
	});

	it("an older-page failure retries the older page with its anchor handling", () => {
		const seam = retrySeam({
			historyError: "stalled",
			historyErrorScope: "older",
			hasOlder: true,
		});
		expect(seam.canRetry).toBe(true);
		seam.requestRetry();
		expect(seam.requestOlder).toHaveBeenCalledOnce();
		expect(seam.retryHistory).not.toHaveBeenCalled();
	});

	it("hides retry when it could not issue a request", () => {
		expect(
			retrySeam({
				historyError: "failed",
				historyErrorScope: "older",
				hasOlder: false,
			}).canRetry,
		).toBe(false);
		expect(
			retrySeam({ historyError: null, historyErrorScope: null, hasOlder: true })
				.canRetry,
		).toBe(false);
		expect(list).toContain("{hasOlder || olderRetry ? (");
		expect(list).toContain('"mobile.session.history.refresh_failed"');
	});
});

describe("actual top-scroll transitions", () => {
	it("does not load at mount, while remaining at top, or before initial tail positioning", () => {
		expect(historyTopReached(0, 0, true, false)).toBe(false);
		expect(historyTopReached(0, 1000, true, false)).toBe(false);
		expect(historyTopReached(1000, 0, false, false)).toBe(false);
	});
	it("loads one top edge for touch, web, keyboard or accessibility offsets without drag callbacks", () => {
		expect(historyTopReached(20, 0, true, false)).toBe(true);
		expect(historyTopReached(20, -1, true, false)).toBe(true);
		expect(historyTopReached(0, 0, true, false)).toBe(false);
		expect(historyTopReached(20, 0, true, true)).toBe(false);
	});
});

/** A list seam executed as JavaScript: the production source with its types
 * stripped, run against controlled DOM-like objects. NOT a rendered browser. */
const MOUNTED_REFERENCE = /const mountedReference = \([\s\S]*?\n\};/;
const CAPTURE_WEB_ANCHOR =
	/captureWebAnchor\.current = \(scroll: HTMLElement\) => \{[\s\S]*?\n\t\};/;
const runSeam = (source: string, result: string, context: object) =>
	vm.runInNewContext(`${stripTypeScriptTypes(source)}\n${result}`, {
		useCallback: (callback: () => void) => callback,
		...context,
	});
const seam = (pattern: RegExp) => {
	const match = list.match(pattern);
	if (!match) throw new Error(`list seam changed: ${pattern}`);
	return match[0];
};

describe("web prepend keeps the reader's row in place (PR #207 Q5/Q6)", () => {
	type Fake = {
		isConnected: boolean;
		top: number;
		height: number;
		getBoundingClientRect(): { top: number; bottom: number };
	};
	const element = (top: number, height: number): Fake => ({
		isConnected: true,
		top,
		height,
		getBoundingClientRect() {
			return { top: this.top, bottom: this.top + this.height };
		},
	});
	/** QA r3's geometry: scroller at y=64, header 64 px, reader at scrollTop 0
	 * with old row o0 at the top; a page of 80 rows estimated at 29 px lands. */
	const prepend = () => {
		const scroll = {
			scrollTop: 0,
			style: {} as Record<string, string>,
			getBoundingClientRect: () => ({ top: 64, bottom: 724 }),
		};
		const webRows = { current: new Map<string, Fake>() };
		const old = Array.from({ length: 10 }, (_, at) => `o${at}`);
		for (const [at, id] of old.entries())
			webRows.current.set(id, element(128 + at * 40, 40));
		const fresh = Array.from({ length: 80 }, (_, at) => `n${at}`);
		const itemsRef = { current: old.map((id) => ({ id })) };
		const geometryFor = (rows: { id: string }[]) => {
			const index = new Map(rows.map((row, at) => [row.id, at]));
			const offsets = [0];
			for (const row of rows)
				offsets.push(
					(offsets.at(-1) ?? 0) + (row.id.startsWith("n") ? 29 : 40),
				);
			return { index, offsets };
		};
		const webAnchor = { current: null as unknown };
		const shared: {
			webRows: typeof webRows;
			webAnchor: typeof webAnchor;
			itemsRef: typeof itemsRef;
			geometryFor: typeof geometryFor;
			mountedReference?: unknown;
		} = { webRows, webAnchor, itemsRef, geometryFor };
		const capture = webCapture(shared);
		const context = {
			captureWebAnchor: { current: capture },
			mountedReference: shared.mountedReference,
			Platform: { OS: "web" },
			listRef: { current: { getNativeScrollRef: () => scroll } },
			webRows,
			webAnchor,
			atTail: { current: true },
			loadOlder: vi.fn(async () => {}),
			loadingOlder: false,
			hasOlder: true,
			itemsRef,
			geometryFor,
			anchoredScrollTop,
		};
		const holdWebAnchor = runSeam(
			seam(/const holdWebAnchor = useCallback\([\s\S]*?\n\t\}, \[[^\]]*\]\);/),
			"holdWebAnchor",
			context,
		);
		const requestOlder = runSeam(
			seam(/const requestOlder = useCallback\([\s\S]*?\n\t\}, \[[^\]]*\]\);/),
			"requestOlder",
			{ ...context, holdWebAnchor },
		);
		const restore = runSeam(
			seam(
				/const restoreWebAnchor = useCallback\([\s\S]*?\n\t\}, \[[^\]]*\]\);/,
			),
			"restoreWebAnchor",
			context,
		);
		requestOlder();
		// react-native-web keeps the window's INDICES: they now name the new rows,
		// so o0 unmounts and n0… mount where o0… were (the blank-block state).
		for (const id of old) {
			const node = webRows.current.get(id);
			if (node) node.isConnected = false;
			webRows.current.delete(id);
		}
		for (const [at, id] of fresh.slice(0, 10).entries())
			webRows.current.set(id, element(128 + at * 29, 29));
		itemsRef.current = [...fresh, ...old].map((id) => ({ id }));
		return { scroll, restore, webRows, webAnchor, element };
	};

	/** The production capture and its table helper, run as JavaScript. */
	const webCapture = (shared: {
		webRows: unknown;
		webAnchor: unknown;
		itemsRef: unknown;
		geometryFor: unknown;
		mountedReference?: unknown;
	}) => {
		shared.mountedReference = runSeam(
			seam(MOUNTED_REFERENCE),
			"mountedReference",
			{},
		);
		const captureWebAnchor = { current: null as unknown };
		runSeam(seam(CAPTURE_WEB_ANCHOR), "undefined", {
			...shared,
			captureWebAnchor,
		});
		return captureWebAnchor.current as (scroll: unknown) => void;
	};

	it("captures the row at the viewport's top even while the list window lags behind a jump", () => {
		// A focus/click jumped the scroller to the top; react-native-web has not
		// re-rendered its window, so the only mounted rows are far below (QA r3
		// rendered check: the anchor was taken 5893 pt down).
		const rows = Array.from({ length: 100 }, (_, at) => ({ id: `o${at}` }));
		const webRows = { current: new Map<string, Fake>() };
		for (let at = 60; at < 70; at += 1)
			webRows.current.set(`o${at}`, element(64 + 64 + at * 40, 40));
		const webAnchor = {
			current: null as { id: string; distance: number } | null,
		};
		const capture = webCapture({
			webRows,
			webAnchor,
			itemsRef: { current: rows },
			geometryFor: (data: { id: string }[]) => ({
				index: new Map(data.map((row, at) => [row.id, at])),
				offsets: Array.from({ length: data.length + 1 }, (_, at) => at * 40),
			}),
		});
		capture({
			scrollTop: 0,
			getBoundingClientRect: () => ({ top: 64, bottom: 724 }),
		});
		// o0 sits right under the 64 pt header, 64 pt below the scroller's top.
		expect(webAnchor.current).toMatchObject({ id: "o0", distance: 64 });
	});

	it("moves scrollTop so the previously top row lands where it was, even though it unmounted", () => {
		const { scroll, restore, webAnchor } = prepend();
		restore();
		// o0's content top = 64 (header) + 80 × 29; kept 64 px below the scroller top.
		expect(scroll.scrollTop).toBe(80 * 29);
		expect((webAnchor.current as { offset: number }).offset).toBe(80 * 29);
	});

	it("then corrects estimate error from the mounted row's real position", () => {
		const { scroll, restore, webRows, element } = prepend();
		restore();
		// The list's window follows the scroll: o0 mounts 6 px lower than estimated.
		webRows.current.set("o0", element(128 + 6, 40));
		restore();
		expect(scroll.scrollTop).toBe(80 * 29 + 6);
	});

	it("hands anchoring back to the browser once the reader moves (PR #217 R1-2)", () => {
		const { scroll, restore, webAnchor } = prepend();
		restore();
		expect(scroll.style.overflowAnchor).toBe("none");
		const release = runSeam(
			seam(
				/const releaseWebAnchor = useCallback\([\s\S]*?\n\t\}, \[[^\]]*\]\);/,
			),
			"releaseWebAnchor",
			{ webAnchor },
		);
		release();
		expect(webAnchor.current).toBeNull();
		// Not left off for the session: the automatic fill holds no list anchor.
		expect(scroll.style.overflowAnchor).toBe("");
		expect(list).toContain(
			"if (webAnchor.current && contentOffset.y !== webAnchor.current.offset)\n\t\t\t\treleaseWebAnchor();",
		);
	});

	it("computes both anchor paths from the list's own geometry", () => {
		expect(
			anchoredScrollTop({
				kind: "mounted",
				scrollTop: 100,
				rowTop: 300,
				desiredTop: 128,
			}),
		).toBe(272);
		expect(
			anchoredScrollTop({
				kind: "table",
				anchorOffset: 2320,
				reference: { contentTop: 64, offset: 0 },
				distance: 64,
			}),
		).toBe(2320);
		expect(
			anchoredScrollTop({
				kind: "table",
				anchorOffset: 10,
				reference: null,
				distance: 64,
			}),
		).toBe(0);
	});
});

describe("history controls keep focus while loading (PR #207 U1)", () => {
	it("the Load earlier / Try again control is never natively disabled", () => {
		const control = seam(
			/<Button[^<]*?testID=\{CONTROL\.transcriptLoadEarlier\}[^<]*?\/>/,
		);
		expect(control).toContain("loading={loadingOlder}");
		expect(control).not.toMatch(/\bdisabled=/);
	});

	it("a loading Button stays focusable and ignores presses through its own guard", () => {
		const onPress = vi.fn();
		const markup = renderToStaticMarkup(
			createElement(Button, {
				label: "Loading earlier messages…",
				onPress,
				loading: true,
				variant: "outline",
				testID: "transcript-load-earlier",
			}),
		);
		expect(markup).toContain('tabindex="0"');
		expect(markup).not.toMatch(/\sdisabled(=|\s|>)/);
		expect(markup).not.toContain('aria-disabled="true"');
		// The in-flight guard is the Button's own, not a native `disabled`.
		expect(
			readFileSync(
				new URL("../../ui/components/button.tsx", import.meta.url),
				"utf8",
			),
		).toContain("if (loading || disabled) return;");
	});
});

describe("the gap is shown where it is and where the reader is (PR #207 U2/D1)", () => {
	it("marks the hole inside every measured row wrapper and at the newest edge", () => {
		expect(
			list.match(/\{item\.id === gapItemId \? gapMarker : null\}/g),
			// turn bar, quiet group, fold bar (Tier A) and the entry row
		).toHaveLength(4);
		expect(list).toContain("testID={CONTROL.transcriptGapLoad}");
		expect(list).toContain("{newestEdgeNotice}");
		expect(list).toContain("testID={CONTROL.transcriptGapLoadNewest}");
		expect(list).toContain(
			'accessibilityHint={t("mobile.session.history.gap_load_hint")}',
		);
		// Quiet: a small text action beside the line, never a full-width
		// bordered button (the TestFlight screenshot).
		const marker = seam(/const gapMarker = useMemo\([\s\S]*?\n\t\);/);
		expect(marker).toContain('variant="quiet"');
		expect(marker).toContain('size="sm"');
		expect(marker).toContain("flex-row");
		expect(marker).not.toContain('variant="outline"');
	});

	it("reports a newest-refresh failure at the newest edge, not in the older header", () => {
		const header = seam(/const listHeader = useMemo\([\s\S]*?\n\t\);/);
		expect(header).not.toContain("refresh_failed");
		expect(header).not.toContain("transcriptGapLoadNewest");
		const edge = seam(/const newestEdgeNotice = useMemo\([\s\S]*?\n\t\);/);
		expect(edge).toContain('"mobile.session.history.refresh_failed"');
		expect(edge).toContain("testID={CONTROL.transcriptRetryLatest}");
		expect(runtime).toContain(
			'historyWindow.loading && historyWindow.loadingScope === "older"',
		);
	});
});
