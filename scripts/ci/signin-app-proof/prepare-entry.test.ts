import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { prepareProofEntry } from "./prepare-entry";

describe("E2E-only LogBox bootstrap", () => {
	it("runs the unchanged router entry, hides LogBox only with both Debug and explicit E2E flag", () => {
		const root = mkdtempSync(join(tmpdir(), "signin-entry-"));
		const pkg = '{"main":"expo-router/entry","name":"synthetic"}\n';
		try {
			writeFileSync(join(root, "package.json"), pkg);
			const out = join(root, "evidence");
			expect(() => prepareProofEntry(root, out, undefined)).toThrow();
			expect(readFileSync(join(root, "package.json"), "utf8")).toBe(pkg);
			const source = prepareProofEntry(root, out, "http://127.0.0.1:54831");
			for (const [dev, flag, expected] of [
				[true, "http://127.0.0.1:54831", true],
				[false, "http://127.0.0.1:54831", false],
				[true, undefined, false],
			] as const) {
				const calls: string[] = [];
				runInNewContext(source, {
					__DEV__: dev,
					process: { env: { EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN: flag } },
					require: (name: string) => {
						calls.push(name);
						return {
							LogBox: { ignoreAllLogs: () => calls.push("hide-overlay") },
						};
					},
				});
				expect(calls.includes("hide-overlay")).toBe(expected);
				expect(calls.at(-1)).toBe("expo-router/entry");
			}
			expect(readFileSync(join(out, "original-package.json"), "utf8")).toBe(
				pkg,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
