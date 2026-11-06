import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	seedStageBDocument,
	simulatorSeedLookup,
} from "./stage-b-document-seed.ts";
import {
	awaitProviderRegistration,
	resolveFilesBundleId,
} from "./stage-b-provider-registration.ts";

const files = { "com.apple.DocumentsApp": { CFBundleDisplayName: "Files" } };

describe("provider registration before seeding", () => {
	it("uses the already-registered provider without launching Files", async () => {
		let launches = 0;
		const outcome = await awaitProviderRegistration({
			probe: () => "local",
			launch: () => {
				launches += 1;
				return "com.apple.DocumentsApp";
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
			launch: () => "com.apple.DocumentsApp",
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
			launch: () => null,
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
