import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { resetAppBadgeForTests } from "@/notifications/app-badge";
import {
	type BackgroundClearDeps,
	BackgroundResult,
	type BackgroundUnreadScope,
	type PresentedNotification,
	readNotificationIds,
	registerBackgroundUnreadScope,
	resetBackgroundUnreadScopeForTests,
	runBackgroundClear,
	type UnreadSnapshot,
	waitForBackgroundUnreadScope,
} from "@/notifications/background-clear";
import {
	backgroundUnreadScope,
	followTeamBridgeBadge,
} from "@/team-bridge/badge";
import {
	initialTeamBridgeState,
	type TeamBridgeState,
} from "@/team-bridge/store";

/**
 * The background notification task's logic (`background-clear.ts`), driven the
 * way expo hands it a payload on each platform.
 *
 * What these pin, and why each matters on a phone nobody is looking at:
 *  - the badge moves ONLY through `app-badge.ts`'s Team Bridge source, via the
 *    store the foreground uses — never a second writer;
 *  - only banners a fresh read proves read are dismissed;
 *  - signed out (no scope) touches neither badge nor tray;
 *  - the run is bounded and returns a result instead of throwing.
 */

const attention = (count: number | string, computer = "cmp-1") => ({
	v: 1,
	type: "attention",
	computer,
	count,
});

/** iOS: the task gets `userInfo` minus `aps`, the §3.2 object under `body`
 *  (BackgroundEventTransformer.swift), plus `dataString`. */
const iosTaskPayload = (object: Record<string, unknown>) => ({
	data: { body: object, dataString: JSON.stringify(object) },
	notification: null,
	aps: { "content-available": 1 },
});

/** Android: the FCM data map, every value a string, `body` JSON-encoded. */
const androidTaskPayload = (object: Record<string, unknown>) => ({
	data: { body: JSON.stringify(object) },
});

const completionBanner = (
	identifier: string,
	computer: string,
): PresentedNotification => ({
	identifier,
	// iOS presented content.data is already `userInfo.body` (NotificationRecords.swift:331).
	data: {
		v: 1,
		type: "completion",
		computer,
		conversation: `cv-${identifier}`,
	},
});

const bridgeBanner = (
	identifier: string,
	tenantId: string,
): PresentedNotification => ({
	identifier,
	data: {
		v: 1,
		type: "team_bridge_message",
		tenant_id: tenantId,
		conversation_id: `c-${identifier}`,
	},
});

const scopeOf = (
	snapshot: UnreadSnapshot | null,
	active = true,
): BackgroundUnreadScope & { reads: number } => {
	const scope = {
		reads: 0,
		isActive: () => active,
		async refreshUnread() {
			scope.reads += 1;
			return snapshot;
		},
	};
	return scope;
};

const depsOf = (
	scope: BackgroundUnreadScope | null,
	presented: PresentedNotification[],
): BackgroundClearDeps & { dismissed: string[] } => {
	const dismissed: string[] = [];
	return {
		dismissed,
		scope: async () => scope,
		presented: async () => presented,
		async dismiss(id) {
			dismissed.push(id);
		},
		badgeSettled: async () => undefined,
	};
};

afterEach(() => {
	resetBackgroundUnreadScopeForTests();
	resetAppBadgeForTests();
	vi.useRealTimers();
});

