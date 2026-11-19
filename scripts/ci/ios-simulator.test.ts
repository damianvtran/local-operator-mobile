import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `ios-simulator.ts --min-os` (agent review R1 m4): the runtime floor the
 * `xcode-27` jobs pass so the gate launches an iOS 27 runtime, never an older
 * one that happens to list the preferred device. Driven through the CLI with
 * `--json-file`, the script's own fixture seam, so the exit codes and output
 * lines are exactly what a workflow step sees.
 */
const ROOT = mkdtempSync(join(tmpdir(), `ios-simulator-test-${process.pid}-`));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const SCRIPT = fileURLToPath(new URL("./ios-simulator.ts", import.meta.url));

const device = (name: string, udid: string) => ({
	name,
	udid,
	isAvailable: true,
});
const RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-";

/** An image carrying an iOS 26 runtime WITH the preferred name and an iOS 27
 *  runtime WITHOUT it: the case the floor exists for. */
const MIXED = {
	devices: {
		[`${RUNTIME}26-5`]: [device("iPhone 17", "OLD-17")],
		[`${RUNTIME}27-1`]: [device("iPhone 18", "NEW-18")],
	},
};

const run = (
	fixture: unknown,
	args: string[],
): { status: number; stdout: string; stderr: string } => {
	const path = join(
		ROOT,
		`devices-${Math.random().toString(36).slice(2)}.json`,
	);
	writeFileSync(path, JSON.stringify(fixture));
	const env = { ...process.env };
	delete env.GITHUB_OUTPUT;
	try {
		const stdout = execFileSync(
			process.execPath,
			[SCRIPT, "--prefer", "iPhone 17", "--json-file", path, ...args],
			{ encoding: "utf8", env, stdio: "pipe" },
		);
		return { status: 0, stdout, stderr: "" };
	} catch (error) {
		const failed = error as {
			status?: number;
			stdout?: string;
			stderr?: string;
		};
		return {
			status: failed.status ?? -1,
			stdout: failed.stdout ?? "",
			stderr: failed.stderr ?? "",
		};
	}
};

describe("ios-simulator --min-os", () => {
	it("drops older runtimes before the preferred name is looked up", () => {
		const result = run(MIXED, ["--min-os", "27"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("udid=NEW-18");
		expect(result.stdout).toContain("os=27.1");
		// The fallback is announced, never silent.
		expect(result.stdout).toContain("::warning::iPhone 17 is not installed");
	});

	it("without the floor, still resolves the preferred name on the older runtime", () => {
		// The negative control: the behaviour the floor exists to stop.
		const result = run(MIXED, []);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("udid=OLD-17");
	});

	it("fails, naming the floor, when no runtime meets it", () => {
		const result = run(
			{ devices: { [`${RUNTIME}26-5`]: [device("iPhone 17", "OLD-17")] } },
			["--min-os", "27"],
		);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("no available iOS 27+ simulator");
	});

	it("exits 2 on a --min-os that is not an iOS major", () => {
		expect(run(MIXED, ["--min-os", "27.1"]).status).toBe(2);
		expect(run(MIXED, ["--min-os", "latest"]).status).toBe(2);
	});
});
