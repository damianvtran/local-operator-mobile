import { describe, expect, it } from "vitest";
import type { RadientTokens } from "@/connection/radient-oauth";
import { createRadientAccess } from "@/features/auth/radient-access";
import { createHubClient } from "@/team-bridge/client";
import { retirementAccessForAccount } from "@/team-bridge/push-account";

const jwt = (sub: string, exp: number) =>
	`h.${btoa(JSON.stringify({ sub, exp }))}.s`;
const future = () => Math.floor(Date.now() / 1000) + 300;

describe("account-bound retirement credentials", () => {
	it("old-account DELETE401 cannot spend the replacement account's rolling refresh token", async () => {
		const original = jwt("account-a", future());
		const replacement: RadientTokens = {
			access: jwt("account-b", future()),
			refresh: "rolling-b",
			expires_at: Date.now() + 300000,
			scope: "openid",
			token_type: "Bearer",
			account_label: null,
		};
		let held = replacement;
		let durable = replacement;
		let refreshes = 0,
			writes = 0;
		const manager = createRadientAccess({
			current: () => held,
			publish: (tokens) => {
				if (tokens) held = tokens;
			},
			refresh: async () => {
				refreshes++;
				return { ...replacement, refresh: "rotated-b" };
			},
			write: async (tokens) => {
				writes++;
				durable = tokens;
			},
			clear: async () => {},
			invalidGrant: () => false,
			serialize: async (run) => run(),
		});
		const seen: string[] = [];
		const hub = createHubClient({
			accessToken: retirementAccessForAccount(
				original,
				manager.retirementAccess,
			),
			fetchImpl: (async (_url, init) => {
				seen.push(new Headers(init?.headers).get("authorization") ?? "");
				return new Response("{}", { status: 401 });
			}) as typeof fetch,
		});
		await expect(hub.unregisterDevice("install-a", 200)).rejects.toMatchObject({
			kind: "sign_in",
		});
		expect(seen).toEqual([`Bearer ${original}`, `Bearer ${original}`]);
		expect(refreshes).toBe(0);
		expect(writes).toBe(0);
		expect(held).toBe(replacement);
		expect(durable).toBe(replacement);
		// Only B's own normal access may rotate and persist its rolling token.
		await manager.access({ force: true });
		expect(refreshes).toBe(1);
		expect(writes).toBe(1);
		expect(durable.refresh).toBe("rotated-b");
	});
	it("uses a fresh same-account bearer after the registered bearer expired", async () => {
		const expired = jwt("account-a", 1);
		const fresh = jwt("account-a", future());
		const headers: string[] = [];
		const hub = createHubClient({
			accessToken: retirementAccessForAccount(expired, async () => fresh),
			fetchImpl: (async (_url, init) => {
				headers.push(new Headers(init?.headers).get("authorization") ?? "");
				return new Response(null, { status: 204 });
			}) as typeof fetch,
		});
		await hub.unregisterDevice("install-a", 101);
		expect(headers).toEqual([`Bearer ${fresh}`]);
	});

	it("never borrows a replacement account's token; expired original cannot be retried", async () => {
		const access = retirementAccessForAccount(jwt("account-a", 1), async () =>
			jwt("account-b", future()),
		);
		expect(await access()).toBeNull();
		expect(await access({ force: true })).toBeNull();
	});

	it("an unexpired original may still clean up its old account after replacement", async () => {
		const original = jwt("account-a", future());
		const access = retirementAccessForAccount(original, async () =>
			jwt("account-b", future()),
		);
		expect(await access()).toBe(original);
	});

	it("the 401 retry refreshes the same account instead of replaying the captured token", async () => {
		const original = jwt("account-a", 1),
			first = jwt("account-a", future()),
			second = jwt("account-a", future() + 1);
		const seen: string[] = [];
		const hub = createHubClient({
			accessToken: retirementAccessForAccount(original, async (options) =>
				options?.force ? second : first,
			),
			fetchImpl: (async (_url, init) => {
				seen.push(new Headers(init?.headers).get("authorization") ?? "");
				return seen.length === 1
					? new Response("{}", { status: 401 })
					: new Response(null, { status: 204 });
			}) as typeof fetch,
		});
		await hub.unregisterDevice("install-a", 102);
		expect(seen).toEqual([`Bearer ${first}`, `Bearer ${second}`]);
	});
});
