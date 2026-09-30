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
		include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
		globals: false,
		// `github-actions` is the reporter's actual name, and the CI branch is real:
		// the local shell has `CI` set, so a wrong name here fails every run rather
		// than only the pipeline.
		reporters: process.env.CI ? ["github-actions", "dot"] : ["default"],
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
});
