import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CONTROL, EMPTY, isKnownIdentifier, SCREEN } from "@/ui/a11y";

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
const TESTID_LITERAL = /\btestID=(?:"[^"]*"|\{\s*[`"'])/;
const YAML_FILE = /\.ya?ml$/;
const TSX_FILE = /\.tsx$/;
const ID_LINE = /^\s*(?:-\s*)?id:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/;

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
	const sources = [
		...walk(join(root, "app")),
		...walk(join(root, "src/ui")),
		/* `src/features/**` too: the screens a route renders live there, so a
		 *  scan of `app/**` alone would report every identifier as unused the
		 *  moment a route became a thin wrapper — which is what the wave-2
		 *  restructure did (measured: 63 "unreferenced" ids, all of them used). */
		...walk(join(root, "src/features")),
	]
		.filter((f) => TSX_FILE.test(f))
		.map((file) => ({
			file: file.slice(root.length),
			text: readFileSync(file, "utf8"),
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
		const unused = Object.entries({ SCREEN, EMPTY, CONTROL }).flatMap(
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
