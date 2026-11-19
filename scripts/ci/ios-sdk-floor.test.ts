import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { checkFloor, sdkMajor } from "./ios-sdk-floor.ts";

// Why these tests: the floor and the simulator's `--min-os` are the two guards
// that keep the iOS jobs on the iOS 27 SDK Apple requires from April 2027
// (ITMS-90725 on TestFlight build 1264). Both run on hosted Macs only, so the
// decisions are pinned here with no Xcode present.

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const run = (script: string, args: string[]) =>
	spawnSync(process.execPath, [here(script), ...args], { encoding: "utf8" });

describe("ios-sdk-floor", () => {
	it("reads the major of a dotted SDK version and refuses anything else", () => {
		expect(sdkMajor("27.1")).toBe(27);
		expect(sdkMajor("26.5\n")).toBe(26);
		expect(sdkMajor("27")).toBe(27);
		expect(sdkMajor("")).toBeNull();
		expect(sdkMajor("xcrun: error")).toBeNull();
	});

	it("fails the exact SDK Apple warned about and passes 27+", () => {
		expect(checkFloor(27, { iphoneos: "26.5" }).ok).toBe(false);
		expect(
			checkFloor(27, { iphoneos: "27.0", iphonesimulator: "27.1" }).ok,
		).toBe(true);
		// One stale SDK is enough to fail.
		expect(
			checkFloor(27, { iphoneos: "27.0", iphonesimulator: "26.6" }).ok,
		).toBe(false);
		expect(checkFloor(27, { iphoneos: "garbage" }).ok).toBe(false);
	});

	it("exits non-zero from the CLI below the floor and zero at it", () => {
		const below = run("ios-sdk-floor.ts", [
			"--min",
			"27",
			"--sdk-version",
			"26.5",
		]);
		expect(below.status).toBe(1);
		expect(below.stdout).toContain("ITMS-90725");
		const at = run("ios-sdk-floor.ts", [
			"--min",
			"27",
			"--sdk-version",
			"27.0",
		]);
		expect(at.status).toBe(0);
		expect(run("ios-sdk-floor.ts", ["--sdk-version", "27.0"]).status).toBe(2);
	});
});

describe("ios-simulator --min-os", () => {
	const dir = mkdtempSync(join(tmpdir(), "ios-simulator-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));
	const fixture = (devices: Record<string, unknown>) => {
		const file = join(dir, `${Object.keys(devices).join("_")}.json`);
		writeFileSync(file, JSON.stringify({ devices }));
		return file;
	};
	const ios26 = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
	const ios27 = "com.apple.CoreSimulator.SimRuntime.iOS-27-1";
	const device = (name: string, udid: string) => ({
		name,
		udid,
		isAvailable: true,
	});

	it("skips an older runtime that has the preferred name when a 27 runtime does not", () => {
		const file = fixture({
			[ios26]: [device("iPhone 17", "OLD")],
			[ios27]: [device("iPhone 18", "NEW")],
		});
		// Control: without the floor the preferred name wins and drags the gate to iOS 26.
		expect(
			run("ios-simulator.ts", ["--prefer", "iPhone 17", "--json-file", file])
				.stdout,
		).toContain("os=26.5");
		const floored = run("ios-simulator.ts", [
			"--prefer",
			"iPhone 17",
			"--min-os",
			"27",
			"--json-file",
			file,
		]);
		expect(floored.status).toBe(0);
		expect(floored.stdout).toContain("os=27.1");
		expect(floored.stdout).toContain("udid=NEW");
	});

	it("fails rather than falling back when no runtime meets the floor", () => {
		const file = fixture({ [ios26]: [device("iPhone 17", "OLD")] });
		const result = run("ios-simulator.ts", [
			"--prefer",
			"iPhone 17",
			"--min-os",
			"27",
			"--json-file",
			file,
		]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("no available iOS 27+ simulator");
	});
});
