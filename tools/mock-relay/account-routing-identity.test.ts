import { describe, expect, it } from "vitest";
import { validateCustomBaseUrl } from "../../src/connection/profile.ts";
import {
	assertDedicatedNativeCI,
	assertPolicyFixtureIdentity,
	policyIdentity,
	requirePolicyTransport,
} from "./account-routing-identity.ts";

const NONCE = "0123456789abcdef0123456789abcdef";
const OTHER = "abcdef0123456789abcdef0123456789";
const hosted: NodeJS.ProcessEnv = {
	NODE_ENV: "test",
	GITHUB_ACTIONS: "true",
	RUNNER_ENVIRONMENT: "github-hosted",
	RUNNER_OS: "macOS",
	LOH12_NATIVE_PROOF_ADMITTED: "1",
};

describe("strict proof transport identities (pure source, no mDNS)", () => {
	it("keeps browser/default .localhost bytes and namespace", () => {
		const identity = policyIdentity(NONCE, "a");
		expect(identity.hostname).toBe(`loh12-${NONCE}-a.localhost`);
		expect(() =>
			assertPolicyFixtureIdentity(identity.hostname, identity.cookieName),
		).not.toThrow();
	});
	it("executes the actual shipped form rejection before proposing .local", () => {
		const ordinary = policyIdentity(NONCE, "a");
		const native = policyIdentity(NONCE, "a", "ci-native-mdns");
		expect(
			validateCustomBaseUrl(`http://${ordinary.hostname}:41234`, {
				allowInsecure: true,
			}).ok,
		).toBe(false);
		expect(
			validateCustomBaseUrl(`http://${native.hostname}:41234`, {
				allowInsecure: true,
			}).ok,
		).toBe(true);
		expect(validateCustomBaseUrl(`http://${native.hostname}:41234`).ok).toBe(
			false,
		);
	});
	it("requires explicit name mode and coherent nonce/slot for both transports", () => {
		for (const mode of ["localhost", "ci-native-mdns"] as const) {
			const a = policyIdentity(NONCE, "a", mode),
				b = policyIdentity(OTHER, "b", mode);
			expect(() =>
				assertPolicyFixtureIdentity(a.hostname, b.cookieName, mode),
			).toThrow();
			expect(() =>
				assertPolicyFixtureIdentity(
					a.hostname,
					policyIdentity(NONCE, "b", mode).cookieName,
					mode,
				),
			).toThrow();
		}
		const native = policyIdentity(NONCE, "a", "ci-native-mdns");
		expect(() =>
			assertPolicyFixtureIdentity(native.hostname, native.cookieName),
		).toThrow();
	});
	it.each([
		"localhost",
		"127.0.0.1",
		"synthetic.local",
		`loh12-${NONCE}-a.local.evil.invalid`,
	])("refuses arbitrary/shared host %s", (hostname) => {
		expect(() =>
			assertPolicyFixtureIdentity(
				hostname,
				policyIdentity(NONCE, "a").cookieName,
				"ci-native-mdns",
			),
		).toThrow();
	});
	it("rejects production cookies and malformed nonce even in dedicated CI", () => {
		expect(() =>
			assertPolicyFixtureIdentity(
				policyIdentity(NONCE, "a", "ci-native-mdns").hostname,
				"lop_mobile",
				"ci-native-mdns",
			),
		).toThrow();
		expect(() => policyIdentity("not-a-nonce", "a")).toThrow();
		expect(() => requirePolicyTransport("unsafe-hostname-option")).toThrow();
	});
	it("has no operator/self-hosted/admission-free execution escape", () => {
		expect(() => assertDedicatedNativeCI(hosted)).not.toThrow();
		for (const [key, value] of [
			["GITHUB_ACTIONS", "false"],
			["RUNNER_ENVIRONMENT", "self-hosted"],
			["RUNNER_OS", "Linux"],
			["LOH12_NATIVE_PROOF_ADMITTED", "0"],
		] as const)
			expect(() =>
				assertDedicatedNativeCI({ ...hosted, [key]: value }),
			).toThrow();
	});
});
