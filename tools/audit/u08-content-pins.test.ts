/** The admission guard's own tests: real git fixture, real content, no browser.
 *
 * WHY A FIXTURE REPOSITORY AND NOT A MOCKED SNAPSHOT. The bug this replaces was
 * an admission rule that a merged, harmless file could refuse (hosted run
 * 40179237342). Proving the replacement needs the real enumerator — `git
 * ls-files`, the index, tracked-vs-untracked — against real file content, not a
 * hand-built map that would agree with the guard by construction. Only the
 * pinned scopes are copied, so the fixture is a few MB and matches the pins.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	assertPinnedContent,
	contentDrift,
	INSTRUMENT_PINS,
	pinnedScopes,
	RENDER_FILE_PINS,
	RENDER_TREE_PINS,
	snapshotContent,
	treeDigest,
} from "./u08-content-pins.ts";

const root = resolve(import.meta.dirname, "../..");
const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");

let fixture: string;

/** Copy every pinned scope into a throwaway git repository. `git add -A` is what
 * the guard reads: a merged file is in the index, a scratch file is not. */
beforeAll(() => {
	fixture = mkdtempSync(join(tmpdir(), "u08-content-pins-"));
	for (const scope of pinnedScopes()) {
		const source = resolve(root, scope);
		if (!existsSync(source)) continue;
		cpSync(source, resolve(fixture, scope), { recursive: true });
	}
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: fixture });
	execFileSync("git", ["add", "-A"], { cwd: fixture });
});

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

/** Restore the index content and drop untracked additions between cases. */
afterEach(() => {
	execFileSync("git", ["checkout", "--", "."], { cwd: fixture });
	execFileSync("git", ["clean", "-fdq"], { cwd: fixture });
});

describe("U08 content-identity admission", () => {
	it("admits documentation assets merged since the incident: a store capture and a docs file", () => {
		const capture = resolve(
			fixture,
			"design/store-screenshots/iphone-6.9/new-frame.png",
		);
		mkdirSync(resolve(fixture, "design/store-screenshots/iphone-6.9"), {
			recursive: true,
		});
		writeFileSync(capture, "not a render input");
		mkdirSync(resolve(fixture, "docs"), { recursive: true });
		writeFileSync(resolve(fixture, "docs/INCIDENT-NOTES.md"), "merged prose");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const content = snapshotContent(fixture);
		expect(
			content.files.has("design/store-screenshots/iphone-6.9/new-frame.png"),
		).toBe(false);
		expect(contentDrift(content)).toEqual([]);
		expect(() => assertPinnedContent(content)).not.toThrow();
	});

	it("refuses an edited instrument file and names it with both hashes", () => {
		const path = "tools/audit/checks.ts";
		writeFileSync(
			resolve(fixture, path),
			`${readFileSync(resolve(fixture, path), "utf8")}\n// policy drift\n`,
		);
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const actual = sha(readFileSync(resolve(fixture, path)));
		const pinned = INSTRUMENT_PINS[path];
		expect(actual).not.toBe(pinned);
		expect(contentDrift(snapshotContent(fixture))).toContainEqual({
			kind: "instrument",
			scope: path,
			pinned,
			actual,
		});
		expect(() => assertPinnedContent(snapshotContent(fixture))).toThrow(
			`instrument ${path} pinned=${pinned} actual=${actual}`,
		);
	});

	it("refuses an edited app source file through the render-tree digest", () => {
		const path = "src/ui/theme.css";
		writeFileSync(
			resolve(fixture, path),
			`${readFileSync(resolve(fixture, path), "utf8")}\n/* repaint */\n`,
		);
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const content = snapshotContent(fixture);
		const actual = treeDigest(content, "src");
		expect(actual).not.toBe(RENDER_TREE_PINS.src);
		expect(() => assertPinnedContent(content)).toThrow(
			`render-tree src pinned=${RENDER_TREE_PINS.src} actual=${actual}`,
		);
	});

	it("refuses an edited design token and an edited lockfile through their own pins", () => {
		const token = resolve(fixture, "design/tokens/tokens.json");
		writeFileSync(token, `${readFileSync(token, "utf8")}\n`);
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const drift = contentDrift(snapshotContent(fixture));
		expect(drift.map((entry) => `${entry.kind} ${entry.scope}`)).toContain(
			"render-tree design/tokens",
		);
		execFileSync("git", ["checkout", "--", "."], { cwd: fixture });
		writeFileSync(
			resolve(fixture, "pnpm-lock.yaml"),
			`${readFileSync(resolve(fixture, "pnpm-lock.yaml"), "utf8")}\n# dependency drift\n`,
		);
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const lock = resolve(fixture, "pnpm-lock.yaml");
		expect(() => assertPinnedContent(snapshotContent(fixture))).toThrow(
			`render-file pnpm-lock.yaml pinned=${RENDER_FILE_PINS["pnpm-lock.yaml"]} actual=${sha(readFileSync(lock))}`,
		);
	});

	it("refuses a deleted instrument file as absent rather than skipping it", () => {
		const path = "tools/audit/color.ts";
		rmSync(resolve(fixture, path));
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		expect(() => assertPinnedContent(snapshotContent(fixture))).toThrow(
			`instrument ${path} pinned=${INSTRUMENT_PINS[path]} actual=absent`,
		);
	});

	it("keeps documentation, the design kit's own preview and native plugins outside the pinned scope", () => {
		expect(pinnedScopes()).toEqual([...pinnedScopes()].sort());
		for (const out of [
			"design/store-screenshots",
			"design/preview",
			"design/app-icon",
			"plugins",
			"docs",
		])
			expect(
				pinnedScopes().some(
					(scope) => scope === out || scope.startsWith(`${out}/`),
				),
			).toBe(false);
	});

	it("gates the real driver before any browser or relay launch", () => {
		const source = readFileSync(
			resolve(root, "tools/audit/u08-geometry-proof.ts"),
			"utf8",
		);
		const gate = source.indexOf("assertPinnedContent()");
		expect(gate).toBeGreaterThan(-1);
		expect(gate).toBeLessThan(source.indexOf("createRelay("));
		expect(gate).toBeLessThan(source.indexOf("launchChrome("));
		expect(source).not.toContain("git diff --exit-code");
	});
});
