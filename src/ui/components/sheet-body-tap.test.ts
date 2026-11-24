/**
 * The ask sheet's body press layer must be INVISIBLE to the accessibility tree.
 *
 * WHY THIS EXISTS (QA r1 Q1, review r1 F3). `dismissKeyboardOnBodyTap` wraps the
 * body's children in a `Pressable`, and a Pressable is an accessibility element
 * by default — so the whole ask body was announced as ONE node and the `Other`
 * field left the tree entirely (`Element not found: Id matching regex:
 * ask-other-field-q1` in the rig, with `maestro hierarchy` showing a single
 * merged node). A reader using VoiceOver could not reach the field on its own,
 * and no automation could target it by id.
 *
 * Asserted over the SOURCE for the reason `asks-sheet.test.ts` states: the module
 * reaches `uniwind` through RN styles the Node environment cannot import. The
 * press layer is read by its own props rather than by line, so re-indenting the
 * body keeps this passing while DROPPING the opt-out — the regression — fails.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
	fileURLToPath(new URL("./sheet.tsx", import.meta.url)),
	"utf8",
);

/** The press layer's opening tag: from its own marker to the closing `>`. */
const pressLayer = (): string => {
	const at = SOURCE.indexOf("dismissKeyboardOnBodyTap ? (");
	expect(at, "the body press layer must exist").toBeGreaterThan(-1);
	const open = SOURCE.lastIndexOf("<Pressable", at);
	const close = SOURCE.indexOf(">", at);
	return SOURCE.slice(open, close);
};

describe("the body press layer", () => {
	it("is not an accessibility element, so its children stay individually reachable", () => {
		expect(pressLayer()).toContain("accessible={false}");
	});

	it("is left out of Android's tree too", () => {
		// `accessible` alone covers iOS; Android needs its own opt-out.
		expect(pressLayer()).toContain('importantForAccessibility="no"');
	});

	it("still dismisses the keyboard when pressed", () => {
		expect(pressLayer()).toContain("Keyboard.dismiss()");
	});
});
