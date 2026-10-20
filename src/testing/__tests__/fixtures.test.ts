// biome-ignore-all lint/performance/useTopLevelRegex: the regex literals here are
// diagnostics — an assertion's expected pattern, and an escape applied to a path
// once — not per-item work on a hot path.
/**
 * The fixture references themselves, checked.
 *
 * A test that reads a corpus file the tree no longer holds used to fail as a bare
 * `ENOENT` from `readFileSync` at *import* time: vitest reports that as one failed
 * file among passing ones, so a stale path looked like a loader problem and the
 * suite's real signal disappeared behind it. That happened once in this tree, when
 * a test still read `sse/sse-keepalive.txt` after the corpus moved those bytes into
 * `sse-keepalive.json`'s `literal` field.
 *
 * Two guards, because there are two ways to get it wrong:
 *
 * 1. the loader names the path it could not find, so a miss is diagnosable;
 * 2. every fixture path written as a literal anywhere under `src/` must exist —
 *    so the stale reference is caught here, with its path, instead of as an error
 *    thrown while a different file is being imported.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	FIXTURE_ROOT,
	fixturePath,
	fixtureText,
	loadFixture,
} from "../fixtures";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** A quoted string holding `<corpus-dir>/<...>.<ext>`. */
/* Single and double quotes only: those are how a call argument is written
 * (`fixtureText("sse/...")`). Backticks are how PROSE in this tree quotes a path,
 * so scanning them would report every comment that names a historical defect —
 * including the explanation in `../fixtures.ts` — as a broken reference. */
const FIXTURE_REFERENCE =
	/["']([a-z_]+(?:\/[A-Za-z0-9_.-]+)+\.(?:json|txt|md))["']/g;

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (entry.isFile() && full.endsWith(".ts")) out.push(full);
	}
	return out;
}

interface Reference {
	file: string;
	literal: string;
}

/** The repository root, for the spelling the docs use (`fixtures/relay/…`). */
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Every corpus path a literal could name. Two spellings mean the same file:
 *  relative to the corpus (`sse/x.json`, how a test reads it) and relative to the
 *  repository root (`fixtures/relay/sse/x.json`, how `docs/` writes it). The
 *  segment test this replaces only knew the first, so the second was skipped
 *  entirely and a stale reference written that way was invisible (R3-4). */
function corpusCandidates(literal: string): string[] {
	const candidates: string[] = [];
	for (const base of [FIXTURE_ROOT, REPO_ROOT]) {
		const resolved = resolve(base, literal);
		const inside =
			resolved.startsWith(FIXTURE_ROOT + sep) || resolved === FIXTURE_ROOT;
		if (inside && !candidates.includes(resolved)) candidates.push(resolved);
	}
	return candidates;
}

/** The corpus path a literal names, or `null` when it is not a fixture reference at
 *  all. A reference to a file that does NOT exist still answers — with its first
 *  candidate — because reporting it is the point; the message prints the literal as
 *  written, so the reading is unambiguous either way. */
function corpusPathFor(literal: string): string | null {
	const candidates = corpusCandidates(literal);
	const existing = candidates.find((candidate) =>
		statSync(candidate, { throwIfNoEntry: false }),
	);
	return existing ?? candidates[0] ?? null;
}

/** Module specifiers are interpreted by Node's resolver, not by the corpus
 * loader. Only exclude a literal at a PROVEN resolver call site, with lexical
 * binding checks: an arbitrary object's resolve(), shadowed require parameter,
 * or ordinary fixture literal must still be checked. Do not whitelist package
 * names, split literals, or assume every *.json string is corpus-relative.
 * Reuse the existing Expo/Metro parser and scope engine; TS7 has no AST API. */
const nodeRequire = createRequire(import.meta.url);
const expoRequire = createRequire(nodeRequire.resolve("expo"));
const metroRequire = createRequire(expoRequire.resolve("@expo/metro-config"));
type Ast = { type: string; [key: string]: unknown };
interface AstPath {
	node: Ast;
	parent: Ast;
	scope: {
		getBinding: (
			name: string,
		) => { constant: boolean; path: AstPath } | undefined;
	};
}
const parse = (
	metroRequire("@babel/parser") as {
		parse: (source: string, options: object) => Ast;
	}
).parse;
const traverse = (
	metroRequire("@babel/traverse") as {
		default: (
			tree: Ast,
			visitors: Record<string, (path: AstPath) => void>,
		) => void;
	}
).default;
const asNode = (value: unknown): Ast | undefined =>
	value && typeof value === "object" && "type" in value
		? (value as Ast)
		: undefined;
