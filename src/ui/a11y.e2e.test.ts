import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CONTROL, EMPTY, isKnownIdentifier, SCREEN, SURFACE } from "@/ui/a11y";

/**
 * The identifier contract, checked from the outside in.
 *
 * `src/ui/a11y.ts` is the single source of truth for the names; the Maestro flows
 * (`e2e/maestro/**`) are YAML that must follow it, never the reverse. Two streams
 * once wrote two vocabularies with no overlap and every flow failed on its first
 * assertion, and nothing in the unit suite could notice, because each side was
 * internally consistent. This test reads the flows themselves.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const flowsDir = join(root, "e2e/maestro");

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});

/** `id: "x"` and `- id: x` selectors, quoted or not. Text selectors and regexes
 * are not identifiers and are deliberately not matched. */
/** `testID="x"` in JSX, and `testID: "x"` in a view object: both are a second
 * spelling of an identifier, and the second is how a projection module carries the
 * C1-C7 anchors. Quoted or template only — `testID={CONSTANT}`, `testID={testID}`
 * and the `testID: string` type annotation are all fine; text selectors and regexes
 * are deliberately not matched. */
const TESTID_LITERAL = /\btestID=(?:"[^"]*"|\{\s*[`"'])|\btestID:\s*[`"']/;
const YAML_FILE = /\.ya?ml$/;
/** Source that renders: `.tsx` AND `.ts`, because a projection module's view
 * objects carry identifiers too. */
const SOURCE_FILE = /\.[jt]sx?$/;
/** Tests are not source: one may quote a literal in prose, and this file does. */
const TEST_FILE = /\.test\.[jt]sx?$/;
const ID_LINE = /^\s*(?:-\s*)?id:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/;

/**
 * Source with comments removed, so "rendered" means rendered.
 *
 * Both halves of this check read TEXT, and a mention in prose is not a render: a
 * file carrying only `// SURFACE.sessionRail returns with the rail` satisfied the
 * reference check, and a comment quoting an identifier failed the literal check —
 * neither is what either half is about (review round 2, F2).
 *
 * Quote-aware on purpose. A naive `/\/\/.*$/` also truncates `https://…` inside a
 * string, which HIDES the real code after it on that line — the direction that
 * matters, because a literal this check fails to see is the defect it exists for.
 * The residual hole is narrower and recorded rather than hidden: a constant
 * mentioned inside a string still counts as referenced.
 */
const stripComments = (source: string): string => {
	let out = "";
	let quote: string | null = null;
	for (let i = 0; i < source.length; i += 1) {
		const ch = source[i] ?? "";
		const next = source[i + 1] ?? "";
		if (quote !== null) {
			out += ch;
			if (ch === "\\") {
				out += next;
				i += 1;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			out += ch;
			continue;
		}
		if (ch === "/" && next === "/") {
			while (i < source.length && source[i] !== "\n") i += 1;
			out += "\n";
			continue;
		}
		if (ch === "/" && next === "*") {
			i += 2;
			while (
				i < source.length &&
				!(source[i] === "*" && source[i + 1] === "/")
			) {
				i += 1;
			}
			i += 1;
			continue;
		}
		out += ch;
	}
	return out;
};

const referencedIds = (): Map<string, string[]> => {
	const byId = new Map<string, string[]>();
	for (const file of walk(flowsDir).filter((f) => YAML_FILE.test(f))) {
		for (const line of readFileSync(file, "utf8").split("\n")) {
			const id = ID_LINE.exec(line)?.[1];
			if (id === undefined) continue;
			byId.set(id, [...(byId.get(id) ?? []), file.slice(root.length)]);
		}
	}
	return byId;
};

describe("the Maestro flows against src/ui/a11y.ts", () => {
	// `e2e/` lands with the audit-harness stream. Until it is on this branch there
	// is nothing to read, and a fixture copy would only test the copy, so the check
	// arms itself the moment the directory exists instead of passing vacuously.
	it.skipIf(!existsSync(flowsDir))(
		"finds every id a flow references in the identifier set",
		() => {
			const referenced = referencedIds();
			expect(referenced.size).toBeGreaterThan(0);
			const unknown = [...referenced]
				.filter(([id]) => !isKnownIdentifier(id))
				.map(([id, files]) => `${id}  (${[...new Set(files)].join(", ")})`);
			expect(unknown, "ids in the flows that the app never renders").toEqual(
				[],
			);
		},
	);
});

describe("the routes and primitives against src/ui/a11y.ts", () => {
	/* The scan set is every tree that renders UI, and it is the whole point of the
	 * check: scoped to `app/**` + `src/ui/**` it could not see a single one of the
	 * session stream's screens, which live in `src/features/**` — measured on the
	 * rebased head, 49 selectors outside the contract with the old scope and 0
	 * after it was widened (a selector in a feature component is exactly as
	 * flow-visible as one in a route: Maestro reads the platform's accessibility
	 * tree, which does not care which directory rendered it). */
	const sources = [
		...walk(join(root, "app")),
		...walk(join(root, "src/ui")),
		...walk(join(root, "src/features")),
	]
		.filter((f) => SOURCE_FILE.test(f) && !TEST_FILE.test(f))
		.map((file) => ({
			file: file.slice(root.length),
			// Comments stripped ONCE, here, so both halves read the same source and
			// neither can be satisfied (or broken) by prose.
			text: stripComments(readFileSync(file, "utf8")),
		}));

	it("never types an identifier as a literal", () => {
		// A literal `testID="settings-theme"` is a second spelling waiting to
		// drift from the constant the flows are checked against. Spread and
		// caller-supplied values (`testID={testID}`) are fine; a string is not.
		const offenders = sources
			.filter(({ text }) => TESTID_LITERAL.test(text))
			.map(({ file }) => file);
		expect(offenders).toEqual([]);
	});

	it("references every declared identifier from at least one route or primitive", () => {
		// A declared-but-unrendered identifier is a selector no flow can ever hit,
		// and it would still satisfy the flow check above.
		const rendered = sources.map(({ text }) => text).join("\n");
		const unused = Object.entries({ SCREEN, EMPTY, CONTROL, SURFACE }).flatMap(
			([group, ids]) =>
				Object.keys(ids)
					.filter(
						(key) => !new RegExp(`\\b${group}\\.${key}\\b`).test(rendered),
					)
					.map((key) => `${group}.${key}`),
		);
		expect(unused).toEqual([]);
	});
});
