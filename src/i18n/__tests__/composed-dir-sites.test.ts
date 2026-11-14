import { readdirSync, readFileSync } from "node:fs";
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
/** A `style` prop on a JSX element. */
const STYLE_PROP = /\bstyle=/;

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

	/* The account card moved out of settings.tsx into account-card.tsx (PR #258
	 *  review R1, B1); its title is now one `{title}` derived from
	 *  `radientSignedIn`, and both its values (ur "Radient میں…" and
	 *  "Radient کے ساتھ…") still start with the Latin product name. The visible
	 *  sign-in label ("Radient کے ساتھ سائن ان کریں") does too. */
	it("Settings: the account title, its subtitle and the sign-in label all spread useComposedDir()", () => {
		const source = read("../../features/settings/account-card.tsx");
		expect(source).toContain("const composedDir = useComposedDir();");
		expect(textOpeningBefore(source, "{title}")).toContain("{...composedDir}");
		expect(textOpeningBefore(source, "{route\n")).toContain("{...composedDir}");
		expect(textOpeningBefore(source, '{t("mobile.signin.start")}\n')).toContain(
			"{...composedDir}",
		);
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

describe("a composedDir spread never shares its element with a style prop", () => {
	/* #257 design round 1, D1: on native the helper's answer is a `style`
	 * (`writingDirection`), because iOS takes the paragraph base only from that
	 * style. A spread onto an element that also passes `style=` would either be
	 * clobbered by it (spread first: the Urdu base silently lost) or clobber it
	 * (spread last: the caller's styling lost). Every bare spread site must stay
	 * style-free; components that own a style (`Input`) take the value through a
	 * named prop and decide themselves. */
	const SRC = new URL("../../", import.meta.url);
	const SPREAD = "{...composedDir}";
	/** The JSX element around `at`: from its `<` to the first `>` that is not an
	 *  arrow's `=>`. */
	const elementAround = (source: string, at: number): string => {
		const open = source.lastIndexOf("<", at);
		let close = at;
		do {
			close = source.indexOf(">", close + 1);
		} while (close > 0 && source[close - 1] === "=");
		return source.slice(open, close);
	};

	it("holds for every spread site under src/", () => {
		const files = (
			readdirSync(SRC, { recursive: true, encoding: "utf8" }) as string[]
		).filter((f) => f.endsWith(".tsx"));
		let sites = 0;
		for (const file of files) {
			const source = readFileSync(new URL(file, SRC), "utf8");
			for (let at = source.indexOf(SPREAD); at >= 0; ) {
				sites += 1;
				expect(elementAround(source, at), `${file}`).not.toMatch(STYLE_PROP);
				at = source.indexOf(SPREAD, at + SPREAD.length);
			}
		}
		/* Not vacuous: the scan really found the spread sites. */
		expect(sites).toBeGreaterThan(10);
	});
});
