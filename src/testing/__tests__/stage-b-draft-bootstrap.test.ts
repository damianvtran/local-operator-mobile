import { describe, expect, it } from "vitest";
import {
	installStageBDraftProof,
	stageBKeychainPreflight,
} from "../stage-b-draft-bootstrap";
import {
	assertStageBEmbeddedConfig,
	STAGE_B_BUNDLE,
	type StageBProofConfig,
	stageBSeedFailure,
} from "../stage-b-draft-transport";

const config: StageBProofConfig = {
	flavor: "stage-b-draft-proof",
	bundleId: STAGE_B_BUNDLE,
	sourceSha: "a".repeat(40),
	nonce: "b".repeat(32),
	fixtureOrigin: "http://127.0.0.1:12345",
};

describe("Stage B synchronous transport installation", () => {
	it("writes, reads and removes the throwaway key before a seed can proceed", async () => {
		let value: string | null = null;
		const operations: string[] = [];
		await stageBKeychainPreflight(
			{
				write: async () => {
					operations.push("write");
					value = "throwaway";
				},
				read: async () => {
					operations.push("read");
					return value;
				},
				remove: async () => {
					operations.push("remove");
					value = null;
				},
			},
			"throwaway",
		);
		expect(operations).toEqual(["write", "read", "remove", "read"]);
		expect(value).toBeNull();
	});
	it("preserves the original entitlement failure even when cleanup also fails", async () => {
		const entitlement = new Error(
			"KeyChainException errSecMissingEntitlement -34018",
		);
		let removed = false;
		await expect(
			stageBKeychainPreflight(
				{
					write: async () => {
						throw entitlement;
					},
					read: async () => null,
					remove: async () => {
						removed = true;
						throw new Error("cleanup also denied");
					},
				},
				"throwaway",
			),
		).rejects.toBe(entitlement);
		expect(removed).toBe(true);
	});
	it("refuses a mismatched keychain round-trip", async () => {
		let removed = false;
		await expect(
			stageBKeychainPreflight(
				{
					write: async () => {},
					read: async () => "wrong",
					remove: async () => {
						removed = true;
					},
				},
				"expected",
			),
		).rejects.toThrow("keychain preflight round-trip mismatch");
		expect(removed).toBe(true);
	});
	it("accepts the same embedded identity reserialized by native NSDictionary", () => {
		const reordered = Object.fromEntries(Object.entries(config).reverse());
		expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(config)); // Old guard refuses it.
		expect(() =>
			assertStageBEmbeddedConfig(reordered, STAGE_B_BUNDLE, config),
		).not.toThrow();
		for (const changed of [
			{ ...reordered, nonce: "c".repeat(32) },
			{ ...reordered, extra: "unknown" },
			{ ...reordered, fixtureOrigin: "https://foreign.invalid" },
		])
			expect(() =>
				assertStageBEmbeddedConfig(changed, STAGE_B_BUNDLE, config),
			).toThrow("identity");
	});
	it("redacts on-screen and console seed errors before either surface sees them", () => {
		const failure = stageBSeedFailure(
			new Error(
				`Bearer top-secret token=also-secret ${"a".repeat(32)} stage-b-synthetic-${"b".repeat(32)}-access`,
			),
		);
		expect(failure.message).not.toContain("top-secret");
		expect(failure.message).not.toContain("also-secret");
		expect(failure.message).not.toContain("a".repeat(32));
		expect(failure.message).not.toContain("stage-b-synthetic");
	});
	it("patches fetch before returning the deferred seed initializer, without network I/O", () => {
		const original = globalThis.fetch;
		let requests = 0;
		const nativeFetch: typeof fetch = async () => {
			requests++;
			throw new Error("unexpected seed I/O");
		};
		globalThis.fetch = nativeFetch;
		try {
			const initialize = installStageBDraftProof(config);
			expect(globalThis.fetch).not.toBe(nativeFetch);
			expect(typeof initialize).toBe("function");
			expect(requests).toBe(0);
		} finally {
			globalThis.fetch = original;
		}
	});
});
