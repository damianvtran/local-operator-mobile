import { describe, expect, it } from "vitest";
import {
	type SignedOutLandingInput,
	signedOutLanding,
} from "./signed-out-landing";

const settledSignedOut: SignedOutLandingInput = {
	focused: true,
	coldStartSettled: true,
	busy: false,
	routed: false,
	refusal: null,
	savedTunnel: null,
	phase: "signed-out",
	restoredAccount: false,
};

describe("signedOutLanding", () => {
	it("sends a settled, route-less cold start on Home to welcome or tunnels", () => {
		expect(signedOutLanding(settledSignedOut)).toBe("/welcome");
		expect(
			signedOutLanding({ ...settledSignedOut, restoredAccount: true }),
		).toBe("/tunnels");
	});

	/* QA F2 (PR #304): a cold Team Bridge tap pushes the thread over Home before
	 * the cold start settles; the redirect from beneath replaced that thread. */
	it("never replaces a Team Bridge thread pushed over Home by a cold tap", () => {
		expect(
			signedOutLanding({
				...settledSignedOut,
				focused: false,
			}),
		).toBeNull();
		expect(
			signedOutLanding({
				...settledSignedOut,
				restoredAccount: true,
				focused: false,
			}),
		).toBeNull();
	});

	it("keeps every existing stay case", () => {
		expect(
			signedOutLanding({ ...settledSignedOut, coldStartSettled: false }),
		).toBeNull();
		expect(signedOutLanding({ ...settledSignedOut, busy: true })).toBeNull();
		expect(signedOutLanding({ ...settledSignedOut, routed: true })).toBeNull();
		expect(
			signedOutLanding({ ...settledSignedOut, refusal: "revoked" }),
		).toBeNull();
		expect(
			signedOutLanding({ ...settledSignedOut, savedTunnel: {} }),
		).toBeNull();
		expect(signedOutLanding({ ...settledSignedOut, phase: "live" })).toBeNull();
	});
});
