/** The "Notifications are off" nudge: a small, dismissible row at the top of
 * the drawer's session list while the OS permission is DENIED (operator,
 * 2026-11-14: a default nobody discovers reads as "notifications don't
 * work"). The rules under test are the operator's: shown only on a native
 * `denied`; a tap opens the app's OS settings; a dismissal hides it for 14
 * days; three dismissals and it never comes back; a grant made in the OS
 * settings hides it on the next foreground. */
import { describe, expect, it, vi } from "vitest";

import { memorySecureStore } from "@/connection/storage";
import {
	createNudgeRecords,
	NUDGE_MAX_DISMISSALS,
	NUDGE_RECORD_KEY,
	NUDGE_SNOOZE_MS,
	type NudgeDeps,
	parseNudgeRecord,
	watchNudge,
} from "@/notifications/denied-nudge";
import type { PushAvailability } from "@/notifications/permission";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const DAY = 24 * 60 * 60 * 1000;

/** A phone: its OS permission, its keystore, its clock, its foreground
 *  events and its settings opener — every seam the nudge has. */
const phone = (availability: PushAvailability, platform = "ios") => {
	const adapter = memorySecureStore();
	const state = {
		availability,
		now: 1_000 * DAY,
		active: undefined as (() => void) | undefined,
	};
	const openSettings = vi.fn(async () => {});
	const deps: NudgeDeps = {
		platform,
		readAvailability: async () => state.availability,
		records: createNudgeRecords(async () => adapter),
		now: () => state.now,
		openSettings,
		onForeground: (listener) => {
			state.active = listener;
			return () => {
				state.active = undefined;
			};
		},
	};
	const shown: boolean[] = [];
	const watch = () => watchNudge(deps, (visible) => shown.push(visible));
	const settle = async () => {
		for (let i = 0; i < 4; i++)
			await new Promise((resolve) => setImmediate(resolve));
	};
	return { adapter, state, openSettings, deps, shown, watch, settle };
};

describe("when the row shows", () => {
	it("denied: shown", async () => {
		const p = phone("denied");
		p.watch();
		await p.settle();
		expect(p.shown.at(-1)).toBe(true);
	});

	it("granted, undetermined (the primer's case), unknown, unsupported: never", async () => {
		for (const availability of [
			"granted",
			"undetermined",
			"unknown",
			"unsupported",
		] as const) {
			const p = phone(availability);
			p.watch();
			await p.settle();
			expect(p.shown.at(-1) ?? false).toBe(false);
		}
	});

	it("web: never, even when the browser reports denied", async () => {
		const p = phone("denied", "web");
		p.watch();
		await p.settle();
		expect(p.shown.at(-1) ?? false).toBe(false);
	});
});

describe("what the row does", () => {
	it("Turn on opens this app's OS settings", async () => {
		const p = phone("denied");
		const nudge = p.watch();
		await p.settle();
		await nudge.turnOn();
		expect(p.openSettings).toHaveBeenCalledTimes(1);
	});

	it("disappears on the next foreground once permission was granted in the OS settings", async () => {
		const p = phone("denied");
		const nudge = p.watch();
		await p.settle();
		await nudge.turnOn();
		expect(p.shown.at(-1)).toBe(true);
		p.state.availability = "granted";
		p.state.active?.();
		await p.settle();
		expect(p.shown.at(-1)).toBe(false);
	});

	it("unsubscribes from foreground events when unmounted", async () => {
		const p = phone("denied");
		const nudge = p.watch();
		await p.settle();
		nudge.stop();
		expect(p.state.active).toBeUndefined();
	});
});

describe("dismissal", () => {
	it("hides the row at once and for 14 days, then it returns", async () => {
		const p = phone("denied");
		const nudge = p.watch();
		await p.settle();
		await nudge.dismiss();
		expect(p.shown.at(-1)).toBe(false);
		p.state.now += NUDGE_SNOOZE_MS - 1;
		p.state.active?.();
		await p.settle();
		expect(p.shown.at(-1)).toBe(false);
		p.state.now += 1;
		p.state.active?.();
		await p.settle();
		expect(p.shown.at(-1)).toBe(true);
		expect(NUDGE_SNOOZE_MS).toBe(14 * DAY);
	});

	it("after the third dismissal, never again", async () => {
		const p = phone("denied");
		const nudge = p.watch();
		await p.settle();
		for (let i = 0; i < NUDGE_MAX_DISMISSALS; i++) {
			expect(p.shown.at(-1)).toBe(true);
			await nudge.dismiss();
			p.state.now += NUDGE_SNOOZE_MS;
			p.state.active?.();
			await p.settle();
		}
		expect(NUDGE_MAX_DISMISSALS).toBe(3);
		p.state.now += 365 * DAY;
		p.state.active?.();
		await p.settle();
		expect(p.shown.at(-1)).toBe(false);
		expect(
			JSON.parse(p.adapter.items.get(NUDGE_RECORD_KEY) ?? "null"),
		).toMatchObject({ v: 1, dismissals: 3 });
	});

	it("survives a restart: a fresh watcher reads the stored snooze", async () => {
		const p = phone("denied");
		const first = p.watch();
		await p.settle();
		await first.dismiss();
		first.stop();
		p.shown.length = 0;
		p.watch();
		await p.settle();
		expect(p.shown.at(-1) ?? false).toBe(false);
	});

	it("a clock moved backwards does not bring it back early", async () => {
		const p = phone("denied");
		const nudge = p.watch();
		await p.settle();
		await nudge.dismiss();
		p.state.now -= 30 * DAY;
		p.state.active?.();
		await p.settle();
		expect(p.shown.at(-1)).toBe(false);
	});

	it("a corrupt record is spent, never a reason to nag", () => {
		expect(parseNudgeRecord(null)).toBe(null);
		expect(parseNudgeRecord("not json")?.dismissals).toBe(NUDGE_MAX_DISMISSALS);
		expect(parseNudgeRecord('{"v":1,"dismissals":1,"lastAt":5}')).toEqual({
			v: 1,
			dismissals: 1,
			lastAt: 5,
		});
	});

	it("a keystore that cannot be read shows nothing", async () => {
		const p = phone("denied");
		p.deps.records = {
			get: async () => {
				throw new Error("keystore locked");
			},
			set: async () => {},
		};
		p.watch();
		await p.settle();
		expect(p.shown.at(-1) ?? false).toBe(false);
	});
});
