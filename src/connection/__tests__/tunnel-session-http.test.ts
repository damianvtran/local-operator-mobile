import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFastPathOAuth } from "../../../tools/mock-relay/oauth-fast-path";
import { mintTunnelSession } from "../tunnel-session";

// Real HTTP requests through BOTH PKCE exchanges and the grant Cookie gate.
// Source-only mocks used to return a raw code and could not catch the operator's
// 200/{msg,result} failure. This uses the same server as the hosted Expo proof.
describe("real-app OAuth → enveloped tunnel code → relay contract", () => {
	it("mints and reaches a populated session list only with the grant", async () => {
		const server = await createFastPathOAuth();
		try {
			await fetch(`${server.origin}/control?mode=success`);
			const verifier = "v".repeat(43);
			const authorize = new URL(`${server.origin}/authorize`);
			authorize.search = new URLSearchParams({
				redirect_uri: "http://127.0.0.1:54549/callback",
				state: "fixture-state",
				code_challenge: createHash("sha256")
					.update(verifier)
					.digest("base64url"),
				code_challenge_method: "S256",
			}).toString();
			const redirect = await fetch(authorize, { redirect: "manual" });
			expect(redirect.status).toBe(302);
			const callback = new URL(redirect.headers.get("location") ?? "");
			const oauth = await fetch(`${server.origin}/token`, {
				method: "POST",
				body: JSON.stringify({
					code: callback.searchParams.get("code"),
					code_verifier: verifier,
					redirect_uri: "http://127.0.0.1:54549/callback",
					grant_type: "authorization_code",
				}),
			}).then((r) => r.json());
			const input = {
				tunnelId: "fixture-tunnel",
				hostname: `${"0".repeat(32)}-lop.radienthq.com`,
				oauthAccessToken: oauth.access_token,
			};
			await expect(
				mintTunnelSession(
					{ ...input, tunnelId: "other-tunnel" },
					{ apiBase: server.origin },
				),
			).rejects.toMatchObject({ failure: "account", status: 404 });
			await expect(
				mintTunnelSession(
					{ ...input, hostname: `${"1".repeat(32)}-lop.radienthq.com` },
					{ apiBase: server.origin },
				),
			).rejects.toMatchObject({ failure: "harness", status: 404 });
			await fetch(`${server.origin}/control?session=inactive`);
			await expect(
				mintTunnelSession(input, { apiBase: server.origin }),
			).rejects.toMatchObject({ failure: "disabled", status: 403 });
			await fetch(`${server.origin}/control?session=success`);
			const session = await mintTunnelSession(input, {
				apiBase: server.origin,
			});
			expect((await fetch(`${server.origin}/healthz`)).status).toBe(401);
			const list = await fetch(`${server.origin}/api/sessions`, {
				headers: { Cookie: `__Host-radient-grant=${session.grant}` },
			});
			expect(list.status).toBe(200);
			expect((await list.json()).sessions).toHaveLength(1);
			let receipt = await fetch(`${server.origin}/receipt`).then((r) =>
				r.json(),
			);
			expect(receipt).toMatchObject({
				session_code: 2,
				session_token: 1,
				session_pkce_verified: 1,
				relay_requests: 1,
			});
			await fetch(`${server.origin}/control?session=malformed`);
			await expect(
				mintTunnelSession(input, { apiBase: server.origin }),
			).rejects.toMatchObject({ failure: "contract" });
			receipt = await fetch(`${server.origin}/receipt`).then((r) => r.json());
			expect(receipt).toMatchObject({ session_code: 3, session_token: 1 });
		} finally {
			await server.close();
		}
	});
});
