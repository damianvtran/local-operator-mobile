/**
 * The mic's visibility rule.
 *
 * The three cases the design names explicitly: the block present and true, the
 * block present and false, and the block ABSENT — an older relay, where absence
 * must read as unavailable rather than raising or rendering a control that cannot
 * work. Plus the build half: a platform that cannot record hides the mic even when
 * the relay says it could.
 */

import { describe, expect, it } from "vitest";

import type { Capabilities } from "@/contracts";
import {
	micVisible,
	STT_UNAVAILABLE,
	sttAvailable,
	sttCapability,
} from "@/stt/capability";

describe("stt capability gate", () => {
	it("reads an ABSENT block as unavailable, never as an error", () => {
		expect(sttCapability(undefined)).toEqual(STT_UNAVAILABLE);
		expect(sttCapability(null)).toEqual(STT_UNAVAILABLE);
		/* The list store's initial snapshot is a bare `{}` before any frame. */
		expect(sttCapability({} as Capabilities)).toEqual(STT_UNAVAILABLE);
		expect(sttAvailable({} as Capabilities)).toBe(false);
	});

	it("honours an explicit available: false", () => {
		const capabilities: Capabilities = {
			stt: { available: false, path: null, reason: "no backend" },
		};
		expect(sttAvailable(capabilities)).toBe(false);
	});

	it("reports available: true when the relay says so", () => {
		const capabilities: Capabilities = {
			stt: { available: true, path: "provider_stt_radient" },
		};
		expect(sttAvailable(capabilities)).toBe(true);
		expect(sttCapability(capabilities).path).toBe("provider_stt_radient");
	});

	it("hides the mic on a build that cannot record, even when the relay can", () => {
		const capabilities: Capabilities = {
			stt: { available: true, path: "provider_stt_radient" },
		};
		expect(micVisible(capabilities, true)).toBe(true);
		/* The web target and this Node test host: the audio module is absent. */
		expect(micVisible(capabilities, false)).toBe(false);
	});

	it("hides the mic when the relay is unavailable whatever the build can do", () => {
		expect(micVisible({}, true)).toBe(false);
	});
});
