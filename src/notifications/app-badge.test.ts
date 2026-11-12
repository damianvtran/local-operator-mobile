import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import {
	clearBadgeSource,
	reassertBadge,
	resetAppBadgeForTests,
	setBadgeSource,
} from "@/notifications/app-badge";
import { followTeamBridgeBadge, teamBridgeBadge } from "@/team-bridge/badge";
import {
	initialTeamBridgeState,
	type TeamBridgeState,
} from "@/team-bridge/store";

const TEST_FILE = /\.test\.tsx?$/;

const record = () => {
	const writes: number[] = [];
	resetAppBadgeForTests(async (count) => {
		writes.push(count);
	});
	return writes;
};

afterEach(() => resetAppBadgeForTests());

describe("the app icon badge owner", () => {
	it("writes a source's count, dedupes repeats, clears to 0", async () => {
		const writes = record();
		await setBadgeSource("teamBridge", 4);
		await setBadgeSource("teamBridge", 4);
		await setBadgeSource("teamBridge", 1);
		await clearBadgeSource("teamBridge");
		expect(writes).toEqual([4, 1, 0]);
	});

	it("clamps nonsense to a non-negative integer", async () => {
		const writes = record();
		await setBadgeSource("teamBridge", -3);
		await setBadgeSource("teamBridge", 2.7);
		await setBadgeSource("teamBridge", Number.NaN);
		expect(writes).toEqual([0, 2, 0]);
	});

	it("keeps writes in decision order even when the OS answers out of order", async () => {
		const landed: number[] = [];
		resetAppBadgeForTests(
			(count) =>
				new Promise((resolve) =>
					setTimeout(
						() => {
							landed.push(count);
							resolve(undefined);
						},
						count === 7 ? 20 : 0,
					),
				),
		);
		void setBadgeSource("teamBridge", 7);
		await setBadgeSource("teamBridge", 2);
		expect(landed).toEqual([7, 2]);
	});

	it("swallows an OS refusal (launchers without badge support)", async () => {
		resetAppBadgeForTests(async () => {
			throw new Error("unsupported launcher");
		});
		await expect(setBadgeSource("teamBridge", 3)).resolves.toBeUndefined();
	});

	it("reasserts on foreground only once something was decided", async () => {
		const writes = record();
		await reassertBadge();
		expect(writes).toEqual([]);
		await setBadgeSource("teamBridge", 3);
		await reassertBadge();
		expect(writes).toEqual([3, 3]);
	});

	it("is the ONLY caller of setBadgeCountAsync in the app", () => {
		// `git grep` over tracked sources: the structural half of "one owner",
		// so a second writer cannot land without failing here.
		const out = execFileSync(
			"git",
			["grep", "-l", "setBadgeCountAsync", "--", "src", "app"],
			{ cwd: join(__dirname, "../.."), encoding: "utf8" },
		);
		const writers = out
			.split("\n")
			.filter((path) => path && !TEST_FILE.test(path));
		expect(writers).toEqual(["src/notifications/app-badge.ts"]);
	});
});

describe("Team Bridge's badge source", () => {
	const state = (patch: Partial<TeamBridgeState>): TeamBridgeState => ({
		...initialTeamBridgeState(),
		...patch,
	});

	it("reports a known total, keeps the last number while unknown, clears when Bridge is gone", () => {
		expect(
			teamBridgeBadge(
				state({ gate: "open", unreadKnown: true, totalUnread: 6 }),
			),
		).toBe(6);
		expect(
			teamBridgeBadge(
				state({ gate: "open", unreadKnown: true, totalUnread: 0 }),
			),
		).toBe(0);
		// Cold start / failed first read / transient gates: unknown is not zero.
		expect(teamBridgeBadge(state({}))).toBeNull();
		expect(
			teamBridgeBadge(state({ gate: "open", unreadFailed: true })),
		).toBeNull();
		expect(
			teamBridgeBadge(
				state({ gate: "unavailable", unreadKnown: true, totalUnread: 2 }),
			),
		).toBe(2);
		expect(teamBridgeBadge(state({ gate: "signed_out" }))).toBe("clear");
		expect(
			teamBridgeBadge(
				state({ gate: "plan_required", unreadKnown: true, totalUnread: 4 }),
			),
		).toBe("clear");
	});

	it("follows a store: unread changes move the badge, a failed refresh does not, sign-out clears it", async () => {
		const writes = record();
		let current = state({});
		const listeners = new Set<(s: TeamBridgeState) => void>();
		const store = {
			getState: () => current,
			subscribe: (l: (s: TeamBridgeState) => void) => {
				listeners.add(l);
				return () => listeners.delete(l);
			},
		};
		const publish = (patch: Partial<TeamBridgeState>) => {
			current = { ...current, ...patch };
			for (const l of listeners) l(current);
		};
		const stop = followTeamBridgeBadge(store);
		publish({ gate: "open", unreadKnown: true, totalUnread: 2 });
		publish({ totalUnread: 3 });
		// A refresh that failed after a known count keeps `unreadKnown`, so no write.
		publish({ unreadFailed: false });
		publish({ gate: "signed_out", unreadKnown: false, totalUnread: 0 });
		await vi.waitFor(() => expect(writes).toEqual([2, 3, 0]));
		stop();
		publish({ gate: "open", unreadKnown: true, totalUnread: 8 });
		await Promise.resolve();
		expect(writes).toEqual([2, 3, 0]);
	});
});
