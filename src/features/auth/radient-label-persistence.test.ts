import { describe, expect, it, vi } from "vitest";

/* A NATIVE keystore (`Platform.OS` ios), so `writeStoredOauth`'s `persistent`
 * is the real answer to "will this grant survive a restart?". Only the native
 * adapter is replaced (an in-memory one); `SecureStorage` and its 2,048-char
 * item cap stay real, because that cap is what this file is about. The same
 * seams `retirement-restore.test.ts` stubs. */
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/connection", async (original) => {
	const actual = await original<typeof import("@/connection")>();
	return { ...actual, expoSecureStore: async () => actual.memorySecureStore() };
});
vi.mock("@/connection/storage", async (original) => ({
	...(await original<object>()),
	thisDeviceOnlyAccessibility: async () => "[redacted]-this-device-only",
}));

import {
	ACCOUNT_LABEL_MAX_CODE_POINTS,
	exchangeCode,
} from "@/connection/radient-oauth";
import { readStoredOauth, writeStoredOauth } from "./tunnel-storage";

describe("an oversized profile claim cannot cost the user their remembered sign-in (PR #262 m2)", () => {
	it("clamps a 1 MB name claim so the grant still persists", async () => {
		/* No email claim, so the name is the label. Placeholder values only. */
		const hugeName = "N".repeat(1_000_000);
		const idToken = `e30.${Buffer.from(
			JSON.stringify({ sub: "acct_placeholder", name: hugeName }),
		).toString("base64url")}.sig`;
		const fetchImpl = (async () =>
			new Response(
				JSON.stringify({
					access_token: "at-placeholder",
					refresh_token: "rt-placeholder",
					expires_in: 3600,
					id_token: idToken,
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			)) as unknown as typeof fetch;
		const tokens = await exchangeCode("c", "http://127.0.0.1/callback", "v", {
			fetchImpl,
			now: () => 0,
		});
		/* On fe52e380 the stored JSON was ~1,000,155 chars, `SecureStorage`
		 * refused it, and this came back `{ persistent: false }`. */
		expect(await writeStoredOauth(tokens)).toEqual({ persistent: true });
		const label = tokens.account_label ?? "";
		expect(Array.from(label)).toHaveLength(ACCOUNT_LABEL_MAX_CODE_POINTS);
		expect(label.endsWith("…")).toBe(true);
		expect((await readStoredOauth())?.account_label).toBe(label);
	});
});
