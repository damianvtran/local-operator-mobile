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
