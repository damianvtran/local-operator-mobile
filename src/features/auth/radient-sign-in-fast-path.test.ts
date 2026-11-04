import { afterEach, describe, expect, it, vi } from "vitest";
import { createFastPathOAuth } from "../../../tools/mock-relay/oauth-fast-path";
import { signInWithRadient } from "../../connection/radient-oauth";
import { beginRadientSignIn, type SignInState } from "./radient-sign-in";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
afterEach(() => vi.unstubAllGlobals());

describe("already-signed-in fast callback", () => {
	it("exchanges the exact redirect/verifier and reads the real discovery envelope", async () => {
		const server = await createFastPathOAuth();
		try {
			await fetch(`${server.origin}/control?mode=success`);
			const result = await beginRadientSignIn({
				browser: {
					returnsCallback: true,
					prepareRedirect: async () => "http://127.0.0.1:54549/callback",
					open: async (url) =>
						(await fetch(url, { redirect: "manual" })).headers.get("location"),
					dismiss: async () => {},
				},
				signIn: (deps) =>
					signInWithRadient({
						...deps,
						authorizeUrl: `${server.origin}/authorize`,
						tokenUrl: `${server.origin}/token`,
					}),
			});
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error("Expected a synthetic grant");
			const { discoverComputers } = await import("../../connection/discovery");
			const discovery = await discoverComputers({
				accessToken: async () => result.tokens.access,
				baseUrl: server.origin,
			});
			expect(discovery).toMatchObject({
				kind: "computers",
				computers: [{ name: "OAuth proof computer" }],
			});
			expect(server.counts.pkce_verified).toBe(1);
		} finally {
			await server.close();
		}
	});
	it("reports exchanging WHILE the real PKCE token request is pending, then reports a visible 500 failure", async () => {
		const server = await createFastPathOAuth();
		const states: SignInState[] = [];
		try {
			await fetch(`${server.origin}/control?mode=failure&hold=true`);
			const pending = beginRadientSignIn({
				onState: (state) => states.push(state),
				browser: {
					returnsCallback: true,
					prepareRedirect: async () => "http://127.0.0.1:54549/callback",
					open: async (url) =>
						(await fetch(url, { redirect: "manual" })).headers.get("location"),
					dismiss: async () => {},
				},
				signIn: (deps) =>
					signInWithRadient({
						...deps,
						authorizeUrl: `${server.origin}/authorize`,
						tokenUrl: `${server.origin}/token`,
					}),
			});
			await vi.waitFor(() =>
				expect(server.counts.pkce_verified, JSON.stringify(states)).toBe(1),
			);
			expect(states.at(-1)?.kind).toBe("exchanging");
			await fetch(`${server.origin}/release-token`);
			const result = await pending;
			expect(result.ok).toBe(false);
			expect(states.at(-1)).toMatchObject({
				kind: "failed",
				errorClass: "RadientAuthError",
			});
			expect(server.counts.discovery).toBe(0);
		} finally {
			await server.close();
		}
	});
});
