import { describe, expect, it } from "vitest";
import {
	assertProofBuild,
	assertRestartIdentity,
	type ProofBuildIdentity,
} from "./auth-retirement-proof-contract.ts";

/* Native dispatch is forbidden until the harness can reject ordinary artifacts,
 * forged launch parameters and same-process "restart" evidence. These tests are
 * source contracts only: no simulator, Keychain or app execution is claimed. */
const proof: ProofBuildIdentity = {
	flavor: "auth-retirement-proof",
	bundleId: "com.localoperator.mobile.retirementproof",
	nonce: "0123456789abcdef0123456789abcdef",
	sourceSha: "b14ff5898f1e147ecee6a790bf0720e2455aa98c",
	bundleSha256: "a".repeat(64),
};
describe("unsigned native retirement proof admission", () => {
	it("refuses a distributable artifact even with a valid seeding nonce", () => {
		expect(() =>
			assertProofBuild({ ...proof, flavor: "ordinary" }, proof),
		).toThrow();
		expect(() =>
			assertProofBuild(
				{ ...proof, bundleId: "com.localoperator.mobile" },
				proof,
			),
		).toThrow();
	});
	it("requires compiled source, bundle digest and per-run nonce identity", () => {
		expect(() => assertProofBuild(proof, proof)).not.toThrow();
		for (const field of ["nonce", "sourceSha", "bundleSha256"] as const)
			expect(() =>
				assertProofBuild({ ...proof, [field]: "different" }, proof),
			).toThrow();
	});
	it("requires a different process on the same bundle, simulator and artifact", () => {
		const first = { ...proof, udid: "synthetic-owned-simulator", pid: 101 };
		expect(() =>
			assertRestartIdentity(first, { ...first, pid: 102 }),
		).not.toThrow();
		expect(() => assertRestartIdentity(first, first)).toThrow();
		expect(() =>
			assertRestartIdentity(first, { ...first, pid: 102, udid: "other" }),
		).toThrow();
		expect(() =>
			assertRestartIdentity(first, {
				...first,
				pid: 102,
				bundleSha256: "b".repeat(64),
			}),
		).toThrow();
	});
});

import { assertRetiredRestore } from "./auth-retirement-proof-contract.ts";

describe("retired restore verdict (host negative control)", () => {
	it("accepts only a completed unauthorized restore with zero auth transport", () => {
		expect(() =>
			assertRetiredRestore({
				phase: "retired-restore",
				ok: true,
				restored: false,
				rawOauthPresent: false,
				refreshes: 0,
				publishes: 0,
				deletes: 0,
			}),
		).not.toThrow();
	});
	it("rejects a persistent authorized account, missing fields and nonzero refresh", () => {
		for (const receipt of [
			{ phase: "persist-control", ok: true, restored: true },
			{},
			{
				phase: "retired-restore",
				ok: true,
				restored: false,
				rawOauthPresent: false,
				refreshes: 1,
				publishes: 0,
				deletes: 0,
			},
		])
			expect(() => assertRetiredRestore(receipt)).toThrow();
	});
});
