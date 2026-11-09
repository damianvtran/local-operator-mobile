import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { HistoryResponse } from "@/contracts";
import { historyTopReached } from "./history-scroll";
import { HistoryWindow } from "./history-window";
import { type ProjectionOwner, sameProjectionOwner } from "./session-content";

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

	it("threads the actual runtime action and all states to the list, with explicit accessible fallback", () => {
		for (const property of [
			"loadOlder",
			"loadingOlder",
			"hasOlder",
			"historyError",
			"historyGap",
		]) {
			expect(screen).toContain(`${property}={runtime.${property}}`);
		}
		expect(list).toContain("testID={CONTROL.transcriptLoadEarlier}");
		expect(list).toContain("onPress={requestOlder}");
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
