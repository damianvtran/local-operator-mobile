import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `Segmented` must not spell an ink role at all — the ladder lives in the kit.
 *
 * This is the guard for the defect that produced this change. The component kept
 * a SECOND copy of the option-label ladder (the wrapper's came from
 * `segmentedItemClasses` in `src/ui/variants.ts`), and the copy had drifted to
 * `text-ink-disabled` for a disabled option while the kit said
 * `CONTROL_DISABLED_INK`. A react-native-web `Text` declares its own `color` and
 * does not inherit the wrapper's, so the component's copy WON — and every test
 * stayed green, because a test on the kit's helper can only ever read the kit's
 * helper.
 *
 * The rule this pins is therefore stronger than "the disabled branch says
 * `ink-dim`": it is that there is exactly ONE ladder, and the component renders
 * it rather than restating it. A second copy that agrees today is one edit away
 * from disagreeing tomorrow, and it is the winning copy either way.
 *
 * Asserted over the SOURCE, because the coupling has no runtime seam a render
 * test can read: react-native-web drops `className` from the markup a static
 * render produces (the className transform runs at build time, not under vitest),
 * so nothing in the Node environment can see which utility the label was given.
 * The audit frame is the other half of that: U-02 reads the rendered colour, and
 * this file is what stops the colour coming from a second ladder.
 */
const SOURCE = readFileSync(
	fileURLToPath(new URL("./segmented.tsx", import.meta.url)),
	"utf8",
);

/**
 * Type-scale utilities, which are sizes and not inks. Anything else that matches
 * `text-<name>` in this file is a colour role — the thing that must not be here.
 *
 * Kept as a prefix list rather than a regex alternation so a NEW type step fails
 * loudly (the guard would report it as an offending ink) instead of silently
 * widening the allowlist. `design/tokens/tailwind-preset.js` is the source of the
 * names — regenerate the list from it if a step is ever added.
 */
const TYPE_SCALES = [
	"body",
	"display",
	"heading",
	"label",
	"meta",
	"mono",
	"title",
];

const isTypeScale = (name: string): boolean =>
	TYPE_SCALES.some((scale) => name === scale || name.startsWith(`${scale}-`));

describe("segmented label ink", () => {
	it("renders the kit's ladder instead of restating it", () => {
		expect(SOURCE).toContain("segmentedLabelClasses(");
	});

	it("names no ink role of its own", () => {
		const offenders = (SOURCE.match(/text-[a-z0-9-]+/g) ?? [])
			.map((utility) => utility.slice("text-".length))
			.filter((name) => !isTypeScale(name));
		expect(
			offenders,
			"a second ink ladder in this file wins over the kit's — see segmentedLabelClasses",
		).toEqual([]);
	});

	it("does not reach for the kit's ink constant to rebuild the ladder", () => {
		/* The other shape a second copy takes: spelling the ladder out of the kit's
		 * own constant rather than a literal. It is still a copy, and it still wins. */
		expect(SOURCE).not.toContain("CONTROL_DISABLED_INK");
	});
});
