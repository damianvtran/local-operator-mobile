import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverComputers } from "../../src/connection/discovery";
import { refreshRadientTokens } from "../../src/connection/radient-oauth";
import {
	proveRecoveryAuthority,
	recoveryAuthorityScope,
} from "../../src/connection/recovery-authority";
import {
	directoriesSchema,
	modelsResponseSchema,
} from "../../src/contracts/schemas";
import { probeHealth } from "../../src/features/auth/connector-wait";
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
	it("records both loading completions relative to arrival and early release", async () => {
		const x = await fixture();
		x.scenario("held");
		x.observeHeld(async (proof) => {
			proof.recordFrame("first");
			proof.recordFrame("second");
			proof.recordFrame("first", Date.now());
			await new Promise((resolve) => setTimeout(resolve, 5));
			proof.recordFrame("second", Date.now());
			proof.release();
		}, 1000);
		expect(
			await proveRecoveryAuthority(syntheticValue(x.config, "access-a"), {
				fetcher: x.transport,
				isCurrent: () => true,
			}),
		).not.toBeNull();
		await x.awaitHeldCapture();
		const timing = x.heldTimings[0];
		if (!timing) throw new Error("held timing missing");
		expect(timing.releasedAfterMs).toBeLessThan(1000);
		expect(timing.frames).toHaveLength(2);
		for (const frame of timing.frames ?? []) {
			expect(frame.completedAfterArrivalMs).toBeGreaterThanOrEqual(0);
			expect(frame.completedRelativeToReleaseMs).toBeLessThanOrEqual(0);
		}
	});
	it("retains late and missing frame evidence after the independent hard release", async () => {
		const x = await fixture();
		x.scenario("held");
		x.observeHeld(async (proof) => {
			proof.recordFrame("late");
			proof.recordFrame("missing");
			await new Promise((resolve) => setTimeout(resolve, 35));
			expect(proof.releasedAt).toBeDefined();
			await new Promise((resolve) => setTimeout(resolve, 5));
			proof.recordFrame("late", Date.now());
		}, 10);
		expect(
			await proveRecoveryAuthority(syntheticValue(x.config, "access-a"), {
				fetcher: x.transport,
				isCurrent: () => true,
			}),
		).not.toBeNull();
		await x.awaitHeldCapture();
		const frames = x.heldTimings[0]?.frames;
		expect(frames).toHaveLength(2);
		expect(frames?.[0]?.completedRelativeToReleaseMs).toBeGreaterThan(0);
		expect(frames?.[1]?.completedAtMs).toBeUndefined();
	});
	it("initial same answers public reachability and /me immediately even with a future held observer armed", async () => {
		const x = await fixture();
		let heldTriggered = false;
		x.observeHeld(async () => {
			heldTriggered = true;
		});
		const started = Date.now();
		const [owner, health] = await Promise.all([
			proveRecoveryAuthority(syntheticValue(x.config, "access-a"), {
				fetcher: x.transport,
				isCurrent: () => true,
			}),
			probeHealth(STAGE_B_HOST, { fetchImpl: x.transport, timeoutMs: 1000 }),
		]);
		expect(owner).toEqual({
			accountId: "stage-b-account-a",
			tenantId: "stage-b-tenant-a",
		});
		expect(health).not.toBeNull();
		expect(health?.ok).toBe(true);
		expect(Date.now() - started).toBeLessThan(1000);
		expect(heldTriggered).toBe(false);
		expect(x.held()).toBe(0);
		expect(x.heldTimings).toEqual([]);
		expect(x.counters.me).toBe(1);
		expect(x.counters.healthProbes).toBe(1);
		for (const kind of ["health", "me"]) {
			const event = x.requestTimeline.find((event) => event.kind === kind);
			expect(event?.status).toBe(200);
			expect(event?.receivedAtMs).toBeGreaterThanOrEqual(started);
			expect(
				(event?.completedAtMs ?? Infinity) - (event?.receivedAtMs ?? 0),
			).toBeLessThan(1000);
		}
	});
	it("allows only credential-free GET health probes, never anonymous private APIs or arbitrary credentials", async () => {
		const x = await fixture();
		for (const [path, init] of [
			["/api/models", {}],
			["/healthz", { method: "POST" }],
			["/healthz", { headers: { Authorization: "Bearer not-synthetic" } }],
		] as const)
			await expect(
				x.transport(`https://${STAGE_B_HOST}${path}`, init),
			).rejects.toThrow("non-synthetic relay authority refused");
		x.expire();
		expect(
			await probeHealth(STAGE_B_HOST, { fetchImpl: x.transport }),
		).not.toBeNull();
	});
	it("starts capture on real held /me arrival and releases independently of a stuck observer", async () => {
		const x = await fixture();
		x.scenario("held");
		let capturedAt = 0;
		x.observeHeld(async (proof) => {
			capturedAt = proof.firstSeenAt;
			expect(proof.deadlineAt - proof.firstSeenAt).toBe(25);
			await new Promise<void>(() => {});
		}, 25);
		const owner = await proveRecoveryAuthority(
			syntheticValue(x.config, "access-a"),
			{ fetcher: x.transport, isCurrent: () => true },
		);
		expect(owner).not.toBeNull();
		expect(capturedAt).toBeGreaterThan(0);
		expect(x.heldTimings[0]?.releasedAfterMs).toBeLessThan(20000);
	});
	it("the real production 20s deadline refuses a held response, then a prompt same-owner proof succeeds", async () => {
		const x = await fixture();
		x.scenario("held");
		x.observeHeld(async (proof) => {
			await new Promise((resolve) =>
				setTimeout(resolve, Math.max(0, proof.deadlineAt - Date.now())),
			);
			proof.release();
		}, 22000);
		expect(
			await proveRecoveryAuthority(syntheticValue(x.config, "access-a"), {
				fetcher: x.transport,
				isCurrent: () => true,
			}),
		).toBeNull();
		await x.awaitHeldCapture();
		x.scenario("same");
		expect(
			await proveRecoveryAuthority(syntheticValue(x.config, "access-a"), {
				fetcher: x.transport,
				isCurrent: () => true,
			}),
		).toEqual({ accountId: "stage-b-account-a", tenantId: "stage-b-tenant-a" });
	}, 30000);
	it("serves valid home directories and a populated catalogue behind the relay gate", async () => {
		const x = await fixture();
		const request = (path: string, authenticated = true) =>
			!authenticated
				? fetch(`${x.config.fixtureOrigin}${path}`, {
						headers: {
							"x-stage-b-proof": x.config.nonce,
							Origin: `https://${STAGE_B_HOST}`,
						},
					})
				: x.transport(`https://${STAGE_B_HOST}${path}`, {
						headers: authenticated
							? {
									Cookie: `__Host-radient-grant=${syntheticValue(x.config, "grant")}`,
									Origin: `https://${STAGE_B_HOST}`,
								}
							: {},
					});
		const directories = await request("/api/directories");
		expect(directories.status).toBe(200);
		directoriesSchema.parse(await directories.json());
		const models = await request("/api/models");
		expect(models.status).toBe(200);
		expect(
			modelsResponseSchema.parse(await models.json()).models.length,
		).toBeGreaterThan(0);
		expect((await request("/api/directories", false)).status).toBe(401);
		expect((await request("/api/models", false)).status).toBe(401);
	});
	it("accepts only bounded sanitized route trace fields over the real control socket", async () => {
		const x = await fixture();
		const trace = {
			kind: "route-trace",
			sourceSha: x.config.sourceSha,
			traceEvent: "row-press",
			traceSequence: 1,
			traceAtMs: 100,
			traceRevision: 2,
			tracePhase: "minting",
			traceRoute: "radient",
			traceSelected: true,
			traceFailure: false,
		};
		const post = (body: unknown) =>
			fetch(`${x.config.fixtureOrigin}/proof/receipt`, {
				method: "POST",
				headers: {
					"x-stage-b-proof": x.config.nonce,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			});
		expect((await post(trace)).status).toBe(200);
		for (const mutation of [
			{ traceSequence: 33 },
			{ tracePhase: "private-phase" },
			{ traceRoute: "private-host" },
			{ draft: "private-content" },
			{ traceRevision: -1 },
		])
			expect((await post({ ...trace, ...mutation })).status).toBe(400);
		const { traceSelected: _omitted, ...missing } = trace;
		expect((await post(missing)).status).toBe(400);
		expect(x.receipts).toEqual([trace]);
	});
	it("accepts only bounded same-process callback probes over the real control socket", async () => {
		const x = await fixture();
		const probe = {
			kind: "stage-b-callback-probe",
			sourceSha: x.config.sourceSha,
			processId: "00000000-0000-4000-8000-000000000001",
			presses: 0,
			superseded: 0,
			traceRevision: 0,
			tracePhase: "signed-out",
			traceRoute: "none",
			traceSelected: false,
			traceFailure: false,
		};
		const post = (body: unknown) =>
			fetch(`${x.config.fixtureOrigin}/proof/receipt`, {
				method: "POST",
				headers: {
					"x-stage-b-proof": x.config.nonce,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			});
		expect((await post(probe)).status).toBe(200);
		for (const mutation of [
			{ processId: "not-a-lease" },
			{ presses: -1 },
			{ presses: 1.5 },
			{ superseded: "1" },
			{ tracePhase: "private-phase" },
			{ traceRoute: "private-host" },
			{ traceSelected: "yes" },
			{ draft: "private-content" },
			{ traceRevision: null },
		])
			expect((await post({ ...probe, ...mutation })).status).toBe(400);
		const { presses: _omitted, ...missing } = probe;
		expect((await post(missing)).status).toBe(400);
		expect(x.receipts).toEqual([probe]);
	});
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
