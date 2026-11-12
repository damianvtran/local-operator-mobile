import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Review R1-M1: `provider.tsx` imports `notifications/background-task.ts`, and a
 * top-level value import of `expo-task-manager` there dragged
 * `expo-modules-core` into every Node-run test that loads the provider, which
 * throws `__DEV__ is not defined` at import (provider-account-switch.test.ts
 * stopped loading). The native module must be loaded lazily, inside the
 * non-web guard. Same source-reading pattern as the user-message-clamp
 * import-graph guard: a static check, because the failure is an import-time
 * throw that only some test environments surface.
 */

/** A value (non-`import type`) import or re-export of expo-task-manager. */
const VALUE_IMPORT =
	/^(?:import|export) (?!type )[^;]*from "expo-task-manager"|^import "expo-task-manager"/m;
const read = (file: string): string =>
	readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const code = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the Team Bridge provider's import graph", () => {
	const PROVIDER = code(read("../provider.tsx"));
	const TASK = code(read("../../notifications/background-task.ts"));

	it("reaches the background task module (the edge this guard is about)", () => {
		expect(PROVIDER).toContain('from "@/notifications/background-task"');
	});

	it("has no value import of expo-task-manager on that edge", () => {
		expect(PROVIDER).not.toMatch(VALUE_IMPORT);
		expect(TASK).not.toMatch(VALUE_IMPORT);
	});

	it("loads expo-task-manager only inside the non-web guard", () => {
		const guard = TASK.indexOf('if (Platform.OS !== "web") {');
		const load = TASK.indexOf('require("expo-task-manager")');
		expect(guard).toBeGreaterThan(-1);
		expect(load).toBeGreaterThan(guard);
		// And the definition itself still runs at module scope, after the load.
		expect(TASK.indexOf("TaskManager.defineTask(")).toBeGreaterThan(load);
	});

	it("the regex sees the value import it forbids (negative control)", () => {
		expect('import * as TaskManager from "expo-task-manager";').toMatch(
			VALUE_IMPORT,
		);
		expect(
			'import type { TaskManagerTaskBody } from "expo-task-manager";',
		).not.toMatch(VALUE_IMPORT);
	});
});
