import { describe, expect, it } from "vitest";

import {
	deviceStateDescription,
	deviceTitle,
	PUSH_DEVICE_STATE_DESCRIPTIONS,
} from "@/notifications/devices";

/**
 * The mirror check: these strings are the CORE's words
 * (`push_devices.STATE_DESCRIPTIONS`), copied so two surfaces cannot spell one
 * state two ways. The assertions below are the copies written out again — that
 * is the point, not an accident: a reword here fails the test rather than
 * quietly drifting from the CLI legend the core renders.
 */

describe("the device state vocabulary", () => {
	it("carries the core's five descriptions verbatim", () => {
		expect(PUSH_DEVICE_STATE_DESCRIPTIONS).toEqual({
			live: "registered, and push resumes on its next authenticated read",
			expired:
				"notifications are paused for this device until you sign in again",
			unpaired: "this computer is no longer paired",
			revoked: "this device was revoked on this computer",
			absent: "not in this computer's registry; it may register again",
		});
	});

	it("renders an unknown state as itself — never a guessed description", () => {
		expect(deviceStateDescription("live")).toBe(
			PUSH_DEVICE_STATE_DESCRIPTIONS.live,
		);
		expect(deviceStateDescription("a-future-state")).toBe("a-future-state");
	});
});

describe("device rows' titles", () => {
	it("prefers the machine's own name for the device", () => {
		expect(deviceTitle({ name: "Damian's iPhone", platform: "ios" })).toBe(
			"Damian's iPhone",
		);
	});

	it("falls back to the platform — never to the opaque device id", () => {
		expect(deviceTitle({ platform: "ios" })).toBe("iPhone");
		expect(deviceTitle({ name: "   ", platform: "android" })).toBe(
			"Android device",
		);
	});
});
