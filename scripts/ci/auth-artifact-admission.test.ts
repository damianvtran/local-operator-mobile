import {
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	credentialActivityIsMasked,
	observeAuthRequests,
} from "./auth-save-contract.ts";
import { transportAuthorities } from "./theme-transport-contract.ts";
import { directTransportTest } from "./transport-xctest-host.ts";

const workflow = readFileSync(
	new URL("../../.github/workflows/e2e.yml", import.meta.url),
	"utf8",
);

const RUNNER_TEMP_EXPRESSION = /\$\{\{ runner\.temp \}\}/g;
const AUTH_STAGE_EXPRESSION =
	/\$\{\{ inputs\.proof_stage (==|!=) 'auth-save-xctest' && format\('([^']*)', runner\.temp\) \|\| (?:format\('([^']*)', runner\.temp\)|'([^']*)') \}\}/g;
const AUTH_FAILURE_GUARD = /if \(authSave\) \{[^}]*return;/;

/** Evaluate the actual theme upload step's constrained path expressions, then
 * expand its globs against real files. A filename/secure-field assumption must
 * never substitute for the credential audit, including on the failure path. */
function admitted(root: string, auth: boolean): string[] {
	const block = workflow
		.split("  theme-ios-proof:\n")[1]
		?.split("  u08-geometry-proof:")[0];
	if (!block) throw new Error("theme upload job missing");
	const paths = block
		.split("          path: |\n")[1]
		?.split("          retention-days:")[0];
	if (!paths) throw new Error("theme upload paths missing");
	const patterns = paths.split("\n").map((line) =>
		line
			.trim()
			.replace(RUNNER_TEMP_EXPRESSION, () => root)
			.replace(
				AUTH_STAGE_EXPRESSION,
				(_match, operator, yes, noFormat, noLiteral) => {
					const matches = operator === "==" ? auth : !auth;
					return String(matches ? yes : (noFormat ?? noLiteral)).replaceAll(
						"{0}",
						root,
					);
				},
			),
	);
	for (const pattern of patterns)
		if (pattern.includes("${{")) throw new Error("unhandled upload expression");
	return [
		...new Set(
			patterns.filter(Boolean).flatMap((pattern) => globSync(pattern)),
		),
	]
		.filter((file) => !file.endsWith("/"))
		.map((file) => relative(root, file))
		.sort();
}

const scratch = () =>
	mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "auth-admission-"),
	);
