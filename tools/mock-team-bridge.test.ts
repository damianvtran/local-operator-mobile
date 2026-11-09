import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OTHER_TENANT, SELF, TENANT } from "@/team-bridge/__tests__/fixtures";
import { createHubClient } from "@/team-bridge/client";
import { createTeamBridgeStore } from "@/team-bridge/store";
import { TEAM_BRIDGE_FIXTURE_TOKEN } from "@/testing/team-bridge-token";
import {
	createTeamBridgeFixture,
	fixtureArguments,
} from "./mock-team-bridge.ts";

// Observe only factory construction; all fixtures still use the real server.
vi.mock("node:http", async (original) => {
	const actual = await original<typeof import("node:http")>();
	return { ...actual, createServer: vi.fn(actual.createServer) };
});

// Importing the module must not launch its CLI. Runtime owns only factory
// instances; no signals, HTTP shutdown route, guessed PID or foreign port.
const rigs: ReturnType<typeof createTeamBridgeFixture>[] = [];
const directories: string[] = [];
async function rig() {
	// Ordinary pnpm test and clean CI runners have no Local Operator environment.
	// Honor its scratch root when supplied, otherwise Node's TMPDIR-aware root;
	// mkdtemp owns a private child, and cleanup removes only that child.
	const scratch = process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir();
	await mkdir(scratch, { recursive: true });
	const root = await mkdtemp(join(scratch, "hub-fixture-test-"));
	directories.push(root);
	await writeFile(join(root, "index.html"), "<p>Synthetic fixture page</p>");
	const fixture = createTeamBridgeFixture({ root });
	rigs.push(fixture);
	return fixture;
}
const get = (url: string, path: string) =>
	fetch(`${url}${path}`, { signal: AbortSignal.timeout(2000) });
const api = "/mock-hub/populated/v1/messaging";
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

