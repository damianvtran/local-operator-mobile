import { describe, expect, it } from "vitest";
import { embeddedHost } from "./embedded-host.ts";

const template = `class MainApplication { val reactHost = ExpoReactHostFactory.getDefaultReactHost(
  context = applicationContext,
  packageList = PackageList(this).packages
) }`;

describe("hosted embedded Android proof host", () => {
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
