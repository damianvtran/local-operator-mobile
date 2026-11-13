import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * docs/i18n.md bans manual bidi control characters in catalogue values: an
 * invisible `U+202B` is unreviewable and breaks searching, and direction belongs
 * to layout. ONE recorded exception exists (programme manager ruling, M3 S2a):
 * in `ur`, four own-tunnel keys wrap the literal `http://` / `https://` scheme in
 * LRI…PDI (`U+2066`/`U+2069`). Without the isolate CoreText's RTL paragraph
 * reorders the token to `//:http` (ur round-2 audit), and mobile `src/i18n` has
 * no whole-string isolate wrap that could fix it at the layout layer instead.
 *
 * This file is the enforcement the doc points at: it keeps the exception from
 * spreading. Any bidi control in any `ur` value outside the four keys fails, and
 * inside them the only permitted controls are an LRI immediately before
 * `http://` / `https://` and a PDI immediately after it. Scope is `ur` only, as
 * ruled; the mutated-copy cases below are permanent negative controls proving
 * the checker would see a violation. `own_tunnel.insecure_hint` names `http` too
 * but is deliberately NOT a fifth key: its bare `http` has no `://` to reorder, so
 * a copy change that gives it `http://` must add it here (with its isolate).
 */

/** LRM, RLM, LRE/RLE/PDF/LRO/RLO, LRI/RLI/FSI/PDI, ALM. */
const BIDI_CONTROL = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/u;

/** The four keys the exception covers; everything else stays control-free. */
const SCHEME_ISOLATE_KEYS = new Set([
	"mobile.computers.own_tunnel.insecure_allow",
	"mobile.computers.own_tunnel.insecure_allowed",
	"mobile.computers.own_tunnel.insecure_off_help",
	"mobile.computers.own_tunnel.unencrypted_body",
]);

/** The exact permitted wrap: LRI, the scheme, PDI. */
const SCHEME_ISOLATE = /\u2066https?:\/\/\u2069/gu;

type Catalogue = Record<string, string>;

/** Keys (with the offending value) that break the rule; empty means clean. */
const bidiViolations = (catalogue: Catalogue): string[] =>
	Object.entries(catalogue)
		.filter(([key, value]) => {
			const rest = SCHEME_ISOLATE_KEYS.has(key)
				? value.replace(SCHEME_ISOLATE, "")
				: value;
			return BIDI_CONTROL.test(rest);
		})
		.map(([key, value]) => `${key}: ${JSON.stringify(value)}`);

const UR_DIR = new URL("../catalogues/ur/", import.meta.url);

/** Every `ur` value file (the `.context.json` sidecars carry notes, not copy). */
const urCatalogue = (): Catalogue => {
	const merged: Catalogue = {};
	for (const file of readdirSync(UR_DIR)) {
		if (!file.endsWith(".json") || file.endsWith(".context.json")) continue;
		Object.assign(
			merged,
			JSON.parse(readFileSync(new URL(file, UR_DIR), "utf8")) as Catalogue,
		);
	}
	return merged;
};

describe("bidi controls in ur catalogue values (docs/i18n.md exception)", () => {
	const ur = urCatalogue();

	it("no ur value carries a bidi control outside the scheme-isolate exception", () => {
		expect(bidiViolations(ur)).toEqual([]);
	});

	it("the premise: each exception key really isolates its scheme (the exception is in use)", () => {
		for (const key of SCHEME_ISOLATE_KEYS) {
			expect(ur[key], key).toMatch(SCHEME_ISOLATE);
		}
	});

	it("negative control: a control in another ur value is caught", () => {
		const key = "mobile.computers.own_tunnel.password_for";
		expect(ur[key]).toBeDefined();
		expect(bidiViolations({ ...ur, [key]: `\u2066${ur[key]}\u2069` })).toEqual([
			`${key}: ${JSON.stringify(`\u2066${ur[key]}\u2069`)}`,
		]);
		expect(bidiViolations({ x: "\u200Fabc" })).toHaveLength(1);
		expect(bidiViolations({ x: "abc\u061C" })).toHaveLength(1);
	});

	it("negative control: inside an exception key, only LRI + scheme + PDI passes", () => {
		const key = "mobile.computers.own_tunnel.insecure_allow";
		const at = (value: string) => bidiViolations({ [key]: value });
		expect(at("a \u2066http://\u2069 b \u2066https://\u2069")).toEqual([]);
		// Wrapping more than the scheme.
		expect(at("a \u2066http://example\u2069 b")).toHaveLength(1);
		// A different isolate (FSI / RLI) or an embedding.
		expect(at("a \u2068http://\u2069 b")).toHaveLength(1);
		expect(at("a \u202Ahttp://\u202C b")).toHaveLength(1);
		// An unpaired LRI, or a stray mark elsewhere in the value.
		expect(at("a \u2066http:// b")).toHaveLength(1);
		expect(at("\u200Fa \u2066http://\u2069 b")).toHaveLength(1);
	});
});
