import { describe, expect, it, vi } from "vitest";
import type { RadientTokens } from "./radient-oauth";
import { createRadientRefresher } from "./radient-refresh";
import { TunnelSessionManager } from "./tunnel-session";

const expired: RadientTokens = {
	access: "old-access",
	refresh: "synthetic-rotating",
	expires_at: 0,
	scope: "",
	token_type: "Bearer",
	account_id: "synthetic-account",
	account_label: null,
};

describe("one account-refresh authority", () => {
	it("joins concurrent consumers to ONE rotation and refuses a stale completed input", async () => {
		const refresh = vi.fn(async (tokens: RadientTokens) => ({
			...tokens,
			access: "new-access",
			refresh: "synthetic-rotated-2",
			expires_at: Date.now() + 3_600_000,
		}));
		const owner = createRadientRefresher(refresh);
		const results = await Promise.all([
			owner(expired),
			owner(expired),
			owner({ ...expired }),
		]);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(results.map((r) => r.refresh)).toEqual(
			Array(3).fill("synthetic-rotated-2"),
		);
		await owner(expired);
		expect(refresh).toHaveBeenCalledTimes(1);
	});
	it("does not retain a rejected rotation as a refreshable value", async () => {
		const refresh = vi.fn(async () => {
			throw new Error("synthetic network failure");
		});
		const owner = createRadientRefresher(refresh);
		await expect(owner(expired)).rejects.toThrow("synthetic network failure");
		await expect(owner(expired)).rejects.toThrow("synthetic network failure");
		expect(refresh).toHaveBeenCalledTimes(2);
	});
});

describe("an absolutely expired tunnel handle", () => {
	it("re-mints through authenticated ownership instead of demanding a new login", async () => {
		const handle = {
			tunnelId: "tun-synthetic",
			hostname: `${"a".repeat(32)}-lop.example.com`,
			grant: "old-grant",
			grantExpiresAt: 0,
			mintedAt: 0,
			refreshHandle: "handle",
			refreshExpiresAt: 0,
		};
		const now = Date.now();
		const deps = {
			oauthAccessToken: async () => "synthetic-access",
			now: () => now,
			fetchImpl: vi.fn(async (input: Parameters<typeof fetch>[0]) => {
				const url = new URL(String(input));
				if (url.pathname === "/v1/tunnels/session/code")
					return new Response(
						JSON.stringify({ msg: "ok", result: { code: "synthetic-code" } }),
						{ status: 200 },
					);
				if (url.pathname === "/v1/tunnels/session/token")
					return new Response(
						JSON.stringify({
							access_token: "renewed-grant",
							refresh_token: "handle",
							expires_in: 300,
							refresh_expires_in: 2_592_000,
						}),
						{ status: 200 },
					);
				throw new Error(`unexpected ${url.pathname}`);
			}),
		};
		const manager = new TunnelSessionManager({
			...deps,
			initial: { ...handle, mintedAt: now, refreshExpiresAt: now - 1 } as never,
			persist: async () => {},
		});
		const session = await manager.usableSession();
		expect(session.grant).toBe("renewed-grant");
		for (const call of (deps.fetchImpl as ReturnType<typeof vi.fn>).mock.calls)
			expect(String(call[0]).endsWith("/refresh")).toBe(false);
	});
});
