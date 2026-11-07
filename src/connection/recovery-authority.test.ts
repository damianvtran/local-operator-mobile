import { describe, expect, it, vi } from "vitest";
import {
	proveRecoveryAuthority,
	recoveryAuthorityScope,
} from "./recovery-authority";

// The response comes from the authenticated /v1/me contract, not a decoded ID
// token or an email match. Synthetic identifiers deliberately differ from email.
const identity = (account = "account-a", tenant = "tenant-a") => ({
	result: {
		identity: {
			account_id: account,
			provider: "oidc",
			email: "reader@example.invalid",
		},
		account: { id: account, tenant_id: tenant },
		memberships: [],
	},
});

describe("trusted recovery authority", () => {
	it("bounds a stalled current proof and cancels its timer on completion", async () => {
		vi.useFakeTimers();
		try {
			const fetcher: typeof fetch = async (_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new Error("aborted")),
					);
				});
			const pending = proveRecoveryAuthority("synthetic", {
				fetcher,
				isCurrent: () => true,
			});
			await vi.advanceTimersByTimeAsync(20000);
			expect(await pending).toBeNull();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
	const owner = { accountId: "account-a", tenantId: "tenant-a" };
	const route = {
		mode: "radient" as const,
		tunnelId: "tunnel-a",
		hostname: "0123456789abcdef0123456789abcdef-lop.radienthq.com",
	};
	it("binds account, tenant, tunnel, relay origin and harness without email", () => {
		const scope = recoveryAuthorityScope(owner, route);
		expect(scope).not.toBeNull();
		for (const changed of [
			recoveryAuthorityScope({ ...owner, accountId: "account-b" }, route),
			recoveryAuthorityScope({ ...owner, tenantId: "tenant-b" }, route),
			recoveryAuthorityScope(owner, { ...route, tunnelId: "tunnel-b" }),
			recoveryAuthorityScope(owner, {
				...route,
				hostname: "1123456789abcdef0123456789abcdef-lop.radienthq.com",
			}),
		])
			expect(changed).not.toEqual(scope);
	});
	it("refuses custom, org-claimed and non-local-operator authority", () => {
		expect(
			recoveryAuthorityScope(owner, {
				mode: "custom",
				baseUrl: "https://relay.example.invalid",
				allowInsecure: false,
			}),
		).toBeNull();
		expect(
			recoveryAuthorityScope(owner, { ...route, orgId: "org-a" }),
		).toBeNull();
		expect(
			recoveryAuthorityScope(owner, {
				...route,
				hostname: route.hostname.replace("-lop.", "-oc."),
			}),
		).toBeNull();
	});
	it("uses only the fixed authenticated backend and refuses redirect credential forwarding", async () => {
		const fetcher = vi.fn(async () => Response.json(identity()));
		const proof = await proveRecoveryAuthority("synthetic-access-token", {
			fetcher,
			isCurrent: () => true,
		});
		expect(fetcher).toHaveBeenCalledWith(
			"https://api.radienthq.com/v1/me",
			expect.objectContaining({
				headers: {
					Authorization: "Bearer synthetic-access-token",
					"Cache-Control": "no-store, no-cache",
					Pragma: "no-cache",
				},
				cache: "no-store",
				redirect: "error",
			}),
		);
		expect(proof).not.toBeNull();
	});
	it.each([401, 403, 503])(
		"refuses HTTP %s without promoting cached identity",
		async (status) => {
			await expect(
				proveRecoveryAuthority("synthetic", {
					fetcher: async () => Response.json(identity(), { status }),
					isCurrent: () => true,
				}),
			).resolves.toBeNull();
		},
	);
	it("refuses a stale admission response", async () => {
		let current = true;
		await expect(
			proveRecoveryAuthority("synthetic", {
				fetcher: async () => {
					current = false;
					return Response.json(identity());
				},
				isCurrent: () => current,
			}),
		).resolves.toBeNull();
	});
	it.each([
		{ result: { account: { id: "account-a", tenant_id: "tenant-a" } } },
		{ result: { ...identity().result, identity: { account_id: "account-b" } } },
		{ result: { ...identity().result, account: { id: "account-a" } } },
	])("refuses incomplete or inconsistent server authority", async (body) => {
		await expect(
			proveRecoveryAuthority("synthetic", {
				fetcher: async () => Response.json(body),
				isCurrent: () => true,
			}),
		).resolves.toBeNull();
	});
});
