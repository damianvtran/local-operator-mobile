import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	seedStageBDocument,
	simulatorSeedLookup,
} from "./stage-b-document-seed.ts";
import {
	awaitProviderRegistration,
	resolveFilesApplication,
	resolveFilesBundleId,
} from "./stage-b-provider-registration.ts";

/** A captured old-style NeXTSTEP sample, as `simctl listapps` prints it. */
const NEXSTEP_SAMPLE = `{
    "com.apple.DocumentsApp" =     {
        ApplicationType = System;
        CFBundleDisplayName = Files;
        CFBundleIdentifier = "com.apple.DocumentsApp";
        CFBundleName = Files;
    };
    "com.apple.mobilesafari" =     {
        CFBundleDisplayName = Safari;
        CFBundleIdentifier = "com.apple.mobilesafari";
    };
}`;

const files = { "com.apple.DocumentsApp": { CFBundleDisplayName: "Files" } };

describe("provider registration before seeding", () => {
	it("uses the already-registered provider without launching Files", async () => {
		let launches = 0;
		const outcome = await awaitProviderRegistration({
			probe: () => "local",
			launch: () => {
				launches += 1;
				return { filesApp: "com.apple.DocumentsApp", stage: "launched" };
			},
		});
		expect(outcome.needed).toBe(false);
		expect(outcome.provider).toBe("local");
		expect(launches).toBe(0);
	});
	it("launches Files once and records how long registration took", async () => {
		let t = 0;
		let polls = 0;
		const outcome = await awaitProviderRegistration({
			probe: () => {
				polls += 1;
				return polls >= 3 ? "local" : null;
			},
			launch: () => ({ filesApp: "com.apple.DocumentsApp", stage: "launched" }),
			capMs: 10_000,
			intervalMs: 1_000,
			now: () => (t += 1_000),
			sleep: async () => {},
		});
		expect(outcome.needed).toBe(true);
		expect(outcome.filesApp).toBe("com.apple.DocumentsApp");
		expect(outcome.provider).toBe("local");
		expect(outcome.elapsedMs).toBeGreaterThan(0);
		expect(outcome.polls).toBeGreaterThanOrEqual(3);
	});
	it("stops at once when no Files app resolves, instead of polling a known absence", async () => {
		let probes = 0;
		const outcome = await awaitProviderRegistration({
			probe: () => {
				probes += 1;
				return null;
			},
			launch: () => ({ filesApp: null, stage: "resolve" }),
			capMs: 60_000,
			sleep: async () => {
				throw new Error("must not poll without a launch");
			},
		});
		expect(outcome.needed).toBe(true);
		expect(outcome.filesApp).toBeNull();
		expect(outcome.provider).toBeNull();
		expect(probes).toBe(1);
	});
	it("converts the real NeXTSTEP listapps output through plutil before parsing", () => {
		// R38-1: `simctl listapps` has no --json flag. This runs the actual
		// `plutil -convert json` on a captured sample, so a parse that only works
		// on JSON input cannot pass. Skipped only where plutil is absent.
		const plutil = ["/usr/bin/plutil", "/usr/local/bin/plutil"].find((path) =>
			existsSync(path),
		);
		if (!plutil) {
			console.warn("plutil absent: skipping the real conversion path");
			return;
		}
		const resolution = resolveFilesApplication({
			listapps: () => NEXSTEP_SAMPLE,
			convert: (plist) => {
				try {
					return execFileSync(plutil, ["-convert", "json", "-o", "-", "-"], {
						encoding: "utf8",
						input: plist,
						stdio: ["pipe", "pipe", "ignore"],
					});
				} catch {
					return null;
				}
			},
			launch: () => {},
		});
		expect(resolution.stage).toBe("launched");
		expect(resolution.filesApp).toBe("com.apple.DocumentsApp");
	});
	it("names the step that failed instead of collapsing to null", () => {
		const convertFails = resolveFilesApplication({
			listapps: () => NEXSTEP_SAMPLE,
			convert: () => null,
			launch: () => {},
		});
		expect(convertFails.stage).toBe("convert");
		const listappsFails = resolveFilesApplication({
			listapps: () => {
				throw new Error("simctl unavailable");
			},
			convert: () => "{}",
			launch: () => {},
		});
		expect(listappsFails.stage).toBe("listapps");
		expect(listappsFails.detail).toContain("simctl unavailable");
		const parseFails = resolveFilesApplication({
			listapps: () => "not a plist",
			convert: () => "not json",
			launch: () => {},
		});
		expect(parseFails.stage).toBe("parse");
		const resolveFails = resolveFilesApplication({
			listapps: () => NEXSTEP_SAMPLE,
			convert: () => JSON.stringify({ "com.example.other": {} }),
			launch: () => {},
		});
		expect(resolveFails.stage).toBe("resolve");
		const launchFails = resolveFilesApplication({
			listapps: () => NEXSTEP_SAMPLE,
			convert: () => JSON.stringify(files),
			launch: () => {
				throw new Error("launch refused");
			},
		});
		expect(launchFails.stage).toBe("launch");
		expect(launchFails.detail).toContain("launch refused");
	});
	it("resolves Files from the device inventory, never from a hardcoded guess", () => {
		expect(resolveFilesBundleId(files)).toBe("com.apple.DocumentsApp");
		expect(resolveFilesBundleId({ "com.example.other": {} })).toBeNull();
	});
	it("a warm-up that never registers still fails the seed, naming the wait", () => {
		// The warm-up cannot turn a genuinely missing provider into a silent pass:
		// the seeder throws, and the message says why it is still missing.
		const root = mkdtempSync(join(tmpdir(), "stage-b-seed-none-"));
		try {
			const dataRoot = join(root, "data");
			rmSync(dataRoot, { recursive: true, force: true });
			expect(() =>
				seedStageBDocument(dataRoot, simulatorSeedLookup(dataRoot), {
					needed: true,
					filesApp: "com.apple.DocumentsApp",
					elapsedMs: 60_000,
					polls: 60,
				}),
			).toThrow(/providerRegistration: unavailable/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