describe("owned Team Bridge fixture lifecycle", () => {
	it("does not create a server as an import side effect", async () => {
		vi.resetModules();
		vi.mocked(createServer).mockClear();
		await import("./mock-team-bridge.ts");
		expect(createServer).not.toHaveBeenCalled();
	});

	it("has pure CLI defaults and can close before any listen", async () => {
		expect(fixtureArguments([])).toEqual({
			root: resolve("dist"),
			port: 18743,
		});
		expect(fixtureArguments(["fixture-root", "0"])).toEqual({
			root: resolve("fixture-root"),
			port: 0,
		});
		const fixture = await rig();
		const first = fixture.close();
		expect(fixture.close()).toBe(first);
		await first;
		await expect(fixture.listen()).rejects.toThrow("closed");
	});
	it("binds actual ephemeral loopback, serves unchanged HTTP shape and closes its listener", async () => {
		const fixture = await rig();
		const { url, host, port } = await fixture.listen();
		expect(host).toBe("127.0.0.1");
		expect(port).toBeGreaterThan(0);
		const answer = await get(url, `${api}/status`);
		expect(answer.status).toBe(200);
		expect((await answer.json()).result.api_version).toBe("1");
		await fixture.close();
		await expect(get(url, `${api}/status`)).rejects.toThrow();
	});
	it("rejects wildcard hosts and invalid ports without opening a listener", async () => {
		const fixture = await rig();
		await expect(fixture.listen({ host: "0.0.0.0" })).rejects.toThrow(
			"invalid",
		);
		for (const port of [-1, 65536, 1.5, Number.NaN]) {
			await expect(fixture.listen({ port })).rejects.toThrow("invalid");
			expect(() => fixtureArguments(["fixture-root", String(port)])).toThrow(
				"invalid",
			);
		}
		await fixture.close();
	});
	it("reports a bind error but still disposes the failed instance normally", async () => {
		const first = await rig();
		const { port } = await first.listen();
		const second = await rig();
		await expect(second.listen({ port })).rejects.toMatchObject({
			code: "EADDRINUSE",
		});
		await second.close();
	});
	it("settles a concurrent starting-listen and repeated close without a successor listener", async () => {
		const fixture = await rig();
		const starting = Promise.allSettled([fixture.listen()]);
		const closing = fixture.close();
		expect(fixture.close()).toBe(closing);
		await starting;
		await closing;
		await expect(fixture.listen()).rejects.toThrow("closed");
	});
	it("isolates created conversations, message histories and counters across factories", async () => {
		const first = await rig();
		const second = await rig();
		const a = await first.listen();
		const b = await second.listen();
		const created = await fetch(`${a.url}${api}/conversations`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				members: [
					{ account_id: "fixture-person", display_label: "Fixture person" },
				],
			}),
			signal: AbortSignal.timeout(2000),
		});
		expect(created.status).toBe(200);
		expect((await (await get(a.url, "/__stats")).json()).result.created).toBe(
			1,
		);
		expect((await (await get(b.url, "/__stats")).json()).result.created).toBe(
			0,
		);
		const post = await fetch(
			`${a.url}${api}/conversations/bcv_humans/messages`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ body: "Synthetic isolated message" }),
				signal: AbortSignal.timeout(2000),
			},
		);
		expect(post.status).toBe(200);
		await post.arrayBuffer();
		const left = (
			await (
				await get(a.url, `${api}/conversations/bcv_humans/messages`)
			).json()
		).result.messages;
		const right = (
			await (
				await get(b.url, `${api}/conversations/bcv_humans/messages`)
			).json()
		).result.messages;
		expect(left).toHaveLength(right.length + 1);
	});
	it("cancels an admitted loading wait instead of leaving its twelve-second timer alive", async () => {
		const fixture = await rig();
		const { url } = await fixture.listen();
		const controller = new AbortController();
		const pending = fetch(
			`${url}/mock-hub/loading/v1/messaging/conversations`,
			{ signal: controller.signal },
		).then(
			() => "answered",
			() => "closed",
		);
		try {
			await expect
				.poll(async () =>
					(await (await get(url, "/__stats")).json()).result.requests.some(
						(row: { path: string }) => row.path === "/conversations",
					),
				)
				.toBe(true);
			await fixture.close();
			expect(await pending).toBe("closed");
		} finally {
			controller.abort();
		}
	});
	it("serves known authorized projections and preserves actual backend500 refusal", async () => {
		const fixture = await rig();
		const { url } = await fixture.listen();
		for (const variant of [
			"delivery-owner",
			"delivery-sender",
			"delivery-agent-owner",
			"delivery-sending-agent",
			"delivery-legacy",
			"delivery-delivered",
		]) {
			const response = await get(
				url,
				`/mock-hub/${variant}/v1/messaging/conversations/bcv_humans/messages`,
			);
			expect(response.status).toBe(200);
			const row = (await response.json()).result.messages[0];
			if (variant === "delivery-legacy")
				expect(Object.hasOwn(row, "delivery_states")).toBe(false);
			else expect(Array.isArray(row.delivery_states)).toBe(true);
			if (variant === "delivery-sending-agent")
				expect(
					row.delivery_states.every(
						(entry: object) => !Object.hasOwn(entry, "refusal_class"),
					),
				).toBe(true);
		}
		expect(
			(
				await get(
					url,
					"/mock-hub/delivery-read-error/v1/messaging/conversations/bcv_humans/messages",
				)
			).status,
		).toBe(500);
	});
	it("drains an owned incomplete request body and socket before close resolves", async () => {
		const fixture = await rig();
		const { url } = await fixture.listen();
		let req: ReturnType<typeof request> | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const closed = new Promise<void>((done) => {
			req = request(`${url}${api}/conversations`, {
				method: "POST",
				agent: false,
				headers: {
					"content-type": "application/json",
					"transfer-encoding": "chunked",
				},
			});
			req.on("error", () => {});
			req.once("close", () => {
				clearTimeout(timer);
				done();
			});
			timer = setTimeout(() => req?.destroy(), 2500);
			req.write('{"members":');
		});
		try {
			await expect
				.poll(async () =>
					(await (await get(url, "/__stats")).json()).result.requests.some(
						(row: { method: string }) => row.method === "POST",
					),
				)
				.toBe(true);
			await fixture.close();
			await closed;
		} finally {
			clearTimeout(timer);
			req?.destroy();
		}
	});
	it("serves static bytes and refuses later connections after awaited close", async () => {
		const fixture = await rig();
		const { url } = await fixture.listen();
		const response = await get(url, "/");
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("Synthetic fixture page");
		await fixture.close();
		await expect(get(url, "/")).rejects.toThrow();
	});
	it("cancels an owned static response body while preserving awaited close", async () => {
		const fixture = await rig();
		const root = directories.at(-1);
		if (!root) throw new Error("owned static root absent");
		await writeFile(join(root, "large.js"), Buffer.alloc(8 * 1024 * 1024, 32));
		const { url } = await fixture.listen();
		let req: ReturnType<typeof request> | undefined;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		let admitted: () => void = () => {};
		const bodyStarted = new Promise<void>((done) => {
			admitted = done;
		});
		const terminated = new Promise<string>((done) => {
			req = request(`${url}/large.js`, { agent: false }, (res) => {
				res.once("data", () => {
					res.pause();
					admitted();
				});
				res.once("aborted", () => done("aborted"));
				res.once("end", () => done("ended"));
				res.once("error", () => done("aborted"));
			});
			req.once("error", () => {
				admitted();
				done("aborted");
			});
			deadline = setTimeout(() => req?.destroy(), 3000);
			req.end();
		});
		try {
			await bodyStarted;
			await fixture.close();
			expect(await terminated).toBe("aborted");
			await expect(get(url, "/large.js")).rejects.toThrow();
		} finally {
			clearTimeout(deadline);
			req?.destroy();
		}
	});
});
