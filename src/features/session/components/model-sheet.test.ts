import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The model row's ink must follow the row's `disabled` state, and it must be the
 * kit's disabled-label ink.
 *
 * Both halves are load-bearing, and they are the two ways this row went wrong.
 *
 *  1. The ink and the `disabled` prop must be driven by the SAME predicate. This
 *     row wears `ink-disabled` only while it is genuinely inactive, so the state
 *     and the ink can silently drift apart: an ink switched by hand to a second
 *     condition paints an exempt, near-invisible role on a row a thumb CAN press,
 *     which is a conformance failure rather than a policy one. Review round 1 on
 *     #29 read the line as exactly that, and only the shared predicate refutes it.
 *  2. A disabled label takes `CONTROL_DISABLED_INK` (`ink-dim`), never the
 *     palette's exempt `ink-disabled`: a label NAMES the model, and the exempt ink
 *     measures 2.96:1 light / 1.99:1 dark against the sheet's own `elevated`
 *     surface (`ink-dim`: 6.14 / 5.25). SC 1.4.3 exempts an inactive control's
 *     text, so the exemption is real — it is the ROLE that was wrong, which is why
 *     the fix is a colour and the framing is not "a11y violation".
 *
 * Asserted over the SOURCE, because there is no render seam to read: the module
 * reaches `uniwind` through `@/ui/appearance`, which the Node test environment
 * cannot import (the same constraint that puts `Segmented`'s sibling coverage in
 * `variants.test.ts`). The predicate is read out of the JSX rather than hardcoded,
 * so a rename keeps passing while a divergence — the failure this exists for —
 * fails by name.
 */
const SOURCE = readFileSync(
	fileURLToPath(new URL("./model-sheet.tsx", import.meta.url)),
	"utf8",
);

/**
 * The model option row, as its own `<Pressable>` block.
 *
 * Scoped to the row rather than to the file, because the file also renders the
 * effort sheet, and a file-wide `disabled={<word>}` read would silently follow a
 * rename of the wrong control's predicate. The anchor is the model option's own
 * test id, so the guard reads the row whose label ink it is actually about.
 */
const modelRow = (): string => {
	const match = SOURCE.match(
		/<Pressable[\s\S]*?modelOptionId\(model\.model_id\)[\s\S]*?<\/Pressable>/,
	);
	expect(match, "the model option row must render a Pressable").not.toBeNull();
	return match?.[0] ?? "";
};

/** The predicate the model row hands to its own `Pressable`'s `disabled`. */
const disabledPredicate = (): string => {
	const match = modelRow().match(/disabled=\{(\w+)\}/);
	expect(
		match,
		"the model row must pass a `disabled` predicate",
	).not.toBeNull();
	return match?.[1] ?? "";
};

describe("model sheet disconnected row", () => {
	it("drives the row's label ink from the row's own disabled predicate", () => {
		const predicate = disabledPredicate();
		expect(predicate).not.toBe("");
		/* One predicate, two uses — the ink and the press gate cannot disagree. */
		expect(modelRow()).toContain(
			`${predicate} ? CONTROL_DISABLED_INK : "text-ink"`,
		);
	});

	it("paints a disabled label with the kit's role, never the exempt ink", () => {
		/* The kit's constant, not a literal class: a literal here is the second
		 * spelling of a decision that already lives in `src/ui/variants.ts`. */
		expect(modelRow()).toContain("CONTROL_DISABLED_INK");
		const exempt = SOURCE.match(/text-ink-disabled/g) ?? [];
		expect(
			exempt,
			"the row's label must not borrow the exempt state ink",
		).toEqual([]);
	});
});
