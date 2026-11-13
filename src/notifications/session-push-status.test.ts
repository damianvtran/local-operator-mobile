import { describe, expect, it } from "vitest";

import type { SessionPushRegistrationState } from "./session-push-registration-state";
import {
	sessionPushStatusCopy,
	sessionPushStatusKey,
} from "./session-push-status";

const state = (
	status: SessionPushRegistrationState["status"],
	routeKey: string | null = "radient:a",
): SessionPushRegistrationState => ({
	routeKey,
	status,
	code: null,
	registeredAt: null,
});

describe("Settings › Notifications registration sentence", () => {
	it("says nothing the permission sentence already says", () => {
		for (const status of ["idle", "unsupported", "permission"] as const)
			expect(sessionPushStatusKey(state(status), "radient:a")).toBeNull();
	});

	it("renders every fact only the registration knows", () => {
		expect(sessionPushStatusCopy(state("registered"), "radient:a")).toBe(
			"This phone is registered for alerts from this computer.",
		);
		for (const status of [
			"registering",
			"no-token",
			"refused",
			"relay-missing",
			"failed",
		] as const)
			expect(sessionPushStatusCopy(state(status), "radient:a")).toEqual(
				expect.any(String),
			);
	});

	it("never shows another computer's outcome", () => {
		expect(sessionPushStatusKey(state("registered"), "radient:b")).toBeNull();
		expect(sessionPushStatusKey(state("failed"), null)).toBeNull();
	});
});
