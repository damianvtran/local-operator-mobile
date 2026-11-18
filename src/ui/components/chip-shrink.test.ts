import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* U-08 regression guard: at 320 pt with large text (the audit's own 200 % cell),
 * the composer's model chip painted over the stop and send buttons. Measured in
 * the real export through the capture harness:
 *
 *   before — chip 205.2 px wide (72..277.2), stop 200..248: 48 × 41.4 overlap
 *            (86 % of the smaller box), send 252..300: 25.2 × 41.4 (45 %)
 *   after  — chip 124 px (72..196), both siblings untouched, overlaps: []
 *
 * The cap has to sit on the Pressable — the flex item — because `max-width:
 * 100%` inside it resolves against the button's own shrink-to-fit box (100 % of
 * 205 px is 205 px, which fixed nothing on the first attempt). This test pins
 * that placement, because the property is invisible in a unit assertion and the
 * browser is the only other place it shows up.
 *
 * There is no React renderer in this repository's toolchain, so the component's
 * output is read from source exactly as the other structure tests do. */

const root = resolve(import.meta.dirname, "../../..");
const chip = readFileSync(resolve(root, "src/ui/components/chip.tsx"), "utf8");
const composer = readFileSync(
	resolve(root, "src/features/session/components/composer.tsx"),
	"utf8",
);

describe("a shrinkable chip is capped on its own flex item", () => {
	it("caps the Pressable, not only the box inside it", () => {
		expect(chip).toContain('style={shrink ? { maxWidth: "100%" } : undefined}');
	});

	it("lets the label truncate and clips anything left over", () => {
		expect(chip).toContain("min-w-0 max-w-full overflow-hidden");
		expect(chip).toContain("numberOfLines={shrink ? 1 : undefined}");
	});

	it("is no longer a mode the composer needs: its controls are rigid icons", () => {
		/* The folder, model and effort chips were this mode's last users on the
		 *  composer row: two min-floored shrinkers that RN 0.86's Yoga clipped to
		 *  `loc` / `Claude` with no ellipsis on iOS (yoga#2006; issue #325). They
		 *  are now fixed touch-floor `IconButton`s that cannot paint over the send
		 *  cluster, so the U-08 overlap this file guards has no chip left to come
		 *  from there; the cap above stays for any chip in a narrow toolbar. */
		expect(composer.match(/\n\s+shrink\n/g) ?? []).toHaveLength(0);
		expect(composer).not.toContain("<Chip");
	});
});
