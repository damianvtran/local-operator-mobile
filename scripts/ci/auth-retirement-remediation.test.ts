import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as host from "./auth-retirement-ios-proof.ts";
import * as contracts from "./auth-retirement-proof-contract.ts";

/* Prepared during another allocation's execution slot. Do not run until the
 * explicit lightweight slot grant. RED must precede the single production batch.
 * Functions below name the narrow boundaries to be introduced, not native proof. */
const source = readFileSync(
	new URL("./auth-retirement-ios-proof.ts", import.meta.url),
	"utf8",
);
const workflow = readFileSync(
	new URL("../../.github/workflows/ios.yml", import.meta.url),
	"utf8",
);
const api = host as unknown as Record<string, (...args: unknown[]) => unknown>;
const gate = contracts as unknown as Record<
	string,
	(...args: unknown[]) => unknown
>;
const identity = {
	flavor: "auth-retirement-proof",
	bundleId: "com.localoperator.mobile.retirementproof",
	nonce: "1".repeat(32),
	sourceSha: "a".repeat(40),
	bundleSha256: "b".repeat(64),
};
describe("unified native proof review regressions", () => {
	it("R1: protocol responses must not persist log-redaction placeholders", () => {
		expect(source).not.toMatch(/refresh_token:\s*"\[redacted\]"/);
	});
	it("R1: consecutive refreshes can reuse the deliberately unrotated synthetic grant", () => {
		expect(typeof api.syntheticTokenReply).toBe("function");
		const first = api.syntheticTokenReply!("synthetic-proof-refresh") as Record<
			string,
			unknown
		>;
		const second = api.syntheticTokenReply!(
			(first.refresh_token ?? "synthetic-proof-refresh") as string,
		) as Record<string, unknown>;
		expect(first.access_token).toBeTruthy();
		expect(second.access_token).toBeTruthy();
		expect(first.refresh_token === "synthetic-proof-refresh").toBe(true);
	});
	it("S1: verifier must bind installed bytes to an independently frozen candidate digest", () => {
		expect(source).not.toContain(
			"assertProofBuild(actual, { ...expected, bundleSha256 })",
		);
		expect(workflow).toContain("--freeze-artifact");
		expect(source).toContain("get_app_container");
	});
	it("S1: frozen-vs-installed mismatch is rejected even if cached prior identity matched", () => {
		expect(typeof gate.assertInstalledArtifact).toBe("function");
		expect(() =>
			gate.assertInstalledArtifact!(
				{ ...identity, bundleSha256: "c".repeat(64) },
				identity,
			),
		).toThrow();
		expect(() =>
			gate.assertInstalledArtifact!(identity, identity),
		).not.toThrow();
	});
	it("S2: only structured verifier rejection code42 is an expected negative", () => {
		expect(typeof gate.classifyVerifierResult).toBe("function");
		const result = gate.classifyVerifierResult!({
			status: 42,
			signal: null,
			error: false,
			stdout: JSON.stringify({
				kind: "retired-restore-verdict",
				reason: "AUTHORIZED_RESTORE",
			}),
		});
		expect(result).toBe("expected-rejection");
	});
	it("S2: startup failure, timeout, parse error and wrong-phase failure are BLOCKED", () => {
		expect(typeof gate.classifyVerifierResult).toBe("function");
		for (const result of [
			{ status: null, signal: null, error: true, stdout: "" },
			{ status: null, signal: "SIGKILL", error: false, stdout: "" },
			{ status: 1, signal: null, error: false, stdout: "" },
			{ status: 42, signal: null, error: false, stdout: "not-json" },
			{
				status: 42,
				signal: null,
				error: false,
				stdout: JSON.stringify({
					kind: "retired-restore-verdict",
					reason: "WRONG_PHASE",
				}),
			},
		])
			expect(gate.classifyVerifierResult!(result)).toBe("blocked");
	});
	it("S3: workflow passes a device template, never an arbitrary proof execution UDID", () => {
		expect(workflow).not.toMatch(
			/--run "\$app" "\$\{\{ steps\.simulator\.outputs\.udid \}\}"/,
		);
		expect(source).toContain('"create"');
	});
	it("S3: teardown authority binds a fresh-device lease to this host PID and nonce", () => {
		expect(typeof gate.assertOwnedLease).toBe("function");
		const lease = {
			udid: "fresh-owned-device",
			hostPid: process.pid,
			nonce: identity.nonce,
		};
		expect(() => gate.assertOwnedLease!(lease, { ...lease })).not.toThrow();
		for (const forged of [
			{ ...lease, udid: "operator-device" },
			{ ...lease, hostPid: 1 },
			{ ...lease, nonce: "other" },
		])
			expect(() => gate.assertOwnedLease!(forged, lease)).toThrow();
	});
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshRadientTokens } from "../../src/connection/radient-oauth.ts";

describe("real host-path discriminators (no simulator)", () => {
	it("R1 counterevidence: two production parser refreshes retain a coherent synthetic grant", async () => {
		let held = {
			access: "synthetic",
			refresh: "synthetic-proof-refresh",
			expires_at: 0,
			scope: "openid",
			token_type: "Bearer",
			account_label: null,
			account_id: "native-proof-account",
		};
		let requests = 0;
		const fetchImpl: typeof fetch = async (_url, init) => {
			const body = JSON.parse(String(init?.body));
			expect(body.refresh_token === "synthetic-proof-refresh").toBe(true);
			requests += 1;
			return new Response(
				JSON.stringify(host.syntheticTokenReply(body.refresh_token)),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		};
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const next = await refreshRadientTokens(held, {
				fetchImpl,
				tokenUrl: "https://synthetic.invalid/token",
			});
			expect(next.refresh === "synthetic-proof-refresh").toBe(true);
			expect(next.account_id === "native-proof-account").toBe(true);
			held = {
				...held,
				...next,
				refresh: next.refresh!,
				account_id: next.account_id!,
				account_label: null,
			};
		}
		expect(requests).toBe(2);
	});
	it("S1 actual host content read rejects changed candidate and installed copy", () => {
		const dir = mkdtempSync(
			join(
				process.env.LOCAL_OPERATOR_SCRATCHPAD ??
					process.env.RUNNER_TEMP ??
					tmpdir(),
				"immutable-app-",
			),
		);
		const path = join(dir, "main.jsbundle");
		writeFileSync(path, "compiled-proof-source");
		const frozen = {
			...identity,
			bundleSha256: host.immutableBundleDigest(dir),
		};
		expect(() => host.assertFrozenContent(dir, frozen)).not.toThrow();
		writeFileSync(path, "compiled-proof-source-mutated-but-markers-remain");
		expect(() => host.assertFrozenContent(dir, frozen)).toThrow();
	});
	it("S2 same CLI pair discriminates state and startup failure/timeout", () => {
		const dir = mkdtempSync(
			join(
				process.env.LOCAL_OPERATOR_SCRATCHPAD ??
					process.env.RUNNER_TEMP ??
					tmpdir(),
				"verifier-pair-",
			),
		);
		const path = join(dir, "receipt.json");
		const retired = {
			phase: "retired-restore",
			ok: true,
			restored: false,
			rawOauthPresent: false,
			refreshes: 0,
			publishes: 0,
			deletes: 0,
		};
		writeFileSync(
			path,
			JSON.stringify({ ...retired, restored: true, rawOauthPresent: true }),
		);
		expect(host.verifierProcess(path)).toBe("expected-rejection");
		writeFileSync(path, JSON.stringify(retired));
		expect(host.verifierProcess(path)).toBe("accepted");
		expect(
			host.verifierProcess(path, { executable: join(dir, "nonexistent") }),
		).toBe("blocked");
		expect(
			host.verifierProcess(path, {
				prefix: ["-e", "setInterval(()=>{},1000)", "--"],
				timeout: 50,
			}),
		).toBe("blocked");
		writeFileSync(path, "bad-json");
		expect(host.verifierProcess(path)).toBe("blocked");
	});
});
