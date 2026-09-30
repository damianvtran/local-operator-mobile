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
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fixturePath, fixtureText, loadFixture } from "../fixtures";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The corpus's top-level directories (`fixtures/relay/`). A literal is treated as
 *  a fixture reference only when it starts with one of these, so request paths
 *  (`/api/sessions/...`), module specifiers and prose are not swept in. */
const CORPUS_DIRECTORIES = [
	"gateway",
	"http",
	"probes",
	"sse",
	"synthetic",
] as const;

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

/** Every corpus path written as a literal under `src/`, with the file naming it. */
function fixtureReferences(): Reference[] {
	const found: Reference[] = [];
	for (const file of sourceFiles(SRC_ROOT)) {
		const text = readFileSync(file, "utf8");
		for (const match of text.matchAll(FIXTURE_REFERENCE)) {
			const literal = match[1] ?? "";
			const [directory] = literal.split("/");
			if (!(CORPUS_DIRECTORIES as readonly string[]).includes(directory ?? ""))
				continue;
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
				const path = fixturePath(literal);
				return !statSync(path, { throwIfNoEntry: false });
			})
			.map(({ file, literal }) => `${file} → ${literal}`);

		expect(missing).toEqual([]);
	});
});
