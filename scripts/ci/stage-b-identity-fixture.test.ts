import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverComputers } from "../../src/connection/discovery";
import { refreshRadientTokens } from "../../src/connection/radient-oauth";
import {
	proveRecoveryAuthority,
	recoveryAuthorityScope,
} from "../../src/connection/recovery-authority";
import {
	STAGE_B_HOST,
	stageBContainsDraftCanary,
	stageBDraftCanary,
	stageBTransport,
	syntheticValue,
} from "../../src/testing/stage-b-draft-transport";
import { startStageBIdentityFixture } from "../../tools/mock-relay/stage-b-identity-fixture";
import { stageBFlow, typeStageBDraft } from "./stage-b-draft-flows";

const PUBLIC_CANARY = /^stage-b-private-draft-[a-f0-9]{32}$/;
const servers: Awaited<ReturnType<typeof startStageBIdentityFixture>>[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function fixture() {
	const server = await startStageBIdentityFixture("a".repeat(40));
	servers.push(server);
	return { ...server, transport: stageBTransport(server.config, fetch) };
}
describe("Stage B real-socket synthetic authority fixture", () => {
	it("accepts the native keychain preflight evidence as a boolean startup receipt", async () => {
		const x = await fixture();
		const response = await fetch(`${x.config.fixtureOrigin}/proof/receipt`, {
			method: "POST",
			headers: {
				"x-stage-b-proof": x.config.nonce,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				kind: "startup",
				sourceSha: x.config.sourceSha,
				keychainPreflight: true,
			}),
		});
		expect(response.status).toBe(200);
		expect(x.receipts).toEqual([
			expect.objectContaining({ keychainPreflight: true }),
		]);
	});
	it("shares an independent public canary between flow YAML and the plaintext scanner", async () => {
		const x = await fixture();
		const readSeed = async () =>
			(
				await fetch(`${x.config.fixtureOrigin}/proof/seed`, {
					headers: { "x-stage-b-proof": x.config.nonce },
				})
			).json();
		const seed = await readSeed();
		const canary = stageBDraftCanary(seed.canary, x.config.nonce);
		expect(canary).toBe(x.canary);
		expect(canary).toMatch(PUBLIC_CANARY);
		const yaml = stageBFlow(typeStageBDraft(canary));
		expect(yaml).toContain(canary);
		expect(yaml).not.toContain(x.config.nonce);
		expect(
			stageBContainsDraftCanary(
				`prefix ${canary}-typed-while-loading suffix`,
				canary,
			),
		).toBe(true);
		expect(
			stageBContainsDraftCanary("encrypted-envelope-placeholder", canary),
		).toBe(false);
		x.scenario("account-b");
		expect((await readSeed()).canary).toBe(canary); // Relaunch/scenario must not desync the observer.
		expect(() =>
			stageBDraftCanary(
				`stage-b-private-draft-${x.config.nonce}`,
				x.config.nonce,
			),
		).toThrow("independent");
	});
	it("exercises the production /me parser and discovery through real authenticated requests", async () => {
		const x = await fixture();
		const token = syntheticValue(x.config, "access-a");
		const proof = await proveRecoveryAuthority(token, {
			fetcher: x.transport,
			isCurrent: () => true,
		});
		expect(proof).toEqual({
			accountId: "stage-b-account-a",
			tenantId: "stage-b-tenant-a",
		});
		const computers = await discoverComputers({
			accessToken: () => token,
			fetchImpl: x.transport,
		});
		expect(computers.kind).toBe("computers");
		expect(x.counters.me).toBe(1);
		expect(x.counters.discovery).toBe(1);
		const renewed = await proveRecoveryAuthority(
			syntheticValue(x.config, "access-a-renewed"),
			{ fetcher: x.transport, isCurrent: () => true },
		);
		expect(renewed).toEqual(proof);
		const other = await proveRecoveryAuthority(
			syntheticValue(x.config, "access-b"),
			{ fetcher: x.transport, isCurrent: () => true },
		);
		const route = {
			mode: "radient" as const,
			hostname: STAGE_B_HOST,
			tunnelId: "stage-b-personal-tunnel",
		};
		if (!proof || !other) throw new Error("fixture proof absent");
		expect(recoveryAuthorityScope(other, route)).not.toBe(
			recoveryAuthorityScope(proof, route),
		);
		expect(x.counters.mutations).toBe(0);
	});
	it("renews through the real refresh client without changing authenticated owner", async () => {
		const x = await fixture();
		const refreshed = await refreshRadientTokens(
			{
				access: syntheticValue(x.config, "access-a"),
				refresh: syntheticValue(x.config, "oauth-refresh"),
				expires_at: 0,
				token_type: "Bearer",
				scope: "openid",
				account_label: null,
				account_id: null,
			},
			{ fetchImpl: x.transport },
		);
		expect(refreshed.access).toBe(syntheticValue(x.config, "access-a-renewed"));
		expect(x.counters.oauthRefresh).toBe(1);
		expect(
			await proveRecoveryAuthority(refreshed.access, {
				fetcher: x.transport,
				isCurrent: () => true,
			}),
		).toEqual({ accountId: "stage-b-account-a", tenantId: "stage-b-tenant-a" });
	});
	it.each(["unauthorized", "malformed", "offline", "redirect"] as const)(
		"fails closed for actual %s response without cached proof",
		async (scenario) => {
			const x = await fixture();
			x.scenario(scenario);
			expect(
				await proveRecoveryAuthority(syntheticValue(x.config, "access-a"), {
					fetcher: x.transport,
					isCurrent: () => true,
				}),
			).toBeNull();
			expect(x.counters.me).toBe(1);
			expect(x.counters.redirectTarget).toBe(0);
		},
	);
	it("refuses a held old response after the admission epoch changes", async () => {
		const x = await fixture();
		x.scenario("held");
		let current = true;
		const pending = proveRecoveryAuthority(
			syntheticValue(x.config, "access-a"),
			{ fetcher: x.transport, isCurrent: () => current },
		);
		await x.whenHeld();
		current = false;
		x.release();
		expect(await pending).toBeNull();
	});
	it("never forwards a real/unknown credential, endpoint or unsafe /me request", async () => {
		const x = await fixture();
		const native = vi.fn(fetch);
		const transport = stageBTransport(x.config, native);
		await expect(
			transport("https://api.radienthq.com/v1/me", {
				headers: { Authorization: "Bearer not-a-fixture" },
				cache: "no-store",
				redirect: "error",
			}),
		).rejects.toThrow("non-synthetic");
		await expect(
			transport("https://unapproved.example.invalid/v1/me"),
		).rejects.toThrow("allowlist");
		await expect(
			transport("https://api.radienthq.com/v1/me", {
				headers: {
					Authorization: `Bearer ${syntheticValue(x.config, "access-a")}`,
				},
				redirect: "follow",
			}),
		).rejects.toThrow("unsafe");
		expect(native).not.toHaveBeenCalled();
	});
});
