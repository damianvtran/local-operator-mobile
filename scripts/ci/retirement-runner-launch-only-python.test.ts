import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("runs supervisor/expiry/export controls without native commands", () => {
	const child = spawnSync(
		"/usr/bin/python3",
		[
			new URL(
				"./retirement-runner-launch-only-supervisor.test.py",
				import.meta.url,
			).pathname,
		],
		{
			env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
			encoding: "utf8",
			timeout: 15000,
			maxBuffer: 65536,
		},
	);
	expect(child.status, child.stderr).toBe(0);
	expect(child.stderr).toContain("OK");
});
