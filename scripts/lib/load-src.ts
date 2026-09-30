/**
 * Lets plain `node script.ts` load `src/` unchanged.
 *
 * Node's native type stripping runs `.ts` files as they are, but its ESM resolver
 * needs a file extension on every relative import, and `src/` (built for Metro and
 * Vite, and typechecked with `moduleResolution: bundler`) writes them without one.
 * Rewriting 60 imports to carry `.ts` would force `allowImportingTsExtensions` on a
 * tsconfig this module does not own, so the gap is closed here instead, at load
 * time, with a resolve hook that appends the extension when the file exists.
 *
 * Constraints, all deliberate:
 * - Node built-ins only (`node:module`); no loader dependency.
 * - The hook must be registered BEFORE `src/` is imported. Static imports are all
 *   resolved before any module runs, so callers `await import()` `src/` after
 *   `registerSourceResolver()`.
 * - Only relative specifiers with no extension are touched; packages, `node:` and
 *   explicit `.ts`/`.json` paths resolve exactly as Node would.
 * - `src/` must stay strip-clean: no enums, namespaces or constructor parameter
 *   properties, because strip-only mode refuses them.
 *
 * One warning is expected and harmless: Node prints `MODULE_TYPELESS_PACKAGE_JSON`
 * once for `src/`, because the repository root cannot declare `"type": "module"`
 * (metro.config.js is loaded with `require`) and `scripts/package.json` scopes only
 * `scripts/`. Pass `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` when the
 * transcript is meant to be pasted somewhere; nothing about the run changes.
 */

import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const HAS_EXTENSION = /\.[cm]?[jt]s$|\.json$/;

export function registerSourceResolver(): void {
	registerHooks({
		resolve(specifier, context, nextResolve) {
			const relative =
				specifier.startsWith("./") || specifier.startsWith("../");
			if (
				relative &&
				context.parentURL?.startsWith("file:") &&
				!HAS_EXTENSION.test(specifier)
			) {
				const base = fileURLToPath(new URL(specifier, context.parentURL).href);
				for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
					if (existsSync(candidate) && statSync(candidate).isFile()) {
						return nextResolve(pathToFileURL(candidate).href, context);
					}
				}
			}
			return nextResolve(specifier, context);
		},
	});
}

/** The app's own client modules, loaded through the resolver above. */
export async function loadApp() {
	registerSourceResolver();
	const root = new URL("../../src/", import.meta.url).href;
	const [connection, relay, testing] = await Promise.all([
		import(`${root}connection/index.ts`),
		import(`${root}relay/index.ts`),
		import(`${root}testing/cookie-jar-fetch.ts`),
	]);
	return { connection, relay, testing } as {
		connection: typeof import("../../src/connection/index.ts");
		relay: typeof import("../../src/relay/index.ts");
		testing: typeof import("../../src/testing/cookie-jar-fetch.ts");
	};
}
