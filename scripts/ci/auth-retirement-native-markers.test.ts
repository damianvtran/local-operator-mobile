import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const plugin = require("./auth-retirement-native-markers.cjs") as ((config: {
	ios?: { bundleIdentifier?: string };
}) => Record<string, unknown>) & {
	instrument: (source: string, language: string) => string;
};
const archive = join(
	dirname(require.resolve("expo/package.json")),
	"template.tgz",
);
// Installed archive only, extracted to memory. No prebuild, SDK, network or app.
const original = execFileSync(
	"tar",
	["-xOf", archive, "package/ios/HelloWorld/AppDelegate.swift"],
	{ encoding: "utf8", maxBuffer: 1048576 },
);
const ingress = 'NSLog("loretirementproof-native-ingress")';
const ready = 'NSLog("loretirementproof-native-log-ready")';
afterEach(() => vi.unstubAllEnvs());
describe("proof-only native markers against installed Expo57 plain AppDelegate", () => {
	it("proof JS callback logs only a constant before receive and calibrates before listener-ready", () => {
		const source = readFileSync(
			new URL("../../src/testing/auth-retirement-proof.ts", import.meta.url),
			"utf8",
		);
		const callback = source.match(
			/Linking\.addEventListener\("url", \(\{ url \}\) => \{([\s\S]*?)\n\t\}\);/,
		)?.[1];
		expect(callback).toBeDefined();
		if (!callback) throw new Error("Proof callback fixture missing");
		expect(callback).toMatch(
			/if \(staticIdentityValid\(\)\)\s*console\.info\("loretirementproof-js-callback-entry"\);/,
		);
		expect(
			callback.indexOf('console.info("loretirementproof-js-callback-entry")'),
		).toBeLessThan(callback.indexOf("void receive(url)"));
		expect(callback.match(/console\.info\([^;]+/g)).toEqual([
			'console.info("loretirementproof-js-callback-entry")',
		]);
		expect(source).toMatch(
			/if \(staticIdentityValid\(\)\)\s*console\.info\("loretirementproof-js-log-ready"\);/,
		);
		expect(
			source.indexOf('console.info("loretirementproof-js-log-ready")'),
		).toBeLessThan(source.indexOf('void postMarker("/ready"'));
		const pkg = JSON.parse(
			readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
		);
		expect(pkg.main).toBe("expo-router/entry");
		expect(
			readFileSync(new URL("../../app/_layout.tsx", import.meta.url), "utf8"),
		).not.toContain("auth-retirement-proof");
	});

	it("instruments once, retains all original code and forwarding bytes, and is idempotent", () => {
		const modified = plugin.instrument(original, "swift");
		expect(modified.split(ingress)).toHaveLength(2);
		expect(modified.split(ready)).toHaveLength(2);
		expect(plugin.instrument(modified, "swift")).toBe(modified);
		const forwarding =
			/ {4}return super\.application\(app, open: url, options: options\).*$/m.exec(
				original,
			)?.[0];
		expect(forwarding).toBeDefined();
		expect(modified).toContain(forwarding!);
		expect(modified.indexOf(ingress)).toBeLessThan(
			modified.indexOf(forwarding!),
		);
		expect(
			modified.replace(`    ${ingress}\n`, "").replace(`    ${ready}\n`, ""),
		).toBe(original);
	});
	it.each(["objc", "objcpp", "unknown"])(
		"fails closed for unsupported language %s",
		(language) => {
			expect(() => plugin.instrument(original, language)).toThrow(
				"require Swift",
			);
		},
	);
	it("fails closed for absent or ambiguous targets and a changed forwarding expression", () => {
		expect(() =>
			plugin.instrument(
				original.replace("open url: URL", "opened url: URL"),
				"swift",
			),
		).toThrow();
		expect(() =>
			plugin.instrument(
				original.replace(
					"didFinishLaunchingWithOptions launchOptions:",
					"willFinishLaunchingWithOptions launchOptions:",
				),
				"swift",
			),
		).toThrow();
		expect(() => plugin.instrument(original + original, "swift")).toThrow();
		expect(() =>
			plugin.instrument(
				original.replace(
					"return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)",
					"return false",
				),
				"swift",
			),
		).toThrow();
	});
	it("registers the real withAppDelegate modifier only for the dedicated proof flavor", () => {
		expect(() =>
			plugin({ ios: { bundleIdentifier: "com.localoperator.mobile" } }),
		).toThrow("Dedicated proof flavor");
		vi.stubEnv("EXPO_PUBLIC_RETIREMENT_PROOF_FLAVOR", "auth-retirement-proof");
		expect(
			plugin({
				ios: { bundleIdentifier: "com.localoperator.mobile.retirementproof" },
			}),
		).toHaveProperty("mods.ios.appDelegate");
	});
	it("ordinary tracked app config does not reference the plugin", () => {
		expect(
			readFileSync(new URL("../../app.config.ts", import.meta.url), "utf8"),
		).not.toContain("auth-retirement-native-markers");
	});
});
