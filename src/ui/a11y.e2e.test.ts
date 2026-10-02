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

/**
 * A step the app cannot serve yet, marked in the flow rather than deleted.
 *
 * The marked id is one the app does not render — the screen that would own it is
 * named so review can see the gap. This marker is why a flow can land before the
 * screen does without the suite going quiet about it: the test below requires the
 * marked id to be genuinely unknown, so the marker can never be used to hide a
 * rename or to smuggle a real identifier past the check above.
 *
 * The header of every flow documents this spelling; `<the-identifier>` there is
 * prose, not a marker, which is why the pattern requires a concrete name.
 */
const BLOCKED_LINE = /^\s*#\s*BLOCKED:\s*needs\s+(\S+)\s+from\s+(\S+)/;

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

/**
 * The markers a flow leaves where the app has no identifier yet.
 *
 * A marked id is a selector that cannot match today, so its value is that it is
 * *visible*: review reads the list, and the two assertions below keep it honest.
 */
/**
 * Whether a marker's `from <name>` names a screen this app declares.
 *
 * Both spellings are accepted because both read naturally in a comment: the
 * SCREEN key in kebab-case (`signIn` → `sign-in`) and the rendered value
 * (`sign-in-screen`). Anything else means the gap cannot be assigned to a screen,
 * which is the point of requiring the clause at all.
 */
const isScreenName = (name: string): boolean => {
	const keys = Object.keys(SCREEN);
	const kebab = (value: string): string =>
		value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
	return keys.some(
		(key) => kebab(key) === name || SCREEN[key as keyof typeof SCREEN] === name,
	);
};

const blockedMarkers = (): Array<{
	id: string;
	screen: string;
	file: string;
}> => {
	const out: Array<{ id: string; screen: string; file: string }> = [];
	for (const file of walk(flowsDir).filter((f) => YAML_FILE.test(f))) {
		for (const line of readFileSync(file, "utf8").split("\n")) {
			const match = BLOCKED_LINE.exec(line);
			if (match === null) continue;
			out.push({
				id: match[1] ?? "",
				screen: match[2] ?? "",
				file: file.slice(root.length),
			});
		}
	}
	return out;
};

describe("the blocked steps the flows declare", () => {
	it.skipIf(!existsSync(flowsDir))(
		"marks only identifiers the app genuinely does not render",
		() => {
			const markers = blockedMarkers();
			// A marker naming something the app DOES render is either a stale
			// comment or an attempt to skip a real check; both are failures.
			const hidable = markers
				.filter(
					({ id, screen }) => id.startsWith("<") || screen.startsWith("<"),
				)
				.map(
					({ id, file }) => `${id}  (${file}) — the marker needs a concrete id`,
				);
			expect(hidable).toEqual([]);
			const alreadyRendered = markers
				.filter(({ id }) => isKnownIdentifier(id))
				.map(
					({ id, file }) =>
						`${id}  (${file}) — the app renders this; uncomment the step`,
				);
			expect(alreadyRendered).toEqual([]);
			// The owning screen has to be named, or the gap cannot be assigned.
			const unnamed = markers
				.filter(({ screen }) => !isScreenName(screen))
				.map(({ id, screen, file }) => `${id} → '${screen}'  (${file})`);
			expect(unnamed).toEqual([]);
		},
	);
});

describe("the routes and primitives against src/ui/a11y.ts", () => {
	const sources = [...walk(join(root, "app")), ...walk(join(root, "src/ui"))]
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