describe("runBackgroundClear", () => {
	it.each([
		["iOS", iosTaskPayload],
		["Android", androidTaskPayload],
	])(
		"reads a %s attention wake and dismisses only read banners",
		async (_os, wrap) => {
			const scope = scopeOf({
				total: 1,
				byTenant: new Map([
					["t-read", 0],
					["t-unread", 1],
				]),
			});
			const deps = depsOf(scope, [
				completionBanner("a", "cmp-1"),
				completionBanner("b", "cmp-other"),
				bridgeBanner("c", "t-read"),
				bridgeBanner("d", "t-unread"),
			]);
			const result = await runBackgroundClear(wrap(attention(0)), deps);
			expect(result).toBe(BackgroundResult.NewData);
			expect(scope.reads).toBe(1);
			// cmp-1 reported 0 → its banner goes; cmp-other's stays; only the tenant
			// the fresh read proves empty loses its banner.
			expect(deps.dismissed).toEqual(["a", "c"]);
		},
	);

	it("keeps a computer's banners when the attention count is non-zero", async () => {
		const scope = scopeOf({ total: 0, byTenant: new Map() });
		const deps = depsOf(scope, [completionBanner("a", "cmp-1")]);
		await runBackgroundClear(iosTaskPayload(attention(2)), deps);
		expect(deps.dismissed).toEqual([]);
	});

	it("dismisses no Team Bridge banner when the fresh read did not land", async () => {
		const scope = scopeOf(null);
		const deps = depsOf(scope, [bridgeBanner("c", "t-read")]);
		expect(await runBackgroundClear(iosTaskPayload(attention(1)), deps)).toBe(
			BackgroundResult.NoData,
		);
		expect(deps.dismissed).toEqual([]);
	});

	it("signed out: no read, no dismissal, no badge write", async () => {
		const writes: number[] = [];
		resetAppBadgeForTests(async (count) => {
			writes.push(count);
		});
		const presented = vi.fn(async () => [completionBanner("a", "cmp-1")]);
		const dismiss = vi.fn(async () => undefined);
		const result = await runBackgroundClear(iosTaskPayload(attention(0)), {
			scope: async () => null,
			presented,
			dismiss,
		});
		expect(result).toBe(BackgroundResult.NoData);
		expect(presented).not.toHaveBeenCalled();
		expect(dismiss).not.toHaveBeenCalled();
		expect(writes).toEqual([]);
	});

	it("an account retired during the read touches nothing of the old account's", async () => {
		let active = true;
		const scope: BackgroundUnreadScope = {
			isActive: () => active,
			async refreshUnread() {
				active = false; // account switched while the read was in flight
				return { total: 0, byTenant: new Map() };
			},
		};
		const deps = depsOf(scope, [completionBanner("a", "cmp-1")]);
		expect(await runBackgroundClear(iosTaskPayload(attention(0)), deps)).toBe(
			BackgroundResult.NoData,
		);
		expect(deps.dismissed).toEqual([]);
	});

	it("ignores anything that is not an attention wake", async () => {
		const scope = scopeOf({ total: 0, byTenant: new Map() });
		const deps = depsOf(scope, [completionBanner("a", "cmp-1")]);
		for (const payload of [
			null,
			"x",
			{},
			{ actionIdentifier: "tap" },
			iosTaskPayload({
				v: 1,
				type: "completion",
				computer: "cmp-1",
				conversation: "cv",
			}),
			iosTaskPayload({ v: 2, type: "attention", computer: "cmp-1", count: 0 }),
		]) {
			expect(await runBackgroundClear(payload, deps)).toBe(
				BackgroundResult.NoData,
			);
		}
		expect(scope.reads).toBe(0);
		expect(deps.dismissed).toEqual([]);
	});

	it("is bounded: a hung read resolves Failed at the budget and dismisses nothing", async () => {
		vi.useFakeTimers();
		let release: (() => void) | undefined;
		const scope: BackgroundUnreadScope = {
			isActive: () => true,
			refreshUnread: () =>
				new Promise((resolve) => {
					release = () => resolve({ total: 0, byTenant: new Map() });
				}),
		};
		const deps = depsOf(scope, [completionBanner("a", "cmp-1")]);
		const run = runBackgroundClear(iosTaskPayload(attention(0)), deps, 25_000);
		await vi.advanceTimersByTimeAsync(24_999);
		let settled = false;
		void run.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(await run).toBe(BackgroundResult.Failed);
		// The read landing after the budget must not clear anything.
		release?.();
		await vi.runAllTimersAsync();
		expect(deps.dismissed).toEqual([]);
	});

	it("never throws: a failing dependency becomes Failed", async () => {
		const deps: BackgroundClearDeps = {
			scope: async () => {
				throw new Error("boom");
			},
			presented: async () => [],
			dismiss: async () => undefined,
		};
		await expect(
			runBackgroundClear(iosTaskPayload(attention(0)), deps),
		).resolves.toBe(BackgroundResult.Failed);
	});

	it("a dismiss failure (already swiped) does not stop the others", async () => {
		const scope = scopeOf({ total: 0, byTenant: new Map() });
		const dismissed: string[] = [];
		const result = await runBackgroundClear(iosTaskPayload(attention(0)), {
			scope: async () => scope,
			presented: async () => [
				completionBanner("a", "cmp-1"),
				completionBanner("b", "cmp-1"),
			],
			async dismiss(id) {
				if (id === "a") throw new Error("gone");
				dismissed.push(id);
			},
			badgeSettled: async () => undefined,
		});
		expect(result).toBe(BackgroundResult.NewData);
		expect(dismissed).toEqual(["b"]);
	});
});

