import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	CONTROL,
	EMPTY,
	IDENTIFIER_FAMILIES,
	isKnownIdentifier,
	REGION,
	SCREEN,
	STATE_MARKER,
	SURFACE,
} from "@/ui/a11y";

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

/**
 * Comments out of a source file before asking "is this identifier rendered".
 *
 * Without this the check is satisfied by a mention: proven on the last round's head,
 * where declaring an identifier and referring to it inside a `//` comment passed the
 * guard while nothing rendered it. A leading `*` also drops the JSDoc line, and block
 * comments are removed whole.
 *
 * Quote-aware on purpose (this branch's review round 2, F2). A naive `/\/\/.*$/` also
 * truncates `https://…` inside a string, which HIDES the real code after it on that
 * line — the direction that matters, because a literal this check fails to see is the
 * defect it exists for. The residual hole is narrower and recorded rather than hidden:
 * a constant mentioned inside a string still counts as referenced.
 */
const stripComments = (text: string): string => {
	let out = "";
	let quote: string | null = null;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i] ?? "";
		const next = text[i + 1] ?? "";
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
			while (i < text.length && text[i] !== "\n") i += 1;
			out += "\n";
			continue;
		}
		if (ch === "/" && next === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
				i += 1;
			}
			i += 1;
			continue;
		}
		out += ch;
	}
	return out
		.split("\n")
		.filter((line) => !/^\s*\*/.test(line))
		.join("\n");
};

/** `id: "x"` and `- id: x` selectors, quoted or not. Text selectors and regexes
 * are not identifiers and are deliberately not matched. */
const TESTID_LITERAL = /\btestID\s*[:=]\s*(?:"[^"]*"|\{\s*[`"']|["'`])/;

/**
 * An identifier SHAPED string: kebab-case with at least one segment break.
 *
 * A fallback like `?? "loading"` is copy, not a selector, and flagging it would
 * make this check something to work around rather than something to satisfy. Every
 * contract id has a dash, and each one that does not (`toast`) is a whole value
 * rather than a fallback.
 */
const IDENTIFIER_SHAPED = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/** A declaration's initializer: `const ID = <expr>;`, up to the statement's `;`. */
const HOISTED_LITERAL = (name: string): RegExp =>
	new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*([\\s\\S]*?);`);

/** A template is read up to its first `${`: a literal prefix with a dash is a
 * second spelling of a family, which is what the builders exist to avoid. */
const shapedLiteral = (raw: string): string | null => {
	const literal = raw.split("${")[0] ?? "";
	const candidate = literal.endsWith("-") ? literal.slice(0, -1) : literal;
	return IDENTIFIER_SHAPED.test(candidate) ? raw : null;
};

/**
 * Identifier-shaped strings inside a `testID={…}` EXPRESSION, including a hoisted
 * one a step away.
 *
 * `TESTID_LITERAL` reads a `testID` whose value is a literal, and cannot see
 * `testID={ok ? "one-id" : "another-id"}` — which is not hypothetical: the subagent
 * detail badge carried exactly that shape, so the fold moved the contract's
 * constant out from under a renderer (`subagentRunning`) and neither direction of
 * this file noticed (review round 5, M1). A check that cannot see one of the
 * contract's own renderers is the defect, not the instance.
 *
 * The braces are walked with the same quote awareness as `stripComments`. A bare
 * identifier is resolved through its DECLARATION, reading every literal in the
 * initializer rather than only a whole-value one: `const id = isApproval ?
 * "pending-card" : "ask-card"` is the same second spelling one refactor away from the
 * M1 shape, and it is what the two card ids were hiding behind (review round 6).
 */
