import { describe, expect, it } from "vitest";
import { embeddedEntry, embeddedHost } from "./embedded-host.ts";

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
				true,
				{ env: { EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN: "http://127.0.0.1:54831" } },
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