const seed = (root: string, path: string, data = "synthetic-unverified") => {
	const file = join(root, "theme-proof", path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
};

describe("auth-save artifact admission", () => {
	it("admits nothing after failed audit, even UUID PNGs and failure-auth screenshots/text", () => {
		const root = scratch();
		seed(root, "frames/xctest/ABCDEF12-1234-1234-1234-ABCDEF123456.png");
		seed(root, "frames/xctest/credential-activity.txt");
		seed(root, "frames/failure-auth-save.png");
		seed(root, "hierarchies/failure-auth-save.txt");
		seed(root, "transport.xcresult/raw.txt");
		expect(admitted(root, true)).toEqual([]);
	});

	it("admits only the proven audit roots, never neighboring unaudited images/text", () => {
		const root = scratch();
		seed(root, "frames/auth-verified/proven.png");
		seed(root, "safe-auth.xcresult/proven.json", "{}");
		seed(root, "frames/xctest/ABCDEF12-1234-1234-1234-ABCDEF123456.png");
		seed(root, "frames/failure-auth-save.png");
		seed(root, "hierarchies/failure-auth-save.txt");
		seed(root, "transport.xcresult/raw.txt");
		const files = admitted(root, true);
		expect(files).toContain("theme-proof/frames/auth-verified/proven.png");
		expect(files).toContain("theme-proof/safe-auth.xcresult/proven.json");
		expect(
			files.every(
				(path) =>
					path.startsWith("theme-proof/frames/auth-verified") ||
					path.startsWith("theme-proof/safe-auth.xcresult"),
			),
		).toBe(true);
	});

	it("keeps the existing unauthenticated transport/failure evidence paths", () => {
		const root = scratch();
		seed(root, "frames/xctest/native.png");
		seed(root, "frames/failure-transport.png");
		seed(root, "hierarchies/failure-transport.txt");
		seed(root, "transport.xcresult/raw.txt");
		expect(admitted(root, false)).toEqual(
			expect.arrayContaining([
				"theme-proof/frames/xctest/native.png",
				"theme-proof/frames/failure-transport.png",
				"theme-proof/hierarchies/failure-transport.txt",
				"theme-proof/transport.xcresult/raw.txt",
			]),
		);
	});

	it("never captures an auth failure image or hierarchy without independent privacy proof", () => {
		const runner = readFileSync(
			new URL("./theme-ios-proof.ts", import.meta.url),
			"utf8",
		);
		const failure = runner.slice(
			runner.indexOf("async function captureFailure("),
			runner.indexOf("async function authenticatedSaveProbe("),
		);
		expect(failure).toMatch(AUTH_FAILURE_GUARD);
		expect(failure.indexOf("if (authSave)")).toBeLessThan(
			failure.indexOf("await run("),
		);
	});

	it.each([false, true])(
		"real host audit proven=%s: admits only privacy-verified evidence",
		async (proven) => {
			const parent = scratch();
			const root = join(parent, "theme-proof");
			mkdirSync(root);
			const receipt: Record<string, unknown> = {};
			const operation = directTransportTest({
				root,
				udid: "synthetic-owned",
				appId: "synthetic-app",
				authorities: transportAuthorities(
					43123,
					"http://synthetic.local:43123",
				),
				closeListener: async () => {},
				receipt,
				authSave: {
					password: "synthetic-run-only-password",
					observer: observeAuthRequests(createServer()),
				},
				run: async (name) => {
					if (name === "xctest-generate") {
						mkdirSync(join(root, "carrier"));
						writeFileSync(
							join(root, "carrier", "target-graph.json"),
							JSON.stringify([
								{
									name: "TransportCarrier",
									product_type: "com.apple.product-type.application",
									dependencies: [],
								},
								{
									name: "TransportUITests",
									product_type: "com.apple.product-type.bundle.ui-testing",
									dependencies: ["TransportCarrier"],
								},
							]),
						);
					}
					if (name === "xctest-selected-test") {
						mkdirSync(join(root, "transport.xcresult"));
						receipt.credentialActivityMasked = credentialActivityIsMasked(
							"XCT_CREDENTIAL_ENTRY_BEGIN\nType '••••'\nXCT_CREDENTIAL_ENTRY_END",
						);
					}
					if (name === "xctest-export-attachments") {
						seed(
							parent,
							"frames/xctest/ABCDEF12-1234-1234-1234-ABCDEF123456.png",
						);
						seed(parent, "frames/xctest/activity.txt");
						if (proven) {
							const names = [
								"welcome-ready",
								"auth-connected",
								"auth-home",
								"auth-sidebar",
							];
							const png = Buffer.from(
								"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP90AAAAASUVORK5CYII=",
								"base64",
							);
							for (const name of names)
								writeFileSync(
									join(root, "frames", "xctest", `${name}.png`),
									png,
								);
							seed(
								parent,
								"frames/xctest/manifest.json",
								JSON.stringify([
									{
										attachments: names.map((name) => ({
											suggestedHumanReadableName: `${name}_0.png`,
											exportedFileName: `${name}.png`,
										})),
									},
								]),
							);
						}
					}
					if (name.startsWith("xctest-auth-privacy-")) {
						if (!proven) throw new Error("synthetic-audit-failure");
						return JSON.stringify({
							title: { _value: "credential-entry" },
							activity: { _value: "Type '••••' into secure field" },
						});
					}
					return "";
				},
			});
			if (proven) {
				await operation;
				expect(receipt.privateXcresultProven).toBe(true);
				// A failed later flow can leave neighbors: audit success must not
				// accidentally admit those unaudited captures through another glob.
				seed(parent, "frames/failure-auth-save.png");
				seed(parent, "hierarchies/failure-auth-save.txt");
				const evidence = admitted(parent, true).filter(
					(path) => !path.startsWith("theme-proof/carrier/"),
				);
				expect(evidence).toContain(
					"theme-proof/frames/auth-verified/auth-home.png",
				);
				expect(
					evidence.every(
						(path) =>
							path.startsWith("theme-proof/frames/auth-verified") ||
							path.startsWith("theme-proof/safe-auth.xcresult"),
					),
				).toBe(true);
			} else {
				await expect(operation).rejects.toThrow(
					"credential privacy prerequisite failed",
				);
				expect(receipt.privateXcresultProven).toBe(false);
				expect(existsSync(join(root, "frames", "xctest"))).toBe(false);
				expect(
					existsSync(
						join(
							parent,
							"auth-credential-attachments-quarantine",
							"ABCDEF12-1234-1234-1234-ABCDEF123456.png",
						),
					),
				).toBe(true);
				// Static target-graph metadata is allowed; no image, hierarchy or
				// raw result bytes may be admitted on failed privacy proof.
				expect(
					admitted(parent, true).filter(
						(path) => !path.startsWith("theme-proof/carrier/"),
					),
				).toEqual([]);
			}
		},
	);
});
