import { describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("expo-router", () => ({
	router: { navigate },
	useNavigationContainerRef: () => ({
		isReady: () => false,
		getRootState: () => undefined,
		dispatch: () => undefined,
	}),
}));

import {
	appStackOf,
	HOME_ROUTE_NAME,
	pathForTarget,
	planTopLevelStack,
	type StackRouteLike,
	sessionTarget,
	topLevelResetFor,
} from "@/features/sessions/top-level-navigation";

const home: StackRouteLike = { key: "index-home-key", name: "index" };
const route = (
	name: string,
	params?: Record<string, unknown>,
): StackRouteLike => ({
	key: `${name}-key`,
	name,
	params,
});
const names = (routes: readonly StackRouteLike[]) => routes.map((r) => r.name);

describe("planTopLevelStack: the spec's stack table", () => {
	const cases: Array<{
		title: string;
		start: StackRouteLike[];
		target: { name: string; params?: Record<string, string> };
		expected: string[];
	}> = [
		{
			title: "[Home] → session A",
			start: [home],
			target: sessionTarget("A"),
			expected: ["index", "session/[id]"],
		},
		{
			title: "[Home, A] → Settings",
			start: [home, route("session/[id]", { id: "A" })],
			target: { name: "settings" },
			expected: ["index", "settings"],
		},
		{
			title: "[Home, Settings] → session B (Home → A → Settings → B)",
			start: [home, route("settings")],
			target: sessionTarget("B"),
			expected: ["index", "session/[id]"],
		},
		{
			title: "[Home, Settings] → Schedules",
			start: [home, route("settings")],
			target: { name: "schedules" },
			expected: ["index", "schedules"],
		},
		{
			title: "[Home, Settings, Theme] → Projects (nested page discarded)",
			start: [home, route("settings"), route("theme")],
			target: { name: "projects" },
			expected: ["index", "projects"],
		},
		{
			title: "[Home, B] → New chat",
			start: [home, route("session/[id]", { id: "B" })],
			target: { name: "index" },
			expected: ["index"],
		},
		{
			title: "[Home, A, Job] → session C (nested page discarded)",
			start: [
				home,
				route("session/[id]", { id: "A" }),
				route("session/[id]/agent/[jobId]", { id: "A" }),
			],
			target: sessionTarget("C"),
			expected: ["index", "session/[id]"],
		},
		{
			title: "[Home, Past] → a Past row",
			start: [home, route("past")],
			target: sessionTarget("S"),
			expected: ["index", "session/[id]"],
		},
		{
			title: "[Home, Notifications] → a notification's session",
			start: [home, route("notifications/index")],
			target: sessionTarget("S"),
			expected: ["index", "session/[id]"],
		},
		{
			title: "any deep link → a session",
			start: [home, route("settings"), route("theme")],
			target: sessionTarget("S"),
			expected: ["index", "session/[id]"],
		},
	];

	for (const testCase of cases) {
		it(testCase.title, () => {
			expect(names(planTopLevelStack(testCase.start, testCase.target))).toEqual(
				testCase.expected,
			);
		});
	}

	it("picking the screen already showing is a no-op, by reference", () => {
		const start = [home, route("settings")];
		expect(planTopLevelStack(start, { name: "settings" })).toBe(start);
		// The same session with owner metadata already on the route still reads
		// as the same screen; a reset would remount its input.
		const remoteStart = [
			home,
			route("session/[id]", { id: "A", remote: "1", owner: "peer" }),
		];
		expect(planTopLevelStack(remoteStart, sessionTarget("A"))).toBe(
			remoteStart,
		);
	});

	it("Home keeps its route key across a pick", () => {
		const next = planTopLevelStack(
			[home, route("settings")],
			sessionTarget("B"),
		);
		expect(next[0]).toBe(home);
		expect(next[0]?.key).toBe("index-home-key");
		expect(next[1]?.key).not.toBe(undefined);
	});

	it("inserts a fresh Home when the stack has no index route", () => {
		const next = planTopLevelStack([route("settings")], sessionTarget("B"));
		expect(names(next)).toEqual(["index", "session/[id]"]);
		expect(next[0]?.key).toBeDefined();
	});

	it("keeps the target's params so a remote session stays remote", () => {
		const next = planTopLevelStack([home], {
			name: "session/[id]",
			params: { id: "A", remote: "1", owner: "peer" },
		});
		expect(next[1]?.params).toEqual({
			id: "A",
			remote: "1",
			owner: "peer",
		});
	});
});

describe("topLevelResetFor", () => {
	const rootWith = (routes: StackRouteLike[], key = "stack-key") => ({
		routes: [
			{
				name: "(app)",
				state: {
					key,
					type: "stack",
					stale: false,
					routeNames: routes.map((r) => r.name),
					index: routes.length - 1,
					routes,
				},
			},
		],
	});

	it("targets the (app) stack and preserves its state fields", () => {
		const action = topLevelResetFor(rootWith([home, route("settings")]), {
			name: "projects",
		});
		expect(action).not.toBeNull();
		expect(action?.type).toBe("RESET");
		expect(action?.target).toBe("stack-key");
		expect(action?.payload.stale).toBe(false);
		expect(action?.payload.routeNames).toEqual(["index", "settings"]);
		expect(names(action?.payload.routes ?? [])).toEqual(["index", "projects"]);
		expect(action?.payload.index).toBe(1);
	});

	it("returns null for the screen already showing and for an unmounted stack", () => {
		const root = rootWith([home, route("settings")]);
		expect(topLevelResetFor(root, { name: "settings" })).toBeNull();
		expect(topLevelResetFor({ routes: [] }, { name: "settings" })).toBeNull();
		expect(topLevelResetFor(null, { name: "settings" })).toBeNull();
	});

	it("finds the (app) stack only when it carries a state key", () => {
		expect(appStackOf(rootWith([home]))?.key).toBe("stack-key");
		expect(
			appStackOf({ routes: [{ name: "(app)", state: { routes: [home] } }] }),
		).toBeNull();
	});
});

describe("pathForTarget", () => {
	it("builds URLs for the cold-start fallback", () => {
		expect(pathForTarget({ name: HOME_ROUTE_NAME })).toBe("/");
		expect(pathForTarget({ name: "notifications/index" })).toBe(
			"/notifications",
		);
		expect(pathForTarget({ name: "settings" })).toBe("/settings");
		expect(pathForTarget(sessionTarget("a b"))).toBe("/session/a%20b");
		expect(
			pathForTarget({
				name: "team-bridge/[tenantId]/[conversationId]",
				params: { tenantId: "t", conversationId: "c" },
			}),
		).toBe("/team-bridge/t/c");
	});
});
