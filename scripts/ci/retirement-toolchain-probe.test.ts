import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("runs the NO-TEST Python integration and isolation controls", () => {
	const root = mkdtempSync(join(tmpdir(), "toolchain-probe-suite-"));
	try {
		// Exercise the hosted command's system Python, not a new dependency tree.
		// No inherited credentials or scratchpad ownership may enter this suite.
		const child = spawnSync(
			"/usr/bin/python3",
			[join(import.meta.dirname, "retirement-toolchain-probe.test.py")],
			{
				encoding: "utf8",
				timeout: 20000,
				maxBuffer: 65536,
				env: {
					NODE_ENV: "test",
					PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
					TMPDIR: `${root}/`,
				},
			},
		);
		expect(child.error).toBeUndefined();
		expect(child.status, child.stderr).toBe(0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}, 25000);