const property = (node: Ast): unknown => {
	const prop = asNode(node.property);
	return node.computed ? prop?.value : prop?.name;
};
function moduleImport(path: AstPath, imported?: string): boolean {
	const declaration = path.parent;
	if (
		declaration.type !== "ImportDeclaration" ||
		!["node:module", "module"].includes(
			String(asNode(declaration.source)?.value),
		)
	)
		return false;
	return imported === undefined
		? ["ImportNamespaceSpecifier", "ImportDefaultSpecifier"].includes(
				path.node.type,
			)
		: path.node.type === "ImportSpecifier" &&
				asNode(path.node.imported)?.name === imported;
}
function createsNodeRequire(callee: Ast | undefined, path: AstPath): boolean {
	if (!callee) return false;
	if (callee.type === "Identifier") {
		const binding = path.scope.getBinding(String(callee.name));
		return binding !== undefined && moduleImport(binding.path, "createRequire");
	}
	const object = asNode(callee.object);
	if (
		callee.type === "MemberExpression" &&
		property(callee) === "createRequire" &&
		object?.type === "Identifier"
	) {
		const binding = path.scope.getBinding(String(object.name));
		return binding !== undefined && moduleImport(binding.path);
	}
	return false;
}
function isNodeRequire(object: Ast | undefined, path: AstPath): boolean {
	if (object?.type !== "Identifier") return false;
	const name = String(object.name),
		binding = path.scope.getBinding(name);
	if (!binding) return name === "require"; // Node's unshadowed CommonJS resolver.
	if (!binding.constant || binding.path.node.type !== "VariableDeclarator")
		return false;
	const initial = asNode(binding.path.node.init);
	return (
		initial?.type === "CallExpression" &&
		createsNodeRequire(asNode(initial.callee), binding.path)
	);
}
function resolverLiteralOffsets(text: string): Set<number> {
	const offsets = new Set<number>();
	const inspect = (path: AstPath) => {
		const callee = asNode(path.node.callee);
		if (
			!callee ||
			!["MemberExpression", "OptionalMemberExpression"].includes(callee.type) ||
			property(callee) !== "resolve"
		)
			return;
		const object = asNode(callee.object);
		const importMeta =
			object?.type === "MetaProperty" &&
			asNode(object.meta)?.name === "import" &&
			asNode(object.property)?.name === "meta";
		if (!importMeta && !isNodeRequire(object, path)) return;
		const argument = asNode((path.node.arguments as unknown[])[0]);
		if (argument?.type !== "StringLiteral") return;
		const literal = String(argument.value);
		// Relative/absolute file references retain the original corpus check.
		if (!literal.startsWith(".") && !isAbsolute(literal))
			offsets.add(Number(argument.start));
	};
	traverse(
		parse(text, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] }),
		{ CallExpression: inspect, OptionalCallExpression: inspect },
	);
	return offsets;
}
function literalsInSource(text: string): string[] {
	const matches = [...text.matchAll(FIXTURE_REFERENCE)];
	if (matches.length === 0) return [];
	const resolverOffsets = resolverLiteralOffsets(text);
	return matches
		.filter((match) => !resolverOffsets.has(match.index))
		.map((match) => match[1] ?? "");
}

/**
 * Every corpus path written as a literal under `src/`, with the file naming it.
 *
 * A literal is a reference when it RESOLVES inside the corpus root, not when its
 * first segment happens to name a corpus directory. Before resolving candidates,
 * lexical call-site checks separate proven Node package resolution from corpus
 * provenance. Unknown bare strings still get the conservative corpus check;
 * arbitrary resolve methods and shadowed bindings are not module exemptions.
 *
 * Two spellings a static scan cannot resolve are named rather than guessed at: an
 * INTERPOLATED template literal (`` `${dir}/x.json` ``) and a path assembled from
 * pieces. Those still fail loudly at the loader, which reports the path it could
 * not find — which is guard 1.
 */
function fixtureReferences(): Reference[] {
	const found: Reference[] = [];
	for (const file of sourceFiles(SRC_ROOT)) {
		const text = readFileSync(file, "utf8");
		for (const literal of literalsInSource(text)) {
			if (corpusPathFor(literal) === null) continue;
			found.push({ file: relative(SRC_ROOT, file), literal });
		}
	}
	return found;
}

