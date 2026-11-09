/**
 * The mic's visibility rule.
 *
 * The three cases the design names explicitly: the block present and true, the
 * block present and false, and the block ABSENT — an older relay, where absence
 * must read as unavailable rather than raising or rendering a control that cannot
 * work. Plus the build half: a platform that cannot record hides the mic even when
 * the relay says it could.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Capabilities } from "@/contracts";

import {
	micSetupNeeded,
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

/* TestFlight 578, item 9: "I see no microphone button". A computer with no
 * persisted STT credential advertises `available: false`, and the mic used to
 * vanish with no reason given. It now renders in a SET-UP state instead. */
describe("the set-up mic", () => {
	const unavailable: Capabilities = {
		stt: { available: false, path: null, reason: "no backend" },
	};
	const available: Capabilities = {
		stt: { available: true, path: "provider_stt_radient" },
	};

	it("shows when the computer answered 'no STT here' and this build can record", () => {
		expect(micSetupNeeded(unavailable, true)).toBe(true);
		expect(micVisible(unavailable, true)).toBe(false);
	});

	it("never shows beside a working mic", () => {
		expect(micSetupNeeded(available, true)).toBe(false);
		expect(micVisible(available, true)).toBe(true);
	});

	it("waits for an answer: no set-up mic before the first frame (no cold-start flash)", () => {
		expect(micSetupNeeded(undefined, true)).toBe(false);
		expect(micSetupNeeded(null, true)).toBe(false);
		expect(micSetupNeeded({} as Capabilities, true)).toBe(false);
	});

	it("stays hidden on a build that cannot record (the web target)", () => {
		expect(micSetupNeeded(unavailable, false)).toBe(false);
	});
});

/* "Home mic visible when the capability is present": the home renders no box in
 * Node, so this guards the wiring that makes it true — the home composer gets the
 * same dictation state (same capability gate) the session composer gets. */
describe("the home composer has a mic", () => {
	const HOME = readFileSync(
		new URL("../../features/home/home.tsx", import.meta.url),
		"utf8",
	);
	const tag = HOME.slice(HOME.indexOf("<Composer\n"));

	it("feeds the list's capabilities to the dictation hook and passes it to the composer", () => {
		expect(HOME).toMatch(/useHomeDictation\(\{[^}]*\bcapabilities,/s);
		expect(tag.slice(0, tag.indexOf("/>"))).toContain("voice={voice}");
	});

	it("drops a live take when the home sends (the session composer's rule)", () => {
		expect(tag).toMatch(/onSend=\{\(\) => \{[^}]*voice\.cancelForSend\(\);/s);
	});
});
