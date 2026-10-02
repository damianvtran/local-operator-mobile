import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The tooling in `scripts/` runs directly under Node's native type stripping,
 * which erases annotations but cannot EMIT enums, namespaces or parameter
 * properties. `tsconfig.tools.json` turns that into a compile error with
 * `erasableSyntaxOnly`.
 *
 * A config flag is easy to delete without anyone noticing what it guarded, so
 * this test exercises the gate itself: it asks the pinned compiler to check a
 * file containing each construct, through the real tools config, and requires the
 * rejection. It fails if the flag is removed, and it fails if the resolved
 * compiler stops supporting it.
 */

const root = fileURLToPath(new URL("../", import.meta.url));
const tsc = join(root, "node_modules/.bin/tsc");

/** Decorators are not covered by the flag; Node itself rejects them as a syntax
 * error under type stripping, which the generator's own run would surface. */
const ERASABLE_ONLY_ERROR = "TS1294";

const cases: Array<[string, string]> = [
	["an enum", "export enum Mode { A }\n"],
	["a namespace", "export namespace Space { export const v = 1; }\n"],
	[
		"a parameter property",
		"export class Holder { constructor(private readonly value: number) {} }\n",
	],
];

const checkWithToolsConfig = (source: string) => {
	const dir = mkdtempSync(join(tmpdir(), "lomobile-erasable-"));
	try {
		writeFileSync(join(dir, "probe.ts"), source);
		// Same module scope as `scripts/`: without `"type": "module"` nodenext reads the
		// probe as CommonJS and reports an unrelated TS1287, not the flag under test.
		writeFileSync(join(dir, "package.json"), '{"type":"module"}');
		// Extend the real config so the flag under test is the repository's, but
		// clear `types` and `include`: those resolve relative to the config's own
		// directory, which here is the temp dir and has no node_modules.
		writeFileSync(
			join(dir, "tsconfig.json"),
			JSON.stringify({
				extends: join(root, "tsconfig.tools.json"),
				compilerOptions: { types: [], typeRoots: [] },
				include: ["probe.ts"],
			}),
		);
		return spawnSync(tsc, ["--noEmit", "-p", dir], { encoding: "utf8" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

/**
 * These cases spawn a COLD `tsc`, measured on this host at **3576 / 3602 / 5051 ms**
 * — against vitest's 5000 ms default, so the heaviest case timed out on a loaded
 * machine for a reason that has nothing to do with erasable syntax. The budget below
 * is 6x the worst measurement, and it bounds only how long the spawn may take: every
 * assertion is about tsc's verdict and its output, never about the time it took.
 */
const COLD_TSC_TIMEOUT_MS = 30_000;

describe("scripts/ only uses syntax that type stripping can run", {
	timeout: COLD_TSC_TIMEOUT_MS,
}, () => {
	it("accepts erasable TypeScript, so the probe itself is sound", () => {
		const result = checkWithToolsConfig("export const value: number = 1;\n");
		expect(result.stdout + result.stderr).toBe("");
		expect(result.status).toBe(0);
	});

	it.each(cases)("rejects %s", (_name, source) => {
		const result = checkWithToolsConfig(source);
		const output = result.stdout + result.stderr;
		expect(output).toContain(ERASABLE_ONLY_ERROR);
		// Only the flag under test may be the reason: any other diagnostic means the
		// probe is broken and the rejection proves nothing.
		expect(output.match(/error TS\d+/g)).toEqual([
			`error ${ERASABLE_ONLY_ERROR}`,
		]);
		expect(result.status).not.toBe(0);
	});
});
