import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `tsconfig.tools.json` resolves modules the way a bundler does, because the
 * scripts import `src/`, which the app compiles that way. Bundler resolution
 * accepts an extensionless relative specifier; Node's ESM loader refuses it
 * (ERR_MODULE_NOT_FOUND, or ERR_UNSUPPORTED_DIR_IMPORT for a directory). So the
 * type checker no longer catches a script that cannot run, and this test does:
 * every relative import in `scripts/` must name its file, extension included.
 *
 * Only the scripts' OWN specifiers are in scope. Extensionless imports inside
 * `src/` are resolved at run time by the hook in `scripts/lib/load-src.ts`.
 */

const dir = new URL(".", import.meta.url).pathname;

const walk = (folder: string): string[] =>
	readdirSync(folder).flatMap((name) => {
		const path = join(folder, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});

/** `from "./x"`, `import "./x"` and `import("./x")`. A bare string that merely
 * starts with `./` (a `startsWith("./")` check) is not a specifier. */
const RELATIVE_SPECIFIER =
	/(?:\bfrom|\bimport)\s*\(?\s*["'](\.\.?\/[^"']*)["']/g;
const HAS_EXTENSION = /\.(?:[cm]?[jt]s|json)$/;

const offenders = (): string[] =>
	walk(dir)
		.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
		.flatMap((file) =>
			[...readFileSync(file, "utf8").matchAll(RELATIVE_SPECIFIER)]
				.map((match) => match[1] ?? "")
				.filter((specifier) => !HAS_EXTENSION.test(specifier))
				.map((specifier) => `${file.slice(dir.length)}: ${specifier}`),
		);

describe("scripts/ import specifiers", () => {
	it("name their file, so Node can run what the type checker accepts", () => {
		expect(offenders()).toEqual([]);
	});

	it("would catch an extensionless specifier", () => {
		// The scan itself: a rule that never fires is a rule that is not there.
		const probe = 'import { x } from "../src/relay/errors";';
		const found = [...probe.matchAll(RELATIVE_SPECIFIER)].map((m) => m[1]);
		expect(found).toEqual(["../src/relay/errors"]);
		expect(HAS_EXTENSION.test(found[0] ?? "")).toBe(false);
	});
});
