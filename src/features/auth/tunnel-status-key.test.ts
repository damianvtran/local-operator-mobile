import { describe, expect, it } from "vitest";
import { tunnelStatusKey } from "./tunnel-status-key";

describe("tunnelStatusKey", () => {
	it.each([
		["active", "mobile.computers.badge.active"],
		["pending", "mobile.computers.status.provisioning"],
		["reconciling", "mobile.computers.status.provisioning"],
		["suspended", "mobile.computers.status.suspended"],
		["disabled", "mobile.computers.status.disabled"],
		["revoking", "mobile.computers.status.revoked"],
		["deleted", "mobile.computers.status.revoked"],
	] as const)("maps the control plane's %s to %s", (raw, key) => {
		expect(tunnelStatusKey(raw)).toBe(key);
	});

	it("ignores casing and surrounding whitespace", () => {
		expect(tunnelStatusKey("ACTIVE")).toBe("mobile.computers.badge.active");
		expect(tunnelStatusKey("Active")).toBe("mobile.computers.badge.active");
		expect(tunnelStatusKey("  suspended\n")).toBe(
			"mobile.computers.status.suspended",
		);
	});

	it("never falls back to the raw word: unknown, empty and absent are 'unknown'", () => {
		for (const raw of ["teleporting", "", "   ", undefined]) {
			expect(tunnelStatusKey(raw)).toBe("mobile.computers.status.unknown");
		}
	});
});
