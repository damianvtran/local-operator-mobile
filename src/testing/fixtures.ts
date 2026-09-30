/**
 * The one way a test reads the captured corpus.
 *
 * Six test files used to build the fixture path themselves and hand it to
 * `readFileSync`, which failed on a stale path as a bare `ENOENT` raised at
 * *import* time — reported by vitest as one failed file beside passing ones, and
 * read by a human as a broken test rather than as a reference to a file that is
 * not there. A stale reference has already happened once in this tree: a test
 * read `sse/sse-keepalive.txt` after the corpus moved those bytes into
 * `sse-keepalive.json`'s `literal` field, and the suite's real signal was buried
 * under what looked like a loader problem.
 *
 * So every read goes through here, and a miss names the path it looked for. The
 * corpus itself is documented in `fixtures/relay/README.md`; this module only
 * finds it.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `fixtures/relay`, resolved once from this file's own location. */
export const FIXTURE_ROOT = fileURLToPath(
	new URL("../../fixtures/relay", import.meta.url),
);

/** Absolute path for a corpus-relative reference. An already-absolute path (the
 *  walk in `schemas.test.ts` produces those) is passed through unchanged, so the
 *  helper serves both call styles. */
export function fixturePath(relativeOrAbsolute: string): string {
	return isAbsolute(relativeOrAbsolute)
		? relativeOrAbsolute
		: join(FIXTURE_ROOT, relativeOrAbsolute);
}

/** The raw bytes of a fixture, byte-exact.
 *
 * A missing file throws with the path rather than a bare `ENOENT`, so the
 * failure names the stale reference instead of the loader. */
export function fixtureText(relativeOrAbsolute: string): string {
	const path = fixturePath(relativeOrAbsolute);
	if (!existsSync(path) || !statSync(path).isFile()) {
		throw new Error(
			`fixture not found: ${relativeOrAbsolute}\n` +
				`  looked for ${path}\n` +
				"  Captured fixtures live in fixtures/relay/** (see fixtures/relay/README.md).\n" +
				"  A reference here that does not resolve is a stale path, not a missing install:\n" +
				"  raw wire bytes belong in a JSON file's `literal` field, never a .txt beside it.",
		);
	}
	return readFileSync(path, "utf8");
}

/** A parsed fixture. Throws on a missing path (as above) and on malformed JSON,
 *  with the path in the message for the same reason. */
export function loadFixture<T = unknown>(relativeOrAbsolute: string): T {
	const path = fixturePath(relativeOrAbsolute);
	try {
		return JSON.parse(fixtureText(path)) as T;
	} catch (cause) {
		if (cause instanceof Error && cause.message.startsWith("fixture not found"))
			throw cause;
		throw new Error(
			`fixture is not valid JSON: ${relativeOrAbsolute}\n  ${String(cause)}`,
		);
	}
}

/** Every `.json` file under `dir`, sorted, as absolute paths. The corpus also
 *  holds a README, which is not a payload. */
export function listFixtureJsonFiles(dir: string = FIXTURE_ROOT): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listFixtureJsonFiles(full));
		else if (
			entry.isFile() &&
			entry.name.endsWith(".json") &&
			statSync(full).isFile()
		)
			out.push(full);
	}
	return out;
}
