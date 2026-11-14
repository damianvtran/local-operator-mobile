import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { renderFor } from "@/i18n";

/**
 * Design review D2 (M2 expression literals): two keyed sentences START with a
 * Latin token in Urdu, so RN-web's `dir="auto"` gave them an LTR base on an RTL
 * page and they sat on the wrong edge, away from the same-card subtitle:
 *   - Settings account title  `Radient میں سائن ان نہیں ہے`
 *   - Add-a-computer result   `{name} سے منسلک ہو گیا۔`
 *
 * Node cannot import these screens' native styling stack, so — like the other
 * `*-wiring.test.ts` files — this pins the SOURCE: the title `Text` and the
 * subtitle `Text` of the same card must both spread `useComposedDir()`. The
 * mechanism's rendered behaviour (rtl → `dir="rtl"`, ltr → nothing) is covered
 * by `src/ui/direction.test.ts`; real-path QA owns the rendered frame.
 */
/** The first strong character `dir="auto"` resolves the base from. */
const STARTS_LATIN = /^[A-Za-z]/;

const read = (relative: string): string =>
	readFileSync(new URL(relative, import.meta.url), "utf8");

/** The element that opens just before `anchor`: back to the nearest `<Text`. */
const textOpeningBefore = (source: string, anchor: string): string => {
	const at = source.indexOf(anchor);
	expect(at, `anchor ${anchor} is in the source`).toBeGreaterThan(-1);
	const open = source.lastIndexOf("<Text", at);
	return source.slice(open, at);
};

describe("sentences that start with a Latin token state the page's base", () => {
	it("the Urdu strings really start with a Latin character (the premise)", () => {
		const title = renderFor("mobile.settings.account.not_signed_in", {}, "ur");
		const connected = renderFor(
			"mobile.computers.added.connected_to",
			{ name: "New Mini" },
			"ur",
		);
		expect(title).toMatch(STARTS_LATIN);
		expect(connected).toMatch(STARTS_LATIN);
	});

	it("Settings: the account title and its subtitle both spread useComposedDir()", () => {
		const source = read("../../features/settings/settings.tsx");
		expect(source).toContain("const composedDir = useComposedDir();");
		expect(
			textOpeningBefore(source, "{settingsAccountTitle(accountLabel)}"),
		).toContain("{...composedDir}");
		expect(textOpeningBefore(source, "{route\n")).toContain("{...composedDir}");
	});

	it("Add a computer: the connected sentence and its subtitle both spread useComposedDir()", () => {
		const source = read("../../features/auth/computers.tsx");
		expect(source).toContain("const composedDir = useComposedDir();");
		expect(
			textOpeningBefore(source, '{t("mobile.computers.added.connected_to"'),
		).toContain("{...composedDir}");
		expect(
			textOpeningBefore(source, '{t("mobile.computers.added.stays_listed")}'),
		).toContain("{...composedDir}");
	});
});
