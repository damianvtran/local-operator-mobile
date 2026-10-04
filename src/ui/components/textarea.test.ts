import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The field's placeholder and the copy that measures it must not disagree.
 *
 * `Textarea` renders the placeholder a second time inside a zero-height, clipped,
 * `aria-hidden` wrapper, to learn how tall the WRAPPED placeholder is. That copy is
 * the only placeholder-shaped *text node* in the frame — the field's own
 * placeholder is a `::placeholder` pseudo-element — so the frame audit's U-02
 * contrast row for a placeholder measures the COPY. If the two renderings were ever
 * given different inks, the audit would keep reporting the copy's ink while the
 * reader looked at another one. That is not hypothetical: the copy inherited the
 * platform default, black, and measured 1.29:1 on the dark canvas while the
 * placeholder itself measured 7.85:1.
 *
 * Asserted over the SOURCE, because the coupling has no runtime seam a render test
 * could read: `placeholderTextColor` reaches react-native-web as a generated
 * pseudo-element rule, so its value is not in the markup a static render produces.
 * The assertion is deliberately name-following (it reads the binding out of the
 * `placeholderTextColor` usage) so a rename keeps passing while a divergence fails.
 */
const SOURCE = readFileSync(
	fileURLToPath(new URL("./textarea.tsx", import.meta.url)),
	"utf8",
);

/** The binding the field hands to `placeholderTextColor`. */
const fieldInk = (): string => {
	const match = SOURCE.match(/placeholderTextColor=\{(\w+)\}/);
	expect(match, "Textarea must pass placeholderTextColor").not.toBeNull();
	return match?.[1] ?? "";
};

describe("textarea placeholder ink", () => {
	it("gives the field and its measuring copy one ink", () => {
		const binding = fieldInk();
		expect(binding).not.toBe("");
		/* The same binding, applied as a VALUE: an ink utility class here would
		 * resolve through the theme layer instead of the field's own token, which is
		 * the divergence this exists to catch. */
		expect(SOURCE).toContain(`style={{ color: ${binding} }}`);
	});

	it("leaves the measuring copy no ink class of its own", () => {
		const standIn = SOURCE.match(
			/<Text\s+className="([^"]*)"\s+style=\{\{ color: \w+ \}\}/,
		);
		expect(
			standIn,
			"the measuring copy must take the field's ink",
		).not.toBeNull();
		/* `text-body` is the type scale the copy has to match, and the mono/label
		 * scales are sizes too. A `text-<colour role>` utility (text-ink,
		 * text-ink-dim, …) would be a second ink, free to disagree with the field's. */
		const inkClasses = (standIn?.[1] ?? "")
			.split(/\s+/)
			.filter((name) => /^text-(?!body|meta|label|mono)/.test(name));
		expect(inkClasses).toEqual([]);
	});
});
