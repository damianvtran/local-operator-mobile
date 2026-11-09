import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { OTHER_TENANT, SELF, TENANT } from "@/team-bridge/__tests__/fixtures";
import { createHubClient } from "@/team-bridge/client";
import { createTeamBridgeStore } from "@/team-bridge/store";
import { TEAM_BRIDGE_FIXTURE_TOKEN } from "@/testing/team-bridge-token";

// App/client integration belongs to the app config: Node tooling intentionally
// has no app alias map. Keep the actual HTTP fixture tests, not a wider config.
const rigs: { close: () => Promise<void> }[] = [];
const directories: string[] = [];
const LISTEN_ADDRESS = /listening on (127\.0\.0\.1:\d+)/;
async function rig() {
	// Ordinary pnpm test and clean CI runners have no Local Operator environment.
	// Honor its scratch root when supplied, otherwise Node's TMPDIR-aware root;
	// mkdtemp owns a private child, and cleanup removes only that child.
	const scratch = process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir();
	await mkdir(scratch, { recursive: true });
	const root = await mkdtemp(join(scratch, "hub-fixture-test-"));
	directories.push(root);
	await writeFile(join(root, "index.html"), "<p>Synthetic fixture page</p>");
	// Run the Node-only fixture across its real CLI boundary. Importing the
	// tooling graph here would pull explicit Node .ts specifiers into the app
	// compiler; widening either compiler's module contract would hide the defect.
	const child = spawn(
		process.execPath,
		["--experimental-strip-types", "tools/mock-team-bridge.ts", root, "0"],
		{
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const lines = createInterface({ input: child.stdout });
	const address = new Promise<string>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => reject(new Error(`fixture exited ${code}`)));
		lines.on("line", (line) => {
			const match = LISTEN_ADDRESS.exec(line);
			if (match) resolve(`http://${match[1]}`);
		});
	});
	const fixture = {
		listen: async () => ({ url: await address }),
		close: async () => {
			lines.close();
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, "exit");
			child.kill("SIGTERM");
			await exited;
		},
	};
	rigs.push(fixture);
	return fixture;
}
const get = (url: string, path: string) =>
	fetch(`${url}${path}`, { signal: AbortSignal.timeout(2000) });
afterEach(async () => {
	const closed = await Promise.allSettled(
		rigs.splice(0).map((fixture) => fixture.close()),
	);
	const removed = await Promise.allSettled(
		directories
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
	if ([...closed, ...removed].some((result) => result.status === "rejected"))
		throw new Error("owned hub fixture cleanup failed");
}, 15_000);

describe("default-on notice over the actual HTTP client", () => {
	it("isolates review flows, accounts and organizations through the real hub boundary", async () => {
		const { fixtureOptions } = await import("@/testing/team-bridge-options");
		const fixture = await rig();
		const { url } = await fixture.listen();
		const records = new Set<string>();
		const make = (account: string, org = "one") => {
			const options = fixtureOptions(
				`?tb-fixture=notice_default&tb-flow=http4&tb-account=${account}&tb-org=${org}`,
			);
			if (!options?.token) throw new Error("missing synthetic token");
			const accessToken = async () => options.token ?? null;
			const hub = createHubClient({
				baseUrl: `${url}/mock-hub/${options.world}`,
				accessToken,
			});
			return createTeamBridgeStore({
				hub: () => hub,
				accessToken,
				dismissals: {
					has: async (a, t) => records.has(`${a}:${t}`),
					set: async (a, t) => {
						records.add(`${a}:${t}`);
					},
				},
			});
		};
		const a = make("a");
		await a.actions.checkStatus();
		await a.actions.loadDefaultOnNotice(TENANT);
		await a.actions.dismissDefaultOnNotice();
		const reload = make("a");
		await reload.actions.checkStatus();
		await reload.actions.loadDefaultOnNotice(TENANT);
		expect(reload.store.getState().defaultOnNotice).toBeNull();
		const b = make("b");
		await b.actions.checkStatus();
		await b.actions.loadDefaultOnNotice(TENANT);
		expect(b.store.getState().defaultOnNotice).not.toBeNull();
		const secondOrg = make("a", "two");
		await secondOrg.actions.checkStatus();
		await secondOrg.actions.loadDefaultOnNotice(OTHER_TENANT);
		expect(secondOrg.store.getState().defaultOnNotice?.tenantId).toBe(
			OTHER_TENANT,
		);
		expect(records).toEqual(new Set([`fixture_http4_a:${TENANT}`]));
	});
	it.each(["notice_default", "notice_error", "notice_dialog"])(
		"keeps enrollment server-owned in %s",
		async (variant) => {
			const fixture = await rig();
			const { url } = await fixture.listen();
			const accessToken = async () => TEAM_BRIDGE_FIXTURE_TOKEN;
			const hub = createHubClient({
				baseUrl: `${url}/mock-hub/${variant}`,
				accessToken,
			});
			const dismissed = new Set<string>();
			const deps = {
				hub: () => hub,
				accessToken,
				dismissals: {
					has: async (account: string, tenant: string) =>
						dismissed.has(`${account}:${tenant}`),
					set: async (account: string, tenant: string) => {
						dismissed.add(`${account}:${tenant}`);
					},
				},
			};
			const made = createTeamBridgeStore(deps);
			await made.actions.checkStatus();
			await made.actions.loadDefaultOnNotice(TENANT);
			const stats = async () =>
				(await (await get(url, "/__stats")).json()).result.requests as {
					method: string;
					path: string;
				}[];
			expect((await stats()).every((r) => r.method === "GET")).toBe(true);
			if (variant === "notice_dialog") {
				expect(made.store.getState().defaultOnNotice).toBeNull();
				return;
			}
			expect(made.store.getState().selfAccountId).toBe(SELF);
			expect(made.store.getState().defaultOnNotice?.tenantId).toBe(TENANT);
			await made.actions.turnOffDefaultOn();
			if (variant === "notice_error") {
				expect(made.store.getState().defaultOnNotice).not.toBeNull();
				expect(made.store.getState().defaultOnNoticeError?.status).toBe(500);
				expect(dismissed.size).toBe(0);
			} else {
				expect(made.store.getState().defaultOnNotice).toBeNull();
				expect(dismissed.has(`${SELF}:${TENANT}`)).toBe(true);
				const remount = createTeamBridgeStore(deps);
				await remount.actions.checkStatus();
				await remount.actions.loadDefaultOnNotice(TENANT);
				expect(remount.store.getState().defaultOnNotice).toBeNull();
			}
			expect((await stats()).filter((r) => r.method === "PUT")).toEqual([
				{ method: "PUT", path: "/settings" },
			]);
			await expect(hub.settings(OTHER_TENANT)).rejects.toMatchObject({
				kind: "refused",
			});
			const expired = createHubClient({
				baseUrl: `${url}/mock-hub/${variant}`,
				accessToken: async () => "synthetic-expired",
			});
			await expect(expired.settings(TENANT)).rejects.toMatchObject({
				kind: "sign_in",
			});
		},
	);
});
