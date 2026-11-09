import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { HistoryResponse } from "@/contracts";
import { historyTopReached } from "./history-scroll";
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
		expect(screen).toContain("reloadHistory={runtime.reloadHistory}");
		expect(list).toContain("historyGap && reloadHistory ? (");
		expect(list).toContain("onPress={requestHistoryReload}");
		expect(list).toContain("testID={CONTROL.transcriptReloadHistory}");
		expect(list).toContain("webAnchor.current = null;");
		expect(list).toContain("void reloadHistory().then(pinTail)");
	});

	it("the explicit list action abandons stale anchors and pins the fresh tail without navigation", async () => {
		const start = list.indexOf("const requestHistoryReload = useCallback(");
		const end = list.indexOf("\n\t/* The viewport", start);
		const webAnchor = { current: { offset: 1200 } as unknown };
		const atTail = { current: false };
		const scrollPlaces = new Map([
			["synthetic-session", { offset: 1200, atTail: false }],
		]);
		const setOpenElsewhere = vi.fn();
		const pinTail = vi.fn();
		const reloadHistory = vi.fn(async () => {});
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const action = vm.runInNewContext(
			`${list.slice(start, end)}\nrequestHistoryReload`,
			{
				webAnchor,
				atTail,
				scrollPlaces,
				setOpenElsewhere,
				pinTail,
				reloadHistory,
				sessionId: "synthetic-session",
				useCallback: (callback: () => void) => callback,
			},
		);
		action();
		expect(webAnchor.current).toBeNull();
		expect(atTail.current).toBe(true);
		expect(setOpenElsewhere).toHaveBeenCalledWith(false);
		expect(scrollPlaces.has("synthetic-session")).toBe(false);
		expect(reloadHistory).toHaveBeenCalledOnce();
		await Promise.resolve();
		expect(pinTail).toHaveBeenCalledOnce();
	});

	it("threads the actual runtime action and all states to the list, with explicit accessible fallback", () => {
		for (const property of [
			"loadOlder",
			"reloadHistory",
			"loadingOlder",
			"hasOlder",
			"historyError",
			"historyGap",
			"retryHistory",
			"historyErrorScope",
		]) {
			expect(screen).toContain(`${property}={runtime.${property}}`);
		}
		expect(list).toContain("testID={CONTROL.transcriptLoadEarlier}");
		expect(list).toContain("onPress={canRetry ? requestRetry : requestOlder}");
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
		expect(list).toContain("{hasOlder || canRetry ? (");
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
