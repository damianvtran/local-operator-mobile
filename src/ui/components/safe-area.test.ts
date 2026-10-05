import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every overlay surface spends the device's side insets itself.
 *
 * The three surfaces in this file are the app's PORTAL surfaces: a react-native
 * `Modal` renders through its own root (on the web, react-native-web appends it
 * to `document.body`) and `ToastHost` is mounted at the app root, above the
 * router — so none of them is inside a `Screen`, and the `paddingLeft`/
 * `paddingRight` a `Screen` applies to itself reaches none of them. A surface
 * that does not read the insets is therefore full-bleed INTO the band, and the
 * defect is invisible to the `ci` capture tier, whose only phone declares zero
 * side insets.
 *
 * Measured at `iphone-15-landscape` (insets 59/59, resolved by the capture rig)
 * before this was fixed:
 *
 *   * `Sheet`    — the surface is full width, so the title painted at x = 17 and
 *                  the close control's right edge reached x = 828 of 844.
 *   * `Dialog`   — the surface spans x = 24…820, so the title painted at x = 41
 *                  and the confirm action reached x = 800.
 *   * `ToastHost`— the pill spanned x = 16…828, its label starting at x = 48.
 *
 * Asserted over the SOURCE because there is no render seam to read: each module
 * reaches `uniwind` (through `@/ui/appearance`) or `react-native-safe-area-context`,
 * neither of which the Node test environment can render (the same constraint that
 * puts `Segmented`'s sibling coverage in `variants.test.ts`). The anchor is each
 * surface's own element, so a rename keeps passing while a REMOVED inset — the
 * failure this exists for — fails by name.
 */
const read = (file: string): string =>
	readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");

/** The style object of the element anchored by `anchor`, up to the next element. */
const styleAfter = (source: string, anchor: string): string => {
	const at = source.indexOf(anchor);
	expect(
		at,
		`the anchor \`${anchor}\` must still be in the file`,
	).toBeGreaterThan(-1);
	return source.slice(at, at + 1200);
};

const SURFACES = [
	{
		file: "sheet.tsx",
		anchor: "className={SHEET_SURFACE_CLASS}",
		why: "the sheet surface is full-bleed, so its title and close control sit in the side band",
		terms: ["paddingLeft: insets.left", "paddingRight: insets.right"],
	},
	{
		file: "dialog.tsx",
		anchor: "className={DIALOG_SURFACE_CLASS}",
		why: "a wide dialog surface reaches both side bands, taking its title and its actions with it",
		terms: ["marginLeft: insets.left", "marginRight: insets.right"],
	},
	{
		file: "toast.tsx",
		anchor: "absolute inset-x-4 bottom-4 items-center",
		why: "the host is mounted at the app root, outside every Screen, so no screen padding reaches it",
		terms: [
			"paddingLeft: insets.left",
			"paddingRight: insets.right",
			"paddingBottom: insets.bottom",
		],
	},
] as const;

describe("overlay surfaces spend the side insets", () => {
	for (const surface of SURFACES) {
		it(`${surface.file} insets its own surface — ${surface.why}`, () => {
			const source = read(surface.file);
			expect(
				source.includes("useSafeAreaInsets"),
				`${surface.file} must read the insets it applies`,
			).toBe(true);
			const style = styleAfter(source, surface.anchor);
			for (const term of surface.terms) {
				expect(
					style.includes(term),
					`${surface.file} must apply \`${term}\``,
				).toBe(true);
			}
		});
	}
});
