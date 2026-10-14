import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { checkCatalogues } from "./check.ts";
import { loadSources } from "./generate.ts";
import { checkHomeScope } from "./scope.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const homeSources = () => ({
	copy: readFileSync(join(root, "src/features/home/home-copy.ts"), "utf8"),
	splash: readFileSync(join(root, "src/features/home/home-splash.tsx"), "utf8"),
	home: readFileSync(join(root, "src/features/home/home.tsx"), "utf8"),
});

describe("six-slot Home guard (not a whole-repository extraction claim)", () => {
	it("accepts all six keyed production slots", () => {
		expect(() => checkHomeScope(homeSources())).not.toThrow();
	});

	for (const [file, before, after] of [
		["copy", '"mobile.home.greeting"', '"A wholly new literal greeting"'],
		["splash", "{t(GREETING)}", "A new hardcoded headline"],
		["splash", "{t(STARTING)}", '{"A new progress sentence"}'],
		["splash", "label={t(CONNECT_COMPUTER)}", 'label="Pair another machine"'],
		[
			"home",
			"connected ? null : t(CONNECT_DISABLED_REASON)",
			'connected ? null : "A novel disabled reason"',
		],
		[
			"home",
			"message={t(FOLDERS_READ_FAILED)}",
			'message="A new folders failure"',
		],
		["home", "t(REFUSED_START_FALLBACK)", '"A new start failure"'],
		["splash", "{t(GREETING)}", "{t(GREETING)} A new appended headline"],
		[
			"splash",
			"testID={SURFACE.homeGreeting}",
			'testID={SURFACE.homeGreeting} accessibilityLabel="A new spoken headline"',
		],
		["home", /problem\.text\s*\}/, "problem.text} Extra hardcoded body"],
		["home", "starting, t]", "starting]"],
	] as const) {
		it(`rejects a new literal or stale binding in ${file}: ${before}`, () => {
			const source = homeSources();
			if (typeof before === "string") expect(source[file]).toContain(before);
			else expect(source[file]).toMatch(before);
			source[file] = source[file].replace(before, after);
			expect(() => checkHomeScope(source)).toThrow(/six-slot scope/);
		});
	}

	it("leaves suggestions, tips and unrelated Home controls outside the enforced scope", () => {
		const source = homeSources();
		source.copy = source.copy.replace(
			"Turn on phone access",
			"Different model-facing suggestion",
		);
		source.home = source.home.replace(
			'label: "Retry"',
			'label: "Different unrelated action"',
		);
		expect(() => checkHomeScope(source)).not.toThrow();
	});
});

describe("FormatJS AST source/schema validation", () => {
	it("checks all enabled catalogue bytes", () => {
		expect(() => checkCatalogues(loadSources(root))).not.toThrow();
	});

	for (const text of [
		"Hello {undeclared}",
		"{count, plural, one {one} other {many}}",
		"{broken",
		"<b>Rich text is not in this text-only contract</b>",
	]) {
		it(`rejects malformed ICU, tags or undeclared arguments: ${text}`, () => {
			const input = loadSources(root);
			input.english["mobile.home.greeting"] = text;
			expect(() => checkCatalogues(input)).toThrow();
		});
	}

	it("rejects context-declared arguments absent from source", () => {
		const input = loadSources(root);
		const context = input.context["mobile.home.greeting"];
		expect(context).toBeDefined();
		if (!context) throw new Error("fixture lacks context");
		context.params = { count: "number" };
		context.placeholders = { count: "Number of jobs in this isolated fixture" };
		expect(() => checkCatalogues(input)).toThrow(/source\/context params/);
	});

	it("rejects an enabled translation whose parameter kind changes", () => {
		const input = loadSources(root);
		input.config.enabledLocales.push("fr");
		input.config.locales.fr = { direction: "ltr" };
		input.catalogues.fr = {
			"mobile.home": {
				...input.english,
				"mobile.home.greeting": "{count, number}",
			},
		};
		expect(() => checkCatalogues(input)).toThrow(/source\/context params/);
	});
});
