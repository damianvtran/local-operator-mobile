import { describe, expect, it, vi } from "vitest";

const open = vi.fn();
const dismiss = vi.fn();
vi.mock("expo", () => ({
	requireNativeModule: () => ({
		open,
		dismiss,
		prepare: async () => "http://127.0.0.1:49152/callback",
	}),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-web-browser", () => ({
	openAuthSessionAsync: () => {
		throw new Error("legacy HTTP scheme callback must not open");
	},
}));

import { createSystemBrowserSession, parseCallbackUrl } from "../loopback";

describe("iOS loopback browser boundary", () => {
	it("uses the native bound listener instead of scheme-only HTTP interception", async () => {
		open.mockResolvedValue(
			"http://127.0.0.1:54549/callback?code=synthetic&state=s",
		);
		const browser = await createSystemBrowserSession();
		expect(await browser.prepareRedirect?.()).toBe(
			"http://127.0.0.1:49152/callback",
		);
		expect(
			await browser.open(
				"https://provider.example/authorize",
				"http://127.0.0.1:54549/callback",
			),
		).toContain("code=synthetic");
		expect(open).toHaveBeenCalledWith(
			"https://provider.example/authorize",
			"http://127.0.0.1:54549/callback",
		);
		await browser.dismiss();
		expect(dismiss).toHaveBeenCalled();
	});
});

const MISMATCH = /did not match/;

describe("loopback callback boundary", () => {
	for (const callback of [
		"https://127.0.0.1:49152/callback?code=c&state=s",
		"http://evil.example:49152/callback?code=c&state=s",
		"http://127.0.0.1:49153/callback?code=c&state=s",
		"http://127.0.0.1:49152/other?code=c&state=s",
		"http://127.0.0.1:49152/callback?code=c&state=wrong",
		"http://127.0.0.1:49152/callback?code=c&state=s&state=s",
	]) {
		it(`rejects mismatched callback ${callback}`, () => {
			expect(() =>
				parseCallbackUrl(callback, "s", "http://127.0.0.1:49152/callback"),
			).toThrow(MISMATCH);
		});
	}
});