describe("readNotificationIds", () => {
	it("dismisses every Team Bridge banner when the whole account is read", () => {
		expect(
			readNotificationIds(
				[bridgeBanner("x", "t-1"), bridgeBanner("y", "t-2")],
				{ computer: "cmp-1", count: 3 },
				{ total: 0, byTenant: new Map() },
			),
		).toEqual(["x", "y"]);
	});

	it("matches a digest banner by computer too", () => {
		expect(
			readNotificationIds(
				[
					{
						identifier: "d",
						data: { v: 1, type: "digest", computer: "cmp-1" },
					},
				],
				{ computer: "cmp-1", count: 0 },
				null,
			),
		).toEqual(["d"]);
	});
});

describe("the live-scope registry", () => {
	it("is null (signed out) after the wait when nothing registers", async () => {
		vi.useFakeTimers();
		const wait = waitForBackgroundUnreadScope(100);
		await vi.advanceTimersByTimeAsync(100);
		expect(await wait).toBeNull();
	});

	it("wakes a waiting task when the provider registers, and forgets on unregister", async () => {
		const scope = scopeOf(null);
		const wait = waitForBackgroundUnreadScope(10_000);
		const stop = registerBackgroundUnreadScope(scope);
		expect(await wait).toBe(scope);
		stop();
		vi.useFakeTimers();
		const after = waitForBackgroundUnreadScope(10);
		await vi.advanceTimersByTimeAsync(10);
		expect(await after).toBeNull();
	});
});

describe("backgroundUnreadScope over the real badge source", () => {
	const state = (patch: Partial<TeamBridgeState>): TeamBridgeState => ({
		...initialTeamBridgeState(),
		...patch,
	});

	const storeOf = (initial: TeamBridgeState) => {
		let current = initial;
		const listeners = new Set<
			(s: TeamBridgeState, p: TeamBridgeState) => void
		>();
		return {
			getState: () => current,
			subscribe(l: (s: TeamBridgeState, p: TeamBridgeState) => void) {
				listeners.add(l);
				return () => listeners.delete(l);
			},
			publish(patch: Partial<TeamBridgeState>) {
				const previous = current;
				current = { ...current, ...patch };
				for (const l of [...listeners]) l(current, previous);
			},
		};
	};

	it("moves the badge only through app-badge's Team Bridge source and reports the landed read", async () => {
		const writes: number[] = [];
		resetAppBadgeForTests(async (count) => {
			writes.push(count);
		});
		const store = storeOf(
			state({ gate: "open", unreadKnown: true, totalUnread: 4 }),
		);
		const stopBadge = followTeamBridgeBadge(store);
		const scope = backgroundUnreadScope({
			store,
			isActive: () => true,
			actions: {
				async refreshUnread() {
					store.publish({
						totalUnread: 1,
						organizations: [
							{ tenantId: "t-1", unread: 0 },
							{ tenantId: "t-2", unread: 1 },
						] as unknown as TeamBridgeState["organizations"],
					});
				},
			},
		});
		const snapshot = await scope.refreshUnread();
		expect(snapshot?.total).toBe(1);
		expect(snapshot?.byTenant.get("t-1")).toBe(0);
		// 4 is the follower's initial write; 1 is the background read landing.
		await vi.waitFor(() => expect(writes).toEqual([4, 1]));
		stopBadge();
	});

	it("a read the store's generation check dropped (no publish) is null", async () => {
		const store = storeOf(state({ gate: "open", unreadKnown: true }));
		const scope = backgroundUnreadScope({
			store,
			isActive: () => true,
			actions: { refreshUnread: async () => undefined },
		});
		expect(await scope.refreshUnread()).toBeNull();
	});

	it("a sign-out during the read is null", async () => {
		const store = storeOf(state({ gate: "open", unreadKnown: true }));
		const scope = backgroundUnreadScope({
			store,
			isActive: () => true,
			actions: {
				async refreshUnread() {
					store.publish({
						organizations: [] as TeamBridgeState["organizations"],
					});
					store.publish({ gate: "signed_out" });
				},
			},
		});
		expect(await scope.refreshUnread()).toBeNull();
	});
});
