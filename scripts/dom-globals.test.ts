import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `tsconfig.tools.json` adds the DOM lib, because the `src/` the scripts import
 * needs it: `Crypto` is used there as a TYPE (React Native declares only the
 * value) and the `readFileSync` overloads resolve only with it. The cost is a
 * hole — a script naming `document` or `window` typechecks clean and then dies
 * with `ReferenceError` under Node, which is the exact class of failure the
 * type-stripping gate exists to catch.
 *
 * The config is not narrowed on purpose: declaring the missing DOM pieces by hand
 * would put this project's `Crypto` in competition with the one `src/` is written
 * against, and splitting the tools project in two to carry one lib is more
 * machinery than the problem needs. So this test closes the hole for the files
 * the tools project OWNS — `scripts/**` must not name a browser global. Imports
 * from `src/` are out of scope: those files run in a browser as well, and they
 * belong to the modules that own them.
 */

const dir = fileURLToPath(new URL(".", import.meta.url));

const walk = (folder: string): string[] =>
	readdirSync(folder).flatMap((name) => {
		const path = join(folder, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});

/**
 * Only globals a Node script CANNOT have, verified absent on this Node
 * (`typeof globalThis[name] === "undefined"`, v26.5.0). `navigator`, `fetch`,
 * `URL`, `Blob`, `crypto` and `structuredClone` are real Node globals, so
 * listing them would be wrong rather than strict; `localStorage` and
 * `sessionStorage` exist behind `--localstorage-file` instead of being missing.
 */
const BROWSER_GLOBALS = [
	"document",
	"window",
	"XMLHttpRequest",
	"DOMParser",
	"HTMLElement",
	"HTMLCanvasElement",
	"Element",
	"getComputedStyle",
	"requestAnimationFrame",
	"MutationObserver",
	"FileReader",
	"location",
	"screen",
	"alert",
];

/**
 * A bare identifier, not a member of an object and not a key. Both exclusions are
 * load-bearing in this repo: `tokens.space.screen.headerHeight` is a token path
 * and `screen:` opens a schema field, and a scan that flags them is a scan
 * someone deletes. Comments and string literals are removed for the same reason —
 * prose says "a screen that renders unpositioned".
 */
const USAGE = new RegExp(
	`(^|[^.\\w$])((?:${BROWSER_GLOBALS.join("|")})\\b)(?!\\s*:)`,
);

/**
 * Known limit: destructuring a token into a variable named `screen` would be
 * flagged, because the name is then genuinely bare. No such code exists here; if
 * one is ever added, rename the binding rather than widening the scan.
 */
const stripNonCode = (source: string): string =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		// A `//` after a colon is kept: that is a URL (`https://`), not a comment.
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1")
		.replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
		.replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
		.replace(/`(?:[^`\\]|\\.)*`/g, "``");

const hits = (source: string): string[] =>
	[...stripNonCode(source).matchAll(new RegExp(USAGE, "g"))].map(
		(match) => match[2] ?? "",
	);

const offenders = (): string[] =>
	walk(dir)
		.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
		.flatMap((file) =>
			hits(readFileSync(file, "utf8")).map(
				(name) => `${file.slice(dir.length)}: ${name}`,
			),
		);

describe("scripts/ browser globals", () => {
	it("are not used, because the type checker allows them and Node does not", () => {
		expect(offenders()).toEqual([]);
	});

	it("would catch a browser global, and ignores prose, strings and token paths", () => {
		// The scan itself: a rule that never fires is a rule that is not there.
		expect(hits("const t = document.title;")).toEqual(["document"]);
		expect(hits("if (window.location) {}")).toEqual(["window"]);
		expect(hits("// the document is written below\nconst x = 1;")).toEqual([]);
		expect(hits('out.push(" * screen renders wrong");')).toEqual([]);
		expect(hits("tokens.space.screen.headerHeight")).toEqual([]);
		expect(hits("screen: z.looseObject({})")).toEqual([]);
		expect(hits('const url = "https://example.test/x";')).toEqual([]);
	});
});
