import { afterEach, describe, expect, it, vi } from "vitest";
import { debugOAuthProofOrigin } from "./oauth-proof-override";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});
describe("debug-only OAuth fixture admission", () => {
	it("ignores even a supplied fixture origin in Release", () => {
		vi.stubGlobal("__DEV__", false);
		vi.stubEnv("EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN", "http://127.0.0.1:54831");
		expect(debugOAuthProofOrigin()).toBeUndefined();
	});
	it("admits only explicit literal-loopback origins in Debug", () => {
		vi.stubGlobal("__DEV__", true);
		for (const value of [
			"https://example.com",
			"http://localhost:54831",
			"http://127.0.0.1:54831/path",
			"http://user@127.0.0.1:54831",
			"http://127.0.0.1:54831?state=bad",
		]) {
			vi.stubEnv("EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN", value);
			expect(debugOAuthProofOrigin()).toBeUndefined();
		}
		vi.stubEnv("EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN", "http://127.0.0.1:54831");
		expect(debugOAuthProofOrigin()).toBe("http://127.0.0.1:54831");
	});
});
