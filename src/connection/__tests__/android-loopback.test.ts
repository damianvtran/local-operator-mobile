import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
	prepare: vi.fn(),
	open: vi.fn(),
	dismiss: vi.fn(),
}));
const platform = vi.hoisted(() => ({ OS: "android" }));
vi.mock("expo", () => ({ requireNativeModule: () => native }));
vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("expo-web-browser", () => ({
	openAuthSessionAsync: () => {
		throw new Error("Android must own a real loopback listener");
	},
}));

import {
	resetLocaleSource,
	SUPPORTED_LOCALES,
	setLocaleSource,
	t,
} from "../../i18n";
import { createSystemBrowserSession } from "../loopback";

beforeEach(() => {
	platform.OS = "android";
	native.prepare
		.mockReset()
		.mockResolvedValue("http://127.0.0.1:49152/callback");
	native.open.mockReset().mockResolvedValue(null);
	native.dismiss.mockReset().mockResolvedValue(undefined);
});
afterEach(resetLocaleSource);

describe("Android native callback adapter", () => {
	it.each(SUPPORTED_LOCALES)(
		"resolves browser copy at call time for %s, without code/state in it",
		async (locale) => {
			setLocaleSource(() => locale);
			const browser = await createSystemBrowserSession();
			expect(await browser.prepareRedirect?.()).toBe(
				"http://127.0.0.1:49152/callback",
			);
			expect(native.prepare).toHaveBeenCalledWith({
				received: t("mobile.oauth.received"),
				returnLabel: t("mobile.oauth.return"),
				invalid: t("mobile.oauth.invalid"),
				direction: locale === "ur" ? "rtl" : "ltr",
			});
			expect(browser.returnsCallback).toBe(true);
			expect(
				await browser.open(
					"https://provider.example/authorize",
					"http://127.0.0.1:49152/callback",
				),
			).toBeNull();
			await browser.dismiss();
			expect(native.dismiss).toHaveBeenCalledOnce();
		},
	);

	it("does not expose native error codes in the sign-in failure copy", async () => {
		native.prepare.mockRejectedValue(new Error("ERR_AUTH_BIND"));
		const browser = await createSystemBrowserSession();
		await expect(browser.prepareRedirect?.()).rejects.toThrow(
			t("mobile.oauth.failed"),
		);
	});

	it("never silently sends an unsupported native platform through the web browser fallback", async () => {
		platform.OS = "windows";
		await expect(createSystemBrowserSession()).rejects.toThrow(
			"ERR_AUTH_PLATFORM_UNSUPPORTED",
		);
		expect(native.prepare).not.toHaveBeenCalled();
	});
});
