import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests run in Node, not in a React Native host.
 *
 * That constraint is deliberate and it shapes the source layout: anything a test
 * touches must be free of `react-native` imports, so the parts of a component
 * worth asserting — how a variant resolves to tokens and classes, how a theme
 * resolves, the pure formatting helpers — live in plain modules that the
 * component then renders. A test that needs the real renderer belongs in the
 * native E2E layer (ADR 0003), not here.
 *
 * `pnpm test` is the whole-tree gate; `expo export --platform web` plus a
 * headless-Chrome capture is what proves a screen actually looks right.
 */
export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "tools/**/*.test.ts"],
		globals: false,
		// react-native-web ships untranspiled ESM; Node must go through Vite for it.
		server: { deps: { inline: [/react-native-web/] } },
		// The name is `github-actions`, NOT `github`: vitest 5 resolves an unknown
		// reporter as a module path, so `github` kills the run before a single test
		// with "Failed to load custom Reporter from github" (reproduced: rc=1, while
		// `--reporter=github-actions` is accepted). CI sets `CI`, so that name is
		// load-bearing for the pipeline even though the annotations are cosmetic
		// locally — `dot` stays alongside it to keep the local summary readable.
		// A wrong name here still exits non-zero on a red suite, so it can never
		// turn a failure into a pass; it turns a run into no run.
		reporters: process.env.CI ? ["github-actions", "dot"] : ["default"],
	},
	resolve: {
		alias: [
			// Rendering a primitive in Node needs a `react-native` that is not Flow source:
			// react-native-web is what the web target ships, so a test through it asserts
			// the DOM a browser user actually gets. Pure-logic tests never import it.
			{ find: /^react-native$/, replacement: "react-native-web" },
			{
				find: "@",
				replacement: fileURLToPath(new URL("./src", import.meta.url)),
			},
		],
	},
});
