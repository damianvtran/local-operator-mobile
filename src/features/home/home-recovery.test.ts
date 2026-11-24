import { describe, expect, it } from "vitest";
import { homeRecoveryKind } from "./home-recovery";

const base = {
	busy: false,
	coldStartSettled: true,
	connected: true,
	offline: false,
	refusal: null,
};

describe("homeRecoveryKind", () => {
	/* The TestFlight 2026-11-18 frame: an attempt still in flight (or a cold
	 *  start not yet settled) while the route is already live must not paint
	 *  "Connecting to {host}…" under a connected header chip. */
	it.each([
		{ busy: true, coldStartSettled: true },
		{ busy: false, coldStartSettled: false },
		{ busy: true, coldStartSettled: false },
	])("shows no splash on a live route while %o", (flags) => {
		expect(homeRecoveryKind({ ...base, ...flags })).toBeNull();
	});

	it("keeps the connecting splash while an attempt runs with no live route", () => {
		expect(homeRecoveryKind({ ...base, connected: false, busy: true })).toBe(
			"restoring",
		);
		expect(
			homeRecoveryKind({ ...base, connected: false, coldStartSettled: false }),
		).toBe("restoring");
	});

	it("keeps the original order for the settled branches", () => {
		expect(
			homeRecoveryKind({
				...base,
				connected: false,
				refusal: { kind: "sign-in" },
			}),
		).toBe("auth");
		expect(
			homeRecoveryKind({ ...base, refusal: { kind: "account-mismatch" } }),
		).toBe("auth");
		expect(homeRecoveryKind({ ...base, offline: true })).toBe("offline");
		expect(homeRecoveryKind({ ...base, refusal: { kind: "relay" } })).toBe(
			"error",
		);
		expect(homeRecoveryKind({ ...base, connected: false })).toBe("no-host");
		expect(homeRecoveryKind(base)).toBeNull();
	});
});