describe("a fixture that is not there fails with its path, not as a loader error", () => {
	it("names the missing file and where it looked", () => {
		/* Built at runtime on purpose: a literal here would be reported by the scan
		 * below, which is exactly the guard working. The name is the real historical
		 * one — the `.txt` the corpus never held after its keep-alive bytes moved into
		 * `sse-keepalive.json`. */
		const missing = ["sse", "sse-keepalive.txt"].join("/");
		expect(() => fixtureText(missing)).toThrow(
			/fixture not found: sse\/sse-keepalive\.txt/,
		);
		/* The absolute path too: the relative one alone cannot be located. */
		expect(() => fixtureText(missing)).toThrow(
			new RegExp(fixturePath(missing).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
	});

	it("says malformed JSON is malformed, rather than calling it missing", () => {
		expect(() => loadFixture("README.md")).toThrow(/not valid JSON/);
	});

	it("resolves an already-absolute path, which is how the corpus walk reads", () => {
		expect(isAbsolute(fixturePath("sse/sse-list-frame.json"))).toBe(true);
		const frame = loadFixture<{ data: { sessions: unknown[] } }>(
			fixturePath("sse/sse-list-frame.json"),
		);
		expect(Array.isArray(frame.data.sessions)).toBe(true);
	});
});

describe("every fixture path referenced in src/ exists in the corpus", () => {
	/* The guard for the defect this file was written after: a test naming
	 * `sse/sse-keepalive.txt`, a file no branch has held since the corpus moved
	 * those bytes into JSON. Cheap, and it fails with the path and the file that
	 * names it rather than as an import-time throw in an unrelated suite. */
	it("resolves every corpus path written as a literal", () => {
		const references = fixtureReferences();
		/* Sanity: if the scan stops matching, this guard would silently pass. */
		expect(references.length).toBeGreaterThan(20);

		const missing = references
			.filter(({ literal }) => {
				const path = corpusPathFor(literal);
				return path === null || !statSync(path, { throwIfNoEntry: false });
			})
			.map(({ file, literal }) => `${file} → ${literal}`);

		expect(missing).toEqual([]);
	});

	it("reports a root-relative reference to a missing file, which the segment test skipped", () => {
		/* The regression guard for R3-4. A stale path written the way the docs write
		 * it used to pass the filter entirely, because its first segment is
		 * `fixtures` rather than a corpus directory.
		 *
		 * The two probes are ASSEMBLED rather than written out: the scan above walks
		 * this file too, so a literal naming a file that does not exist would be
		 * reported (correctly) as a stale reference and this guard could never pass.
		 * The assembled form is exactly what the scan cannot resolve statically, which
		 * is the limitation the header names. */
		const missingFrame = ["no-such-frame", "json"].join(".");
		const rootRelative = ["fixtures", "relay", "sse", missingFrame].join("/");
		const corpusRelative = ["sse", missingFrame].join("/");

		/* Both are references now, and neither resolves to a file. */
		for (const literal of [rootRelative, corpusRelative]) {
			const path = corpusPathFor(literal);
			expect(path).not.toBeNull();
			expect(
				path === null || statSync(path, { throwIfNoEntry: false }),
			).toBeFalsy();
		}

		/* For a file that EXISTS, the two spellings are one path — which is what makes
		 * the scan's answer single-valued. */
		const existing = "sse/sse-list-frame.json";
		expect(corpusPathFor(`fixtures/relay/${existing}`)).toBe(
			corpusPathFor(existing),
		);

		/* And the filter's original job is intact: a request path and a module
		 * specifier are not fixture references. */
		expect(corpusPathFor("/api/sessions/none.json")).toBeNull();
		expect(corpusPathFor("../fixtures.ts")).toBeNull();
	});
});

describe("fixture reference call-site classification", () => {
	const packageName = ["arbitrary_module", "package.json"].join("/");
	const missing = ["sse", "missing-callsite.json"].join("/");
	const rootMissing = ["fixtures", "relay", missing].join("/");
	const quoted = (value: string) => JSON.stringify(value);
	it("does not confuse Node package resolution with fixture provenance", () => {
		const code = `import {createRequire as factory} from "node:module"; const local = factory(import.meta.url); local.resolve(${quoted(packageName)}); require.resolve(${quoted(packageName)}); import.meta.resolve(${quoted(packageName)});`;
		expect(literalsInSource(code)).toEqual([]);
	});
	it("retains true missing corpus and repository-root references beside resolver calls", () => {
		const code = `import {createRequire} from "node:module"; const local=createRequire(import.meta.url); local.resolve(${quoted(packageName)}); fixtureText(${quoted(missing)}); fixtureText(${quoted(rootMissing)});`;
		expect(literalsInSource(code)).toEqual([missing, rootMissing]);
		for (const literal of literalsInSource(code)) {
			const path = corpusPathFor(literal);
			expect(path).not.toBeNull();
			expect(path && statSync(path, { throwIfNoEntry: false })).toBeFalsy();
		}
	});
	it("keeps a real corpus reference visible and resolvable", () => {
		const existing = "http/history-ok.json";
		expect(literalsInSource(`fixtureText(${quoted(existing)});`)).toEqual([
			existing,
		]);
		const path = corpusPathFor(existing);
		expect(path).not.toBeNull();
		expect(path && statSync(path, { throwIfNoEntry: false })).toBeTruthy();
	});
	it("does not exempt unrelated resolve methods or shadowed Node bindings", () => {
		const code = `const arbitrary={resolve(){}}; arbitrary.resolve(${quoted(missing)}); function shadow(require){require.resolve(${quoted(rootMissing)});}`;
		expect(literalsInSource(code)).toEqual([missing, rootMissing]);
	});
	it("honors real namespace factories but not a locally shadowed createRequire", () => {
		const code = `import * as moduleAPI from "node:module"; const local=moduleAPI.createRequire(import.meta.url); local.resolve(${quoted(packageName)}); function shadow(createRequire){const fake=createRequire(); fake.resolve(${quoted(missing)});}`;
		expect(literalsInSource(code)).toEqual([missing]);
	});
});
