import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * M3 S2b-2a keyed the refusal surface: its HEADLINE and NEXT maps are arrow
 * bodies (`(subject) => t("…", { subject })`), and the string scanner reads
 * neither the arrows nor the keys inside them. A misspelt key there would type-
 * check only once `catalogue.gen.ts` is regenerated, and until then — or in a
 * locale that lacks it — `t()` would render the bare key on the screen a reader
 * sees when nothing works. So this reads the SOURCE and asserts that every key
 * the component (and `refusal.ts`, which composes the remedy line it shows)
 * renders exists in the English catalogue, the source of every locale.
 *
 * Source-level on purpose: rendering each kind would need the native kit mocked
 * and would still only prove the kinds a test thought to render.
 */
const read = (path: string): string =>
	readFileSync(new URL(path, import.meta.url), "utf8");

const englishKeys = (): Set<string> => {
	const directory = new URL("../../i18n/catalogues/en/", import.meta.url);
	const keys = new Set<string>();
	for (const file of readdirSync(directory)) {
		if (!file.endsWith(".json") || file.endsWith(".context.json")) continue;
		for (const key of Object.keys(
			JSON.parse(read(`../../i18n/catalogues/en/${file}`)) as object,
		)) {
			keys.add(key);
		}
	}
	return keys;
};

/** Every literal first argument of a `t(` call, across line breaks. */
const T_CALL_KEY = /\bt\(\s*"([^"]+)"/g;

const keysIn = (source: string): string[] =>
	[...source.matchAll(T_CALL_KEY)].map((match) => match[1] ?? "");

describe("the refusal surface's catalogue keys", () => {
	const english = englishKeys();
	const surface = read("./refusal-surface.tsx");

	it("renders only keys the English catalogue defines", () => {
		const keys = [
			...keysIn(surface),
			...keysIn(read("../../features/auth/refusal.ts")),
		];
		// Guards the regex itself: a pattern that matched nothing would pass vacuously.
		expect(keys.length).toBeGreaterThanOrEqual(24);
		expect(keys.filter((key) => !english.has(key))).toEqual([]);
	});

	it("keys a headline and a next line for every refusal kind it maps", () => {
		/* Each map entry is `"kind": (…) => t("key"…)`; the keyed kinds (all but the
		 *  ones reusing account/session keys) must have both lines in the catalogue. */
		for (const map of ["HEADLINE", "NEXT"] as const) {
			const body = surface.split(`const ${map}:`)[1]?.split("\n};")[0] ?? "";
			expect(body.length).toBeGreaterThan(0);
			const keys = keysIn(body);
			// 11 kinds; the scheme comment does not add a call.
			expect(keys).toHaveLength(11);
			expect(keys.filter((key) => !english.has(key))).toEqual([]);
		}
	});
});

describe("the refusal surface's composed lines", () => {
	const surface = read("./refusal-surface.tsx");
	/** The opening tag of the `Text` that renders `anchor`. */
	const textOpeningBefore = (anchor: string): string => {
		const at = surface.indexOf(anchor);
		expect(at, `anchor ${anchor}`).toBeGreaterThan(-1);
		return surface.slice(surface.lastIndexOf("<Text", at), at);
	};

	it("headline and next line state the page's base, like the detail line (#257 design D2)", () => {
		/* Six English titles open with `{subject}`, a Latin token; without the
		 * spread a translation keeping that order resolves an LTR base. */
		expect(surface).toContain("const composedDir = useComposedDir();");
		for (const anchor of [
			"{HEADLINE[kind](subject)}",
			"{NEXT[kind]()}",
			"{detail}\n",
		]) {
			expect(textOpeningBefore(anchor)).toContain("{...composedDir}");
		}
	});
});

describe("the diagnostic fallback token (#257 review N2)", () => {
	it("is defined once and imported by both the surface and the feature", () => {
		const literal = '"RelayError · connection-response"';
		const feature = read("../../features/auth/refusal.ts");
		const surface = read("./refusal-surface.tsx");
		expect(read("./diagnostic-fallback.ts")).toContain(
			`export const DIAGNOSTIC_FALLBACK = ${literal};`,
		);
		for (const source of [feature, surface]) {
			expect(source).toContain(
				'import { DIAGNOSTIC_FALLBACK } from "@/ui/components/diagnostic-fallback";',
			);
			/* Neither keeps a private copy of the token. */
			expect(source).not.toContain("connection-response");
		}
	});
});
