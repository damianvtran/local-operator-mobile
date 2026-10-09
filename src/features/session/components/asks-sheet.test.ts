import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The `Other` door's WIRING in the asks sheet.
 *
 * The door's semantics live in `asks.ts` as pure functions with their own tests
 * (`asks.test.ts`): where it stands (every non-secret option question, never a
 * free-text-only or secret one), what an `Other` answer does on a single- vs a
 * multi-select question, and that an empty one is not an answer. This file pins
 * the half no pure test can see — that the sheet RENDERS the door through those
 * functions rather than through a second, private copy of the rules that could
 * drift from them. The door is deliberate (design §5.0; the operator
 * requirement of 2026-10-05 that every question accepts free text), and this is
 * what stops it silently unhooking.
 *
 * Asserted over the SOURCE, because the module reaches `uniwind` through
 * `@/ui/components/sheet`, which the Node test environment cannot import — the
 * same constraint that puts `model-sheet.test.ts` and `segmented.test.ts` on
 * the source. Reads are name-following rather than literal where the name is
 * the point (`door`, the field's element), so a rename keeps passing while a
 * divergence — the failure this exists for — fails by name.
 */
const SOURCE = readFileSync(
	fileURLToPath(new URL("./asks-sheet.tsx", import.meta.url)),
	"utf8",
);

/** The sheet's binding of `hasOtherDoor`'s result: `const <name> = hasOtherDoor(`. */
const DOOR_BINDING = /const (\w+) = hasOtherDoor\(/;

/** The door field's writer: `onChangeText={(text) => onOtherChange(`. */
const FIELD_WRITER = /onChangeText=\{\(\w+\) => onOtherChange\(/;

describe("the asks sheet's Other door", () => {
	it("gates the row on the tested predicate, not a private condition", () => {
		const bound = SOURCE.match(DOOR_BINDING)?.[1] ?? "";
		expect(bound, "the sheet must bind hasOtherDoor's result").not.toBe("");
		expect(SOURCE).toMatch(new RegExp(`\\{${bound} \\? \\(`));
	});

	it("gives the row and its input the declared identifiers", () => {
		/* The a11y contract's families (`ask-other-`) are the selectors the
		 * harness and the capture reach the door by; the renderer names them in
		 * the same change that renders them (the rule `src/ui/a11y.ts` states). */
		expect(SOURCE).toContain("askOtherId(");
		expect(SOURCE).toContain("askOtherFieldId(");
	});

	it("writes typed text into the door's own record — never the option cell", () => {
		const at = SOURCE.indexOf("askOtherFieldId(");
		expect(at, "the door must render its own TextInput").toBeGreaterThan(-1);
		const open = SOURCE.lastIndexOf("<TextInput", at);
		const close = SOURCE.indexOf("/>", at);
		const field = SOURCE.slice(open, close + 2);
		/* The field READS the record untrimmed and WRITES it whole: a value
		 * derived from the answer cell would lose the space between typed words
		 * and could read a label-equal text back as an option tick (the desktop
		 * card's named regressions, UI #892). */
		expect(field).toContain("value={other.text}");
		expect(field).toMatch(FIELD_WRITER);
	});

	it("wires the door's own press: untick on multi, re-select on single", () => {
		const at = SOURCE.indexOf("if (question.multi && other.open)");
		expect(
			at,
			"the press must distinguish the two select modes",
		).toBeGreaterThan(-1);
		const toggle = SOURCE.slice(at, at + 240);
		expect(toggle).toContain("open: false");
		expect(toggle).toContain("open: true");
	});

	it("closes the door when an option is pressed — the exclusion's card half", () => {
		const at = SOURCE.indexOf("onChange([option.label])");
		expect(at).toBeGreaterThan(-1);
		const press = SOURCE.slice(at, at + 420);
		expect(press).toContain("onOtherChange({ ...other, open: false })");
	});

	it("submits and gates through the shared composition rules", () => {
		/* `askResponseBody` builds the whole-ask body; `questionIsAnswered` is
		 * the Answer button's gate. Both read `asks.ts`'s ONE composition — a
		 * sheet that inlined either would be the second copy this pins out. */
		expect(SOURCE).toContain("askResponseBody(");
		expect(SOURCE).toContain("questionIsAnswered(");
	});
});
