import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { describe, expect, it } from "vitest";
import {
	embeddedEntry,
	embeddedHost,
	embeddedOverride,
} from "./embedded-host.ts";

const template = `class MainApplication { val reactHost = ExpoReactHostFactory.getDefaultReactHost(
  context = applicationContext,
  packageList = PackageList(this).packages
) }`;

describe("hosted embedded Android proof host", () => {
	it("proves the runtime asset URL and rejects a Metro loader before routing", () => {
		const source = embeddedEntry('require("expo-router/entry");');
		const run = new Function(
			"__DEV__",
			"process",
			"require",
			"console",
			source,
		);
		let routed = 0;
		const logs: string[] = [];
		const execute = (url: string) =>
			run(
				false,
				{
					env: {
						EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN: "http://127.0.0.1:54831",
						EXPO_PUBLIC_ANDROID_EMBEDDED_PROOF: "true",
					},
				},
				(name: string) =>
					name === "react-native"
						? {
								TurboModuleRegistry: {
									getEnforcing: () => ({
										getConstants: () => ({ scriptURL: url }),
									}),
								},
							}
						: routed++,
				{ info: (message: string) => logs.push(message) },
			);
		execute("assets://index.android.bundle");
		expect(routed).toBe(1);
		expect(logs).toContain(
			"ANDROID_PROOF_BUNDLE_URL=assets://index.android.bundle",
		);
		expect(() => execute("http://localhost:8081/index.bundle")).toThrow(
			"embedded asset",
		);
		expect(routed).toBe(1);
		expect(() => embeddedEntry(source)).toThrow();
	});
	it("admits only the explicit proof define in its temporary helper; normal Release stays closed", () => {
		const original = readFileSync(
			new URL(
				"../../../src/connection/oauth-proof-override.ts",
				import.meta.url,
			),
			"utf8",
		);
		const patched = embeddedOverride(original);
		const run = (source: string, enabled: string, origin: string) => {
			const js = stripTypeScriptTypes(source).replace(
				"export function",
				"function",
			);
			return new Function(
				"__DEV__",
				"process",
				`${js};return debugOAuthProofOrigin();`,
			)(false, {
				env: {
					EXPO_PUBLIC_ANDROID_EMBEDDED_PROOF: enabled,
					EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN: origin,
				},
			});
		};
		expect(run(patched, "true", "http://127.0.0.1:54831")).toBe(
			"http://127.0.0.1:54831",
		);
		expect(run(patched, "false", "http://127.0.0.1:54831")).toBeUndefined();
		expect(run(patched, "true", "https://example.com")).toBeUndefined();
		expect(run(original, "true", "http://127.0.0.1:54831")).toBeUndefined();
		expect(() => embeddedOverride(patched)).toThrow();
	});

	it("selects the real Expo embedded loader, independently of the library's DEBUG default", () => {
		const result = embeddedHost(template);
		expect(result).toContain("useDevSupport = false,");
		expect(result).toContain('jsBundleAssetPath = "index.android.bundle",');
		expect(result).toContain("packageList = PackageList(this).packages");
		expect(template).not.toContain("useDevSupport");
	});
	it("fails closed on template drift or duplicate preparation", () => {
		expect(() => embeddedHost("unknown host")).toThrow();
		expect(() => embeddedHost(embeddedHost(template))).toThrow();
		expect(() => embeddedHost(template + template)).toThrow();
	});
});
