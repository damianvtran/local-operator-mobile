import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProofDiagnostics } from "./auth-retirement-diagnostics.ts";
import {
	APP_STAGES,
	appStage,
	countRefused,
	observeOwnedProcess,
	PHASE_CAUSES,
	REFUSED_REASONS,
	receiptCause,
	receiptRefusal,
	refusedCounts,
	sanitizePhaseFailure,
} from "./auth-retirement-phase-diagnostics.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const fresh = () => {
	const root = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"phase-diagnostics-",
		),
	);
	roots.push(root);
	return root;
};
const valid = () => ({
	phase: "seed",
	ok: true,
	flavor: "auth-retirement-proof",
	sourceSha: "a".repeat(40),
	rawOauthPresent: true,
});
const secret = "UNSAFE_DIAGNOSTIC_SENTINEL";

describe("native proof observation vocabulary and privacy", () => {
	it("keeps app and host stage enums identical without importing React Native", () => {
		const text = readFileSync(
			new URL("../../src/testing/auth-retirement-proof.ts", import.meta.url),
			"utf8",
		);
		const literal =
			/export const PROOF_APP_STAGES = (\[[\s\S]*?\]) as const/.exec(text)?.[1];
		expect(literal).toBeDefined();
		expect(JSON.parse(literal!.replace(/,\s*\]/g, "]"))).toEqual(APP_STAGES);
	});
	it.each(APP_STAGES)(
		"passes through only the recognized app stage %s",
		(stage) => {
			const r = { ...valid(), ok: false, stage };
			expect(receiptRefusal(r, "seed", r.flavor, r.sourceSha)).toBeNull();
			expect(r.stage).toBe(stage);
			expect(appStage(stage)).toBe(stage);
		},
	);
	it("refuses unknown free-text stages and keeps diagnostic fallback separate", () => {
		const r = { ...valid(), stage: secret };
		expect(receiptRefusal(r, "seed", r.flavor, r.sourceSha)).toBe(
			"stage-unknown",
		);
		expect(appStage(r.stage)).toBe("other");
		const root = fresh(),
			diag = new ProofDiagnostics(root),
			counts = refusedCounts();
		countRefused(counts, "stage-unknown");
		diag.checkpoint("phase", "seed");
		diag.observePhaseFailure({
			phase: "seed",
			cause: "receipt-timeout",
			refused: counts,
		});
		diag.fail();
		for (const file of ["failure.json", "proof.json"])
			expect(readFileSync(join(root, file), "utf8")).not.toContain(secret);
		expect(
			JSON.parse(readFileSync(join(root, "failure.json"), "utf8")).phaseFailure
				.refused["stage-unknown"],
		).toBe(1);
		expect(
			receiptRefusal(
				{ ...valid(), stage: {} },
				"seed",
				"auth-retirement-proof",
				"a".repeat(40),
			),
		).toBe("coarse-type");
	});
	it.each(REFUSED_REASONS)(
		"counts refused %s without retaining request data",
		(reason) => {
			const counts = refusedCounts();
			countRefused(counts, reason);
			countRefused(counts, reason);
			expect(counts[reason]).toBe(2);
			expect(Object.keys(counts)).toEqual([...REFUSED_REASONS]);
			expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(2);
		},
	);
	it.each([
		[{ ...valid(), extra: secret }, "unknown-key"],
		[{ ...valid(), phase: "retire" }, "phase-mismatch"],
		[{ ...valid(), flavor: secret }, "flavor-mismatch"],
		[{ ...valid(), sourceSha: secret }, "source-mismatch"],
		[{ ...valid(), refreshes: 9 }, "coarse-type"],
		[null, "coarse-type"],
	] as const)(
		"rejects malformed identity/coarse receipt %#",
		(value, reason) => {
			expect(
				receiptRefusal(value, "seed", "auth-retirement-proof", "a".repeat(40)),
			).toBe(reason);
		},
	);
	it.each(PHASE_CAUSES)("retains the closed host cause %s", (cause) => {
		expect(
			sanitizePhaseFailure({ phase: "seed", cause, appStage: "exception" }),
		).toMatchObject({
			...(cause === "receiver-bind-failed" ? {} : { phase: "seed" }),
			cause,
		});
	});
	it("classifies existing host receipt predicates in their original order", () => {
		expect(receiptCause("seed", { ok: false }, 5)).toBe("phase-rejected");
		expect(receiptCause("seed", { ok: true, rawOauthPresent: true }, 1)).toBe(
			"transport-count",
		);
		expect(receiptCause("seed", { ok: true, rawOauthPresent: false }, 0)).toBe(
			"persistence-absent",
		);
		expect(
			receiptCause(
				"retire",
				{ ok: true, durableRetired: false, rawOauthPresent: false },
				1,
			),
		).toBe("durable-unconfirmed");
		expect(receiptCause("seed", valid(), 0)).toBeNull();
	});
	it.each([
		[
			"direct running",
			"123\t0\tcom.localoperator.mobile.retirementproof",
			true,
		],
		[
			"UIKit running",
			"123\t0\tUIKitApplication:com.localoperator.mobile.retirementproof[example]",
			true,
		],
		[
			"UIKit exact",
			"123\t0\tUIKitApplication:com.localoperator.mobile.retirementproof",
			true,
		],
		[
			"stopped",
			"-\t0\tUIKitApplication:com.localoperator.mobile.retirementproof[example]",
			false,
		],
		["absent", "456\t0\tunrelated", false],
		[
			"malformed pid",
			"bad\t0\tcom.localoperator.mobile.retirementproof",
			"UNOBSERVED",
		],
		[
			"zero pid",
			"0\t0\tcom.localoperator.mobile.retirementproof",
			"UNOBSERVED",
		],
		[
			"malformed status",
			"123\tbad\tcom.localoperator.mobile.retirementproof",
			"UNOBSERVED",
		],
		[
			"non-tab row",
			"123 0 UIKitApplication:com.localoperator.mobile.retirementproof",
			"UNOBSERVED",
		],
		[
			"unrelated substring",
			"123\t0\tother.com.localoperator.mobile.retirementproof",
			false,
		],
		[
			"unrelated suffix",
			"123\t0\tUIKitApplication:com.localoperator.mobile.retirementproof.other",
			false,
		],
		["command failure", null, "UNOBSERVED"],
	] as const)("observes owned process: %s", async (_name, output, expected) => {
		const calls: unknown[][] = [];
		const actual = await observeOwnedProcess("owned-udid", async (...args) => {
			calls.push(args);
			if (output === null) throw new Error(secret);
			return output;
		});
		expect(actual).toBe(expected);
		expect(calls).toEqual([
			["xcrun", ["simctl", "spawn", "owned-udid", "launchctl", "list"]],
		]);
	});
	it("writes no free text to failure.json, including enrichment after a command already failed", () => {
		const root = fresh(),
			diag = new ProofDiagnostics(root);
		diag.checkpoint("phase", "seed");
		diag.fail();
		diag.observePhaseFailure({
			phase: "seed",
			cause: "phase-rejected",
			appStage: secret,
			refused: { nonce: 2, [secret]: 3 },
			launchToOpenurlMs: 4,
			openurlToOutcomeMs: 5,
			processAliveAtTimeout: true,
			error: secret,
			stdout: secret,
		});
		const text = readFileSync(join(root, "failure.json"), "utf8");
		expect(text).not.toContain(secret);
		expect(JSON.parse(text).phaseFailure).toMatchObject({
			cause: "phase-rejected",
			appStage: "other",
			refused: { nonce: 2 },
			processAliveAtTimeout: true,
		});
		diag.checkpoint("cleanup");
		diag.observePhaseFailure({ phase: "retire", cause: "other" });
		expect(
			JSON.parse(readFileSync(join(root, "failure.json"), "utf8")).phaseFailure
				.cause,
		).toBe("phase-rejected");
	});
	it("maps arbitrary phase/cause/timing/process values to closed safe fallbacks", () => {
		const safe = sanitizePhaseFailure({
			phase: secret,
			cause: secret,
			launchToOpenurlMs: Infinity,
			openurlToOutcomeMs: -1,
			processAliveAtTimeout: secret,
		});
		expect(safe).toMatchObject({
			phase: null,
			cause: "other",
			launchToOpenurlMs: null,
			openurlToOutcomeMs: null,
			processAliveAtTimeout: "UNOBSERVED",
		});
		expect(JSON.stringify(safe)).not.toContain(secret);
	});
});
