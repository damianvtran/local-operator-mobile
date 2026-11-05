import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRelay } from "../../tools/mock-relay/relay.ts";
import {
	assertAuthSaveProof,
	assertPrivateCredentialActivities,
	credentialActivityIsMasked,
	observeAuthRequests,
	redactCredentialActivity,
} from "./auth-save-contract.ts";
import { themeProofPlan } from "./theme-proof-contract.ts";
import { directXCTestPlan } from "./transport-xctest-contract.ts";

describe("one native authenticated saved-route probe", () => {
	it("selects one serial auth method, never transport repeats or a full matrix", () => {
		const p = directXCTestPlan(
			"/owned/project.xcodeproj",
			"owned-udid",
			"/owned",
			false,
			true,
		);
		expect(p.test.filter((x) => x.startsWith("-only-testing:"))).toEqual([
			"-only-testing:TransportUITests/TransportUITests/testAuthenticatedSave",
		]);
		expect(
			p.test.filter((x) => /iterations|retry|repetition|relaunch/.test(x)),
		).toEqual([]);
		expect(themeProofPlan("auth-save-xctest")).toEqual({
			stage: "auth-save-xctest",
			flow: null,
			budgetSeconds: 900,
			frames: ["welcome-ready", "auth-connected", "auth-home", "auth-sidebar"],
		});
	});
	it("refuses unmasked or missing semantic credential activity and raw credential strings", () => {
		const masked = {
			title: { _value: "credential-entry" },
			subActivities: {
				_values: [{ title: { _value: "Type '•' into SecureTextField" } }],
			},
		};
		expect(() =>
			assertPrivateCredentialActivities([masked], "private-test-value"),
		).not.toThrow();
		expect(() =>
			assertPrivateCredentialActivities([], "private-test-value"),
		).toThrow();
		expect(() =>
			assertPrivateCredentialActivities(
				[
					{
						title: { _value: "credential-entry" },
						subActivities: {
							_values: [{ title: { _value: "Type 'a' into SecureTextField" } }],
						},
					},
				],
				"private-test-value",
			),
		).toThrow();
		expect(() =>
			assertPrivateCredentialActivities(
				[masked, { value: "private-test-value" }],
				"private-test-value",
			),
		).toThrow();
		expect(
			credentialActivityIsMasked(
				"XCT_CREDENTIAL_ENTRY_BEGIN\nType '•' into SecureTextField\nXCT_CREDENTIAL_ENTRY_END",
			),
		).toBe(true);
		expect(
			credentialActivityIsMasked(
				"XCT_CREDENTIAL_ENTRY_BEGIN\nType 'x' into SecureTextField\nXCT_CREDENTIAL_ENTRY_END",
			),
		).toBe(false);
	});
	it("records actual fixture login303 and authenticated200 lists, excludes host/wrong-password control", async () => {
		const password = randomBytes(24).toString("hex");
		const relay = createRelay({ password, quiet: true });
		const handle = await relay.listen();
		const observer = observeAuthRequests(
			relay.handler,
			`127.0.0.1:${handle.port}`,
		);
		const origin = `http://127.0.0.1:${handle.port}`;
		try {
			const bad = await fetch(`${origin}/login`, {
				method: "POST",
				body: new URLSearchParams({ password: "deliberately-invalid" }),
				redirect: "manual",
			});
			expect(bad.status).toBe(401);
			await bad.text();
			expect(observer.snapshot().completions).toEqual([]);
			observer.beginNative();
			const login = await fetch(`${origin}/login`, {
				method: "POST",
				body: new URLSearchParams({ password }),
				redirect: "manual",
			});
			expect(login.status).toBe(303);
			await login.text();
			const cookie = login.headers.get("set-cookie")?.split(";")[0];
			if (!cookie)
				throw new Error("fixture login did not issue a session cookie");
			const list = await fetch(`${origin}/api/sessions`, {
				headers: { cookie },
			});
			expect(list.status).toBe(200);
			await list.text();
			observer.beginSave();
			const peers = await fetch(`${origin}/api/sessions?include_peers=true`, {
				headers: { cookie },
			});
			expect(peers.status).toBe(200);
			await peers.text();
			const result = observer.snapshot();
			expect(result.arrivals).toHaveLength(3);
			expect(
				result.completions.map((r) => [r.requestClass, r.status, r.stage]),
			).toEqual([
				["login", 303, "test"],
				["session-list", 200, "test"],
				["peer-list", 200, "post-save"],
			]);
			expect(JSON.stringify(result)).not.toContain(password);
			expect(JSON.stringify(result)).not.toContain(cookie);
		} finally {
			await relay.shutdown();
		}
	});
	it("never places secret prefixes into checkpoints, predicates, environment or artifact paths", () => {
		const swift = readFileSync(
			new URL("./transport-xctest/TransportUITests.swift", import.meta.url),
			"utf8",
		);
		const credential = swift.slice(
			swift.indexOf("private func enterCredential"),
			swift.indexOf("private func enterExactURL"),
		);
		expect(credential).toContain(
			'app.secureTextFields["custom-password-field"]',
		);
		expect(credential).toContain('NSPredicate(format: "value.length == %d"');
		expect(credential).not.toMatch(
			/inputCheckpoint|XCTAssertEqual\(field.value|var prefix|value == %@|setValue|UIPasteboard/,
		);
		const workflow = readFileSync(
			new URL("../../.github/workflows/e2e.yml", import.meta.url),
			"utf8",
		);
		expect(workflow).toContain("theme-proof/safe-auth.xcresult/**");
		expect(workflow).toContain("theme-proof/frames/auth-verified/**");
		const runner = readFileSync(
			new URL("./theme-ios-proof.ts", import.meta.url),
			"utf8",
		);
		expect(runner).toContain("if (operation) await operation();");
	});
	it("requires current native auth, peer/session lists, provider application and the row; no HOST substitute", () => {
		const events = [
			"method-entered",
			"welcome-ready",
			"auth-connected",
			"auth-save",
			"auth-home",
			"auth-session-row",
		].map((event) => ({ event, runnerPID: 12 }));
		const ledger = [
			{
				phase: "native-auth",
				authority: "published-local",
				requestClass: "login",
				method: "POST",
				status: 303,
			},
			{
				phase: "native-auth",
				authority: "published-local",
				stage: "post-save",
				requestClass: "peer-list",
				method: "GET",
				status: 200,
			},
			{
				phase: "native-auth",
				authority: "published-local",
				requestClass: "session-list",
				method: "GET",
				status: 200,
			},
		];
		const trace = [
			{ event: "stage", stage: "save.begin" },
			{ event: "response", requestClass: "peer-list", status: 200 },
			{ event: "stage", stage: "cold-list.applied" },
		];
		expect(() => assertAuthSaveProof(events, ledger, trace)).not.toThrow();
		for (let i = 0; i < events.length; i++)
			expect(() =>
				assertAuthSaveProof(
					events.filter((_, n) => i !== n),
					ledger,
					trace,
				),
			).toThrow();
		for (let i = 0; i < ledger.length; i++)
			expect(() =>
				assertAuthSaveProof(
					events,
					ledger.filter((_, n) => i !== n),
					trace,
				),
			).toThrow();
		expect(() =>
			assertAuthSaveProof(
				events,
				ledger.map((x) => ({ ...x, phase: "host-preflight" })),
				trace,
			),
		).toThrow();
		expect(() => assertAuthSaveProof(events, ledger, [])).toThrow();
	});
	it("never persists secure-entry activity, including an interrupted entry", () => {
		expect(
			redactCredentialActivity(
				"before\nXCT_CREDENTIAL_ENTRY_BEGIN\nType 'private'\nXCT_CREDENTIAL_ENTRY_END\nafter",
			),
		).toBe("before\n<credential-entry-redacted>\nafter");
		expect(
			redactCredentialActivity(
				"before\nXCT_CREDENTIAL_ENTRY_BEGIN\nType 'private'\n",
			),
		).toBe("before\n<credential-entry-redacted>");
	});
});