const literalTestIds = (text: string): string[] => {
	const out: string[] = [];
	const needle = "testID";
	for (
		let i = text.indexOf(needle);
		i !== -1;
		i = text.indexOf(needle, i + 1)
	) {
		let j = i + needle.length;
		while ((text[j] ?? "") === " ") j += 1;
		if (text[j] !== "=") continue;
		j += 1;
		while ((text[j] ?? "") === " ") j += 1;
		if (text[j] !== "{") continue;
		const start = j + 1;
		let depth = 0;
		let quote: string | null = null;
		for (; j < text.length; j += 1) {
			const ch = text[j] ?? "";
			if (quote !== null) {
				if (ch === "\\") {
					j += 1;
					continue;
				}
				if (ch === quote) quote = null;
				continue;
			}
			if (ch === '"' || ch === "'" || ch === "`") {
				quote = ch;
				continue;
			}
			if (ch === "{") depth += 1;
			else if (ch === "}") {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		const body = text.slice(start, j);
		const bare = body.trim();
		if (/^[A-Za-z_$][\w$]*$/.test(bare)) {
			const initializer = HOISTED_LITERAL(bare).exec(text)?.[1] ?? "";
			for (const match of initializer.matchAll(/["`']([^"`']*)["`']/g)) {
				if (shapedLiteral(match[1] ?? "") !== null)
					out.push(`${bare} = ${match[0]}`);
			}
			continue;
		}
		for (const match of body.matchAll(/["`']([^"`']*)["`']/g)) {
			if (isMemberSubscript(body, match.index ?? 0)) continue;
			if (shapedLiteral(match[1] ?? "") !== null) out.push(match[0]);
		}
	}
	return out;
};

/**
 * Whether the string at `at` is a member SUBSCRIPT rather than a value.
 *
 * `STATE_MARKER.session["rich-rows"]` reads a key out of the contract, and the key is
 * a state name, not an id: flagging it would make the contract's own nested table
 * unreadable to this check. A quoted string is a value unless it sits directly after
 * `[` of an index expression (`ident[…]`), which is the subscript shape.
 */
const isMemberSubscript = (body: string, at: number): boolean => {
	let i = at - 1;
	while ((body[i] ?? "") === " ") i -= 1;
	if (body[i] !== "[") return false;
	i -= 1;
	while ((body[i] ?? "") === " ") i -= 1;
	return /[\w.$\])]/.test(body[i] ?? "");
};

const YAML_FILE = /\.ya?ml$/;
/* `.ts` as well as `.tsx`: the session view keeps its connection banner's copy and
 *  its identifier map in `.ts` modules, so a `.tsx`-only scan reported every one of
 *  its ids as unrendered (measured on the other stream's branch: 18 of them). */
const SOURCE_FILE = /\.tsx?$/;
/* Tests carry identifiers too — in fixtures, in mocked props — and an id that only a
 *  test spells is not a rendered control, which is the whole point of the check. */
const EXCLUDED_FILE = /\.(?:test|e2e\.test)\.tsx?$/;
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

/**
 * A step whose identifier IS in the contract, but whose renderer is not on this
 * branch — the session view's, whose screens land with their own stream.
 *
 * Deliberately a second spelling rather than a second reading of `BLOCKED`: the two
 * gaps have two different fixes (add the name to the contract, versus land the screen
 * that renders it), and one marker that means both is a marker that means nothing.
 * Checking it in the INVERSE direction is what keeps it from becoming a dumping
 * ground: a `PENDING` id must be known AND unrendered, so the commit that renders one
 * has to delete its marker.
 */
const PENDING_LINE = /^\s*#\s*PENDING:\s*(\S+)\s+from\s+(\S+)/;

/**
 * A step whose identifier the app renders, but whose STATE needs the relay pinned to
 * a scenario (`--scenario gateway-503-authorization_refused`).
 *
 * The third case, and the one a `BLOCKED` marker used to obscure: the refusal
 * surfaces are rendered by `src/ui/components/refusal-surface.tsx`, so a marker
 * claiming the id is missing would be false; what is missing is the relay state that
 * makes one of them appear. A `SCENARIO` id must be known AND rendered — the exact
 * inverse of `PENDING` — so neither can stand in for the other.
 */
const SCENARIO_LINE = /^\s*#\s*SCENARIO:\s*(\S+)\s+from\s+(\S+)/;

/**
 * `STATE_MARKER.subject.state` → id, flattened out of the NESTED table.
 *
 * The nesting is the harness's key (`(subject, state)`, because two screens can be in
 * a state of the same name) and the identifier check needs the flat triples, so the
 * one place that knows the table's shape is this parser — which reads the contract's
 * own source, so a renamed subject or state cannot leave the check looking at a name
 * that no longer exists.
 */
const STATE_MARKER_NAMES: ReadonlyArray<{
	name: string;
	subject: string;
	state: string;
	value: string;
}> = (() => {
	const source = readFileSync(join(root, "src/ui/a11y.ts"), "utf8");
	const block =
		/export const STATE_MARKER = \{([\s\S]*?)\n\} as const satisfies/.exec(
			source,
		)?.[1] ?? "";
	const out: Array<{
		name: string;
		subject: string;
		state: string;
		value: string;
	}> = [];
	for (const [, subject, body] of block.matchAll(
		/(\w+):\s*\{([\s\S]*?)\n\t\}/g,
	)) {
		for (const [, raw, value] of (body ?? "").matchAll(
			/(\w+|"[^"]+"):\s*"([^"]+)"/g,
		)) {
			const state = (raw ?? "").replace(/"/g, "");
			out.push({
				name: `STATE_MARKER.${subject}.${state}`,
				subject: subject ?? "",
				state,
				value: value ?? "",
			});
		}
	}
	return out;
})();

/**
 * Whether a rendering file NAMES this marker.
 *
 * Two spellings, because a state name with a dash in it is written as a subscript
 * (`STATE_MARKER.session["rich-rows"]`) and one without as a property
 * (`STATE_MARKER.session.idle`) — the check has to accept the spelling a render site
 * can actually use, or it pushes the next author into a second one.
 */
const namesMarker = (entry: { subject: string; state: string }): RegExp =>
	new RegExp(
		`\\bSTATE_MARKER\\.${entry.subject}\\.${entry.state}\\b|\\bSTATE_MARKER\\.${entry.subject}\\["${entry.state}"\\]`,
	);

/**
 * `GROUP.key` → value, read out of the contract's own source.
 *
 * The flows name id VALUES (`session-transcript`) while the code names CONSTANTS
 * (`SURFACE.sessionTranscript`), so answering "does anything render this" needs the
 * mapping between them. Parsing it here rather than importing a second hand-written
 * list means a renamed constant cannot leave this check looking at a stale name.
 */
const CONTRACT_NAMES: ReadonlyArray<{ name: string; value: string }> = (() => {
	const source = readFileSync(join(root, "src/ui/a11y.ts"), "utf8");
	const out: Array<{ name: string; value: string }> = [];
	for (const group of ["SCREEN", "EMPTY", "CONTROL", "SURFACE", "REGION"]) {
		const block =
			new RegExp(
				`export const ${group} = \\{([\\s\\S]*?)\\n\\} as const;`,
			).exec(source)?.[1] ?? "";
		for (const [, key, value] of block.matchAll(/(\w+):\s*"([^"]+)"/g)) {
			out.push({ name: `${group}.${key ?? ""}`, value: value ?? "" });
		}
	}
	out.push(...STATE_MARKER_NAMES);
	return out;
})();

/**
 * The files that can render an identifier: the routes and the primitives that
 * compose them. Tests are out (an id only a test spells is not a rendered control)
 * and so is the contract itself, which would otherwise count as its own renderer.
 */
const SOURCE_FILES = [
	...walk(join(root, "app")),
	...walk(join(root, "src/ui")),
	/* `src/features/**` too: the screens a route renders live there, so a
	 *  scan of `app/**` alone would report every identifier as unused the
	 *  moment a route became a thin wrapper — which is what the wave-2
	 *  restructure did (measured: 63 "unreferenced" ids, all of them used). */
	...walk(join(root, "src/features")),
]
	.filter((f) => SOURCE_FILE.test(f) && !EXCLUDED_FILE.test(f))
	.filter((f) => !f.endsWith(join("src", "ui", "a11y.ts")))
	.map((file) => ({
		file: file.slice(root.length),
		text: readFileSync(file, "utf8"),
	}))
	.map(({ file, text }) => ({ file, text, stripped: stripComments(text) }));

const RENDER_SOURCE = SOURCE_FILES.map(({ stripped }) => stripped).join("\n");

/**
 * The files that RENDER: a name mentioned in one of these is a name a component
 * paints, because the file carries a `testID` at all.
 *
 * Direction 2 below reads a mention as a render, which is the right reading for a
 * constant used as a prop and the wrong one for a marker returned as DATA —
 * `state-marker.ts` names every marker it can return, so counting it as a renderer
 * let all twelve markers pass while nothing painted one of them (review round 5).
 * A state marker is a claim about a frame, so it has to be named where the frame is
 * built.
 */
const RENDERING_SOURCE = SOURCE_FILES.filter(({ stripped }) =>
	/\btestID\b/.test(stripped),
)
	.map(({ stripped }) => stripped)
	.join("\n");

/** The static identifier VALUES some route or primitive names. */
const RENDERED_VALUES: ReadonlySet<string> = new Set(
	CONTRACT_NAMES.filter(({ name }) =>
		new RegExp(`\\b${name.replace(/\./g, "\\.")}\\b`).test(RENDER_SOURCE),
	).map(({ value }) => value),
);

/**
 * The parameterised prefixes that are declared and built by NOTHING yet.
 *
 * A family's renderedness cannot be inferred the way a static's can — the id is data
 * (`session-row-6714`), so no file spells it and the constant-names lookup above finds
 * nothing to match. The list is therefore explicit, asserted to be a subset of the
 * declared families, and it is EMPTY of the session view's ten: those arrived with the
 * branch that renders them, which is the condition this list's own note set for their
 * removal.
 */
const PENDING_FAMILIES: readonly string[] = [
	/* Declared as a family, built by nothing on any head yet. */
	"session-empty-",
];

/** Whether the app renders this identifier: a static whose constant a source names,
 *  or a family member the app builds. */
const isRenderedId = (id: string): boolean => {
	if (RENDERED_VALUES.has(id)) return true;
	const literal = id.split("${")[0] ?? id;
	const declared = IDENTIFIER_FAMILIES.some(
		(prefix) => literal.startsWith(prefix) && id.length > prefix.length,
	);
	return (
		declared && !PENDING_FAMILIES.some((prefix) => literal.startsWith(prefix))
	);
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

describe("the rendered check reads code, not prose", () => {
	it("drops a mention that lives in a comment", () => {
		/* The failure this closes, reproduced on the last head: a declared identifier
		 *  with no renderer passed the check as soon as a scanned file mentioned it in a
		 *  comment, which is precisely the "selector no flow can ever hit" the check
		 *  exists to catch. */
		const source = [
			"// CONTROL.scratchProbeId is planned for a later pass",
			"/* CONTROL.otherProbe too */",
			" * CONTROL.jSDocProbe in a doc block",
			"const real = { testID: CONTROL.settingsBack };",
		].join("\n");
		const stripped = stripComments(source);
		expect(stripped).not.toContain("scratchProbeId");
		expect(stripped).not.toContain("otherProbe");
		expect(stripped).not.toContain("jSDocProbe");
		expect(stripped).toContain("CONTROL.settingsBack");
	});
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

const markersOf = (
	pattern: RegExp,
): Array<{ id: string; screen: string; file: string }> => {
	const out: Array<{ id: string; screen: string; file: string }> = [];
	for (const file of walk(flowsDir).filter((f) => YAML_FILE.test(f))) {
		for (const line of readFileSync(file, "utf8").split("\n")) {
			const match = pattern.exec(line);
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

describe("the marked steps the flows declare", () => {
	it("names a screen that exists, for every kind of marker", () => {
		const unnamed = [
			...markersOf(BLOCKED_LINE),
			...markersOf(PENDING_LINE),
			...markersOf(SCENARIO_LINE),
		]
			.filter(({ screen }) => !isScreenName(screen))
			.map(({ id, screen, file }) => `${id} → '${screen}'  (${file})`);
		expect(unnamed).toEqual([]);
	});

	it("needs a concrete identifier, never a placeholder", () => {
		for (const pattern of [BLOCKED_LINE, PENDING_LINE, SCENARIO_LINE]) {
			const hidable = markersOf(pattern)
				.filter(
					({ id, screen }) => id.startsWith("<") || screen.startsWith("<"),
				)
				.map(
					({ id, file }) => `${id}  (${file}) — the marker needs a concrete id`,
				);
			expect(hidable).toEqual([]);
		}
	});

	it("marks as BLOCKED only identifiers the contract does not have", () => {
		// An id the contract DOES declare is either rendered (the step should run) or
		// pending (the screen is not here yet). `BLOCKED` for either is a marker that
		// hides a real state behind a wrong one.
		const wrong = markersOf(BLOCKED_LINE)
			.filter(({ id }) => isKnownIdentifier(id))
			.map(
				({ id, file }) =>
					`${id}  (${file}) — the contract declares this; use PENDING or uncomment the step`,
			);
		expect(wrong).toEqual([]);
	});

	it("marks as PENDING only identifiers the contract has and nothing renders", () => {
		const wrong = markersOf(PENDING_LINE)
			.filter(({ id }) => !isKnownIdentifier(id) || isRenderedId(id))
			.map(
				({ id, file }) =>
					`${id}  (${file}) — PENDING is for a declared id with no renderer; this one is ${
						isKnownIdentifier(id) ? "rendered" : "not in the contract"
					}`,
			);
		expect(wrong).toEqual([]);
	});

	it("marks as SCENARIO only identifiers the app already renders", () => {
		// The inverse of PENDING: what is missing is a relay state, not a control, so
		// the id has to be one a screen actually paints today.
		const wrong = markersOf(SCENARIO_LINE)
			.filter(({ id }) => !isKnownIdentifier(id) || !isRenderedId(id))
			.map(
				({ id, file }) =>
					`${id}  (${file}) — SCENARIO needs a rendered id; this one is not rendered`,
			);
		expect(wrong).toEqual([]);
	});

	it("lists only declared families as pending", () => {
		const unknown = PENDING_FAMILIES.filter(
			(prefix) => !IDENTIFIER_FAMILIES.includes(prefix),
		);
		expect(unknown).toEqual([]);
	});
});

describe("the routes and primitives against src/ui/a11y.ts", () => {
	const sources = SOURCE_FILES;

	it("never types an identifier as a literal", () => {
		// A literal `testID="settings-theme"` is a second spelling waiting to
		// drift from the constant the flows are checked against. Spread and
		// caller-supplied values (`testID={testID}`) are fine; a string is not.
		const offenders = sources
			.map(({ file, stripped }) => ({
				file,
				literals: [
					...(TESTID_LITERAL.test(stripped)
						? ["a testID with a string value"]
						: []),
					...new Set(literalTestIds(stripped)),
				],
			}))
			.filter(({ literals }) => literals.length > 0)
			.map(({ file, literals }) => `${file} — ${literals.join(", ")}`);
		expect(offenders).toEqual([]);
	});

	it("references every declared identifier from at least one route or primitive", () => {
		// A declared-but-unrendered identifier is a selector no flow can ever hit,
		// and it would still satisfy the flow check above. A STATE_MARKER is stricter
		// still: naming it in a module that returns it as data is not rendering it, and
		// its name is a nested path the flat groups do not have.
		const rendered = RENDER_SOURCE;
		const unused = [
			...Object.entries({ SCREEN, EMPTY, CONTROL, SURFACE, REGION }).flatMap(
				([group, ids]) =>
					Object.keys(ids)
						.filter(
							(key) => !new RegExp(`\\b${group}\\.${key}\\b`).test(rendered),
						)
						.map((key) => `${group}.${key}`),
			),
			...STATE_MARKER_NAMES.filter(
				(entry) => !namesMarker(entry).test(RENDERING_SOURCE),
			).map((entry) => entry.name),
		];
		/* No exemption list: the session view renders its vocabulary on this head, so
		 *  the assertion is the plain one the empty list was waiting for. An id declared
		 *  here and rendered by nothing is a selector no flow can ever hit. */
		expect(unused).toEqual([]);
	});
});
