/** The notification permission primer's policy: when the in-context sheet that
 * asks a new user to turn notifications on may appear, what its two answers do,
 * and that it can never become a nag (operator request, 2026-11-14; ADR 0006
 * §5 as amended).
 *
 * The policy is pure (no React, no native module): the host component wires
 * the same functions to the live route, the permission read and the keystore,
 * so what is asserted here is what ships. Storage runs through the real
 * `memorySecureStore` adapter the other device-only records are tested with. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { memorySecureStore } from "@/connection/storage";
import type { PushAvailability } from "@/notifications/permission";
import {
	acceptPrimer,
	completedTurnObserved,
	createPrimerRecords,
	dismissPrimer,
	evaluatePrimer,
	HOME_PATH,
	markPrimerMoment,
	PRIMER_RECORD_KEY,
	PRIMER_REOFFER_AFTER_MS,
	type PrimerDeps,
	primerMomentStore,
	primerSheetVisible,
	resetPrimerMoment,
} from "@/notifications/permission-primer";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 14, 9, 0, 0);

type Rig = PrimerDeps & {
	clock: { now: number };
	availability: { value: PushAvailability };
	adapter: ReturnType<typeof memorySecureStore>;
};

const rig = (platform = "ios"): Rig => {
	const adapter = memorySecureStore();
	const clock = { now: T0 };
	const availability = { value: "undetermined" as PushAvailability };
	return {
		platform,
		readAvailability: async () => availability.value,
		records: createPrimerRecords(async () => adapter),
		now: () => clock.now,
		clock,
		availability,
		adapter,
	};
};

beforeEach(() => {
	resetPrimerMoment();
});

describe("first offer", () => {
	it("appears once for `undetermined` on first reaching a live computer", async () => {
		const r = rig();
		expect(await evaluatePrimer(r)).toBe(true);
		// The offer is recorded the moment it is shown, so an app killed with the
		// sheet up has still spent it.
		expect(
			JSON.parse(r.adapter.items.get(PRIMER_RECORD_KEY) ?? "null"),
		).toEqual({ v: 1, offers: 1, lastAt: T0 });
		// A second arrival on Home (same run or a cold start) without a dismissal
		// window and a completed turn does not re-offer.
		expect(await evaluatePrimer(r)).toBe(false);
		r.clock.now = T0 + 10 * DAY;
		expect(await evaluatePrimer(r)).toBe(false);
	});

	it.each(["granted", "denied", "unsupported", "unknown"] as const)(
		"never appears for `%s`",
		async (state) => {
			const r = rig();
			r.availability.value = state;
			expect(await evaluatePrimer(r)).toBe(false);
			// Nothing spent: a phone whose state later becomes `undetermined`
			// (a reinstall) still gets its first offer.
			expect(r.adapter.items.has(PRIMER_RECORD_KEY)).toBe(false);
		},
	);

	it("never appears on web, whatever the permission read says", async () => {
		const r = rig("web");
		expect(await evaluatePrimer(r)).toBe(false);
		markPrimerMoment();
		r.clock.now = T0 + 30 * DAY;
		expect(await evaluatePrimer(r)).toBe(false);
		expect(r.adapter.items.has(PRIMER_RECORD_KEY)).toBe(false);
	});
});

describe("Not now, and the single re-offer", () => {
	const dismissedRig = async (): Promise<Rig> => {
		const r = rig();
		expect(await evaluatePrimer(r)).toBe(true);
		r.clock.now = T0 + 60_000;
		await dismissPrimer(r);
		return r;
	};

	it("persists the dismissal with its timestamp", async () => {
		const r = await dismissedRig();
		expect(
			JSON.parse(r.adapter.items.get(PRIMER_RECORD_KEY) ?? "null"),
		).toEqual({ v: 1, offers: 1, lastAt: T0 + 60_000 });
		// A fresh reader (a cold start) sees the same record.
		const reread = await createPrimerRecords(async () => r.adapter).get();
		expect(reread).toEqual({ v: 1, offers: 1, lastAt: T0 + 60_000 });
	});

	it("does not re-offer before a completed turn, even after three days", async () => {
		const r = await dismissedRig();
		r.clock.now = T0 + 60_000 + 5 * DAY;
		expect(await evaluatePrimer(r)).toBe(false);
	});

	it("does not re-offer within three days, even after a completed turn", async () => {
		const r = await dismissedRig();
		markPrimerMoment();
		r.clock.now = T0 + 60_000 + PRIMER_REOFFER_AFTER_MS - 1;
		expect(await evaluatePrimer(r)).toBe(false);
	});

	it("re-offers once after a completed turn and three or more days", async () => {
		const r = await dismissedRig();
		markPrimerMoment();
		r.clock.now = T0 + 60_000 + PRIMER_REOFFER_AFTER_MS;
		expect(await evaluatePrimer(r)).toBe(true);
		expect(
			JSON.parse(r.adapter.items.get(PRIMER_RECORD_KEY) ?? "null"),
		).toEqual({
			v: 1,
			offers: 2,
			lastAt: T0 + 60_000 + PRIMER_REOFFER_AFTER_MS,
		});
	});

	it("never makes a third offer", async () => {
		const r = await dismissedRig();
		markPrimerMoment();
		r.clock.now = T0 + 4 * DAY;
		expect(await evaluatePrimer(r)).toBe(true);
		await dismissPrimer(r);
		for (const later of [8, 30, 365]) {
			r.clock.now = T0 + later * DAY;
			markPrimerMoment();
			expect(await evaluatePrimer(r)).toBe(false);
		}
	});

	it("treats an unreadable record as spent rather than nagging", async () => {
		const r = rig();
		r.adapter.items.set(PRIMER_RECORD_KEY, "not json");
		markPrimerMoment();
		r.clock.now = T0 + 30 * DAY;
		expect(await evaluatePrimer(r)).toBe(false);
	});
});

describe("Turn on notifications", () => {
	it("requests permission, then registers with the computer and Team Bridge", async () => {
		const order: string[] = [];
		const result = await acceptPrimer({
			requestPermission: async () => {
				order.push("request");
				return "granted";
			},
			registerSession: () => {
				order.push("session");
			},
			radientSignedIn: true,
			registerTeamBridge: async () => {
				order.push("team-bridge");
			},
		});
		expect(result).toBe("granted");
		expect(order).toEqual(["request", "session", "team-bridge"]);
	});

	it("skips Team Bridge when not signed in to Radient", async () => {
		const registerTeamBridge = vi.fn(async () => {});
		const registerSession = vi.fn();
		await acceptPrimer({
			requestPermission: async () => "granted",
			registerSession,
			radientSignedIn: false,
			registerTeamBridge,
		});
		expect(registerSession).toHaveBeenCalledTimes(1);
		expect(registerTeamBridge).not.toHaveBeenCalled();
	});

	it("registers nothing when the OS answers `denied`", async () => {
		const registerTeamBridge = vi.fn(async () => {});
		const registerSession = vi.fn();
		const result = await acceptPrimer({
			requestPermission: async () => "denied",
			registerSession,
			radientSignedIn: true,
			registerTeamBridge,
		});
		expect(result).toBe("denied");
		expect(registerSession).not.toHaveBeenCalled();
		expect(registerTeamBridge).not.toHaveBeenCalled();
	});

	it("a `denied` answer is never offered again, whatever follows", async () => {
		const r = rig();
		expect(await evaluatePrimer(r)).toBe(true);
		r.availability.value = await acceptPrimer({
			requestPermission: async () => "denied",
			registerSession: () => {},
			radientSignedIn: false,
			registerTeamBridge: async () => {},
		});
		markPrimerMoment();
		r.clock.now = T0 + 30 * DAY;
		expect(await evaluatePrimer(r)).toBe(false);
	});
});

describe("the completed-turn moment", () => {
	const row = (session_id: string, streaming: boolean) => ({
		session_id,
		streaming,
	});

	it("is a row that was streaming and no longer is", () => {
		expect(completedTurnObserved([row("a", true)], [row("a", false)])).toBe(
			true,
		);
		expect(completedTurnObserved([row("a", false)], [row("a", true)])).toBe(
			false,
		);
		expect(completedTurnObserved([row("a", true)], [row("a", true)])).toBe(
			false,
		);
		// A row that disappeared (ended, moved) is not a completed turn.
		expect(completedTurnObserved([row("a", true)], [row("b", false)])).toBe(
			false,
		);
	});

	it("latches for the run", () => {
		expect(primerMomentStore.getState().turnCompleted).toBe(false);
		markPrimerMoment();
		markPrimerMoment();
		expect(primerMomentStore.getState().turnCompleted).toBe(true);
	});
});

describe("PR #264 R1 m3: the sheet belongs to Home", () => {
	it("is visible only while Home is the screen; the offer stays spent", () => {
		expect(primerSheetVisible(true, HOME_PATH)).toBe(true);
		// A deep link resolving right after the offer pushes a session screen:
		// the root-mounted sheet must not stack over it.
		expect(primerSheetVisible(true, "/session/synthetic-session")).toBe(false);
		expect(primerSheetVisible(false, HOME_PATH)).toBe(false);
	});

	it("is the rule the root-mounted sheet renders with", () => {
		const sheet = readFileSync(
			join(
				process.cwd(),
				"src/features/notifications/permission-primer-sheet.tsx",
			),
			"utf8",
		);
		expect(sheet).toContain("visible={primerSheetVisible(visible, pathname)}");
		expect(sheet).not.toMatch(/visible=\{visible\}/);
	});
});
