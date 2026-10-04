import { describe, expect, it } from "vitest";

import {
	availabilityFromHook,
	availabilityFromStatus,
	canRequestPermission,
	PUSH_COPY,
	PUSH_ENABLE_LABEL,
} from "@/notifications/permission";

/**
 * The permission vocabulary's two rules, asserted:
 *
 *  1. an unreadable or unknown status must NEVER become `denied` (a refusal we
 *     did not receive must not be claimed as one), and
 *  2. only `undetermined` carries a control — the prompt is an act, not a
 *     mount effect.
 */

describe("availabilityFromStatus", () => {
	it("maps the two positive statuses", () => {
		expect(availabilityFromStatus("granted")).toBe("granted");
		expect(availabilityFromStatus("provisional")).toBe("granted");
	});

	it("maps the direct negatives and the untouched state", () => {
		expect(availabilityFromStatus("denied")).toBe("denied");
		expect(availabilityFromStatus("undetermined")).toBe("undetermined");
	});

	it.each([
		["null", null],
		["undefined", undefined],
		["a number", 7],
		["a future status", "quietly-approved"],
	])("reads an unknown read (%s) as unknown, never denied", (_label, value) => {
		expect(availabilityFromStatus(value)).toBe("unknown");
	});
});

describe("the control's gate", () => {
	it("appears only while the OS has not been asked", () => {
		expect(canRequestPermission("undetermined")).toBe(true);
		expect(canRequestPermission("granted")).toBe(false);
		expect(canRequestPermission("denied")).toBe(false);
		expect(canRequestPermission("unsupported")).toBe(false);
		expect(canRequestPermission("unknown")).toBe(false);
	});

	it("has one label", () => {
		expect(PUSH_ENABLE_LABEL).toBe("Enable notifications");
	});
});

describe("the copy table", () => {
	it("has a sentence for every state", () => {
		for (const state of [
			"unsupported",
			"granted",
			"denied",
			"undetermined",
			"unknown",
		] as const) {
			expect(PUSH_COPY[state].length).toBeGreaterThan(0);
		}
	});

	it("never promises a delivery that cannot happen", () => {
		/* The granted state names the missing half instead of "you will be
		 * notified" (ADR 0006 §2.4's rule): no sentence may claim alerts work
		 * while the cloud forward is unbuilt. */
		expect(PUSH_COPY.granted.toLowerCase()).toContain(
			"not switched on for this computer yet",
		);
		expect(PUSH_COPY.granted.toLowerCase()).not.toContain(
			"you will be notified",
		);
	});
});

describe("availabilityFromHook", () => {
	it("accepts the five state names", () => {
		for (const state of [
			"granted",
			"denied",
			"undetermined",
			"unsupported",
			"unknown",
		] as const) {
			expect(availabilityFromHook(state)).toBe(state);
		}
	});

	it("refuses anything else — the hook cannot invent a sixth state", () => {
		expect(availabilityFromHook(null)).toBeNull();
		expect(availabilityFromHook("")).toBeNull();
		expect(availabilityFromHook("allowed")).toBeNull();
	});
});
