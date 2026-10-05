import { describe, expect, it } from "vitest";

import { isSendKey } from "@/features/session/keyboard";

/**
 * The composer's keyboard rule, as transitions rather than as prose.
 *
 * The mechanism lives in a component the test runner cannot load, so the part
 * that decides — and the part a later edit is most likely to invert — is a pure
 * predicate, and these are the four ways it has to be exactly right. Each case is
 * named for the failure it prevents rather than for the branch it covers.
 */

const fromField = { fromField: true };

describe("which keydown sends the draft", () => {
	it("sends on Enter from the message field", () => {
		expect(isSendKey({ key: "Enter", shiftKey: false, ...fromField })).toBe(
			true,
		);
	});

	it("inserts a newline on Shift+Enter — the only way to type one on a hardware keyboard", () => {
		expect(isSendKey({ key: "Enter", shiftKey: true, ...fromField })).toBe(
			false,
		);
	});

	it("sends nothing while an IME is composing: Enter there commits a candidate", () => {
		expect(
			isSendKey({
				key: "Enter",
				shiftKey: false,
				isComposing: true,
				...fromField,
			}),
		).toBe(false);
	});

	it("sends nothing when the key came from another field in the subtree", () => {
		// The slash sheet's filter renders inside the composer, so Enter while
		// filtering must not fire the command the reader has not chosen yet.
		expect(isSendKey({ key: "Enter", shiftKey: false, fromField: false })).toBe(
			false,
		);
	});

	it("ignores every other key", () => {
		for (const key of ["a", "Escape", "Tab", "NumpadEnter"]) {
			expect(isSendKey({ key, shiftKey: false, ...fromField }), key).toBe(
				false,
			);
		}
	});

	it("never claims Space, and so cannot be the mic's start-lag conflict", () => {
		/* The STT UX round reported a start lag and suspected the space key was being
		 * swallowed by the composer's own keydown listener. It is not, and this pins
		 * it: the listener claims Enter alone, so a Space in the field is an ordinary
		 * space and a Space on a focused control is the platform's own activation —
		 * neither reaches the send path. The measured cause of the lag was elsewhere
		 * (see `stt/dictation-machine.ts`'s `starting` phase); this case exists so the
		 * suspicion cannot be quietly re-raised against a future edit. */
		expect(isSendKey({ key: " ", shiftKey: false, ...fromField })).toBe(false);
		expect(isSendKey({ key: "Spacebar", shiftKey: false, ...fromField })).toBe(
			false,
		);
	});
});
