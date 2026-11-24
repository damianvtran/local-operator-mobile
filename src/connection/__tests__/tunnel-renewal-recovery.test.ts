import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { tunnelSessionRelayError } from "../../features/auth/refusal";
import { createRelayClient } from "../client-factory";
import {
	type TunnelSession,
	TunnelSessionError,
	TunnelSessionManager,
} from "../tunnel-session";

const hostname = `${"0".repeat(32)}-lop.radienthq.com`;
const expired = (): TunnelSession => ({
	grant: "synthetic-expired",
	grantExpiresAt: 0,
	refreshHandle: "synthetic-handle",
	refreshExpiresAt: Date.now() + 86400000,
	hostname,
	tunnelId: "synthetic-computer",
	mintedAt: Date.now(),
});
const tokens = {
	access_token: "synthetic-fresh",
	refresh_token: "synthetic-handle",
	expires_in: 300,
};

// The foreground owner calls usableSession WITHOUT a request signal. List and
// transcript opens then join that flight, so their own timeouts cannot retire it.
describe("tunnel renewal recovery over HTTP", () => {
	it.each(["headers", "body", "network", "rate-limit"] as const)(
		"releases a %s failure so a fresh client request recovers",
		async (mode) => {
			let requests = 0;
			let relayReads = 0;
			const server = createServer((request, response) => {
				if (request.url?.startsWith("/api/sessions")) {
					relayReads += 1;
					expect(request.headers.cookie).toContain("synthetic-fresh");
					response.setHeader("content-type", "application/json");
					response.end(JSON.stringify({ sessions: [], degraded: [] }));
					return;
				}
				requests += 1;
				if (requests === 1) {
					if (mode === "body") {
						response.writeHead(200, { "content-type": "application/json" });
						response.write('{"access_token":');
					}
					if (mode === "network") request.socket.destroy();
					if (mode === "rate-limit") {
						response.writeHead(429, {
							"content-type": "application/json",
							"retry-after": "7",
						});
						response.end(JSON.stringify({ error: "rate limited" }));
					}
					return; // suspended route never completes headers/body
				}
				response.setHeader("content-type", "application/json");
				response.end(JSON.stringify(tokens));
			});
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("missing port");
			const origin = `http://127.0.0.1:${address.port}`;
			const manager = new TunnelSessionManager({
				apiBase: origin,
				timeoutMs: 60,
				oauthAccessToken: async () => "synthetic-oauth",
				initial: expired(),
			});
			const client = createRelayClient({
				route: { mode: "radient", hostname, tunnelId: "synthetic-computer" },
				tunnelSession: async (signal) => {
					try {
						return await manager.usableSession(signal);
					} catch (error) {
						if (error instanceof TunnelSessionError)
							throw tunnelSessionRelayError(error);
						throw error;
					}
				},
				fetchImpl: (url, init) =>
					fetch(`${origin}${new URL(String(url)).pathname}`, init),
			});
			let guard: ReturnType<typeof setTimeout> | undefined;
			try {
				const started = performance.now();
				const foreground = manager.usableSession();
				const switching = client.sessions();
				const outcomes = await Promise.race([
					Promise.allSettled([foreground, switching]),
					new Promise<never>((_, reject) => {
						guard = setTimeout(
							() => reject(new Error("renewal remained stuck after 250ms")),
							250,
						);
					}),
				]);
				expect(outcomes.map((outcome) => outcome.status)).toEqual([
					"rejected",
					"rejected",
				]);
				expect(requests).toBe(1);
				if (mode === "rate-limit") {
					expect(outcomes[0]).toMatchObject({
						status: "rejected",
						reason: {
							failure: "rate-limited",
							status: 429,
							retryAfterMs: 7000,
						},
					});
					expect(outcomes[1]).toMatchObject({
						status: "rejected",
						reason: { status: 429, retryAfterMs: 7000 },
					});
				}
				if (mode !== "rate-limit") {
					expect(outcomes[0]).toMatchObject({
						status: "rejected",
						reason: { failure: "network" },
					});
				}
				expect(relayReads).toBe(0);
				expect(manager.current?.grant).toBe("synthetic-expired");
				await expect(client.sessions()).resolves.toMatchObject({
					sessions: [],
				});
				expect(manager.current?.grant).toBe("synthetic-fresh");
				expect(requests).toBe(2);
				expect(relayReads).toBe(1);
				console.info(
					`recovery ${mode}: refresh=${requests}, relay=${relayReads}, elapsed=${Math.round(performance.now() - started)}ms; refresh 200 -> list 200`,
				);
			} finally {
				if (guard !== undefined) clearTimeout(guard);
				server.closeAllConnections();
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		},
	);

	it("retires through the control plane when the old tunnel's logout hangs", async () => {
		const paths: string[] = [];
		const server = createServer((request, response) => {
			paths.push(request.url ?? "");
			if (request.url === "/_radient/logout") return;
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ revoked: true }));
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("missing port");
		const origin = `http://127.0.0.1:${address.port}`;
		const manager = new TunnelSessionManager({
			initial: expired(),
			apiBase: origin,
			timeoutMs: 30,
			oauthAccessToken: async () => "synthetic-oauth",
			fetchImpl: (url, init) =>
				fetch(`${origin}${new URL(String(url)).pathname}`, init),
		});
		let guard: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				manager.retire(),
				new Promise<never>((_, reject) => {
					guard = setTimeout(
						() =>
							reject(
								new Error("retirement barrier remained stuck after 250ms"),
							),
						250,
					);
				}),
			]);
			expect(paths).toEqual(["/_radient/logout", "/v1/tunnels/session/logout"]);
			expect(manager.current).toBeNull();
		} finally {
			if (guard !== undefined) clearTimeout(guard);
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("settles a retired hung flight without reviving or persisting its account", async () => {
		let persisted = 0;
		const manager = new TunnelSessionManager({
			initial: expired(),
			timeoutMs: 20,
			oauthAccessToken: async () => "synthetic-oauth",
			fetchImpl: async () => new Promise<Response>(() => {}),
			persist: async () => {
				persisted += 1;
			},
		});
		const flight = manager.usableSession();
		const rejected = expect(flight).rejects.toMatchObject({
			failure: "network",
		});
		await manager.retire(false);
		await rejected;
		expect(manager.current).toBeNull();
		expect(persisted).toBe(0);
		await expect(manager.usableSession()).rejects.toBeDefined();
	});

	it("bounds a platform fetch that ignores abort, and does not adopt its late answer", async () => {
		let answer: (response: Response) => void = () => {};
		let calls = 0;
		const manager = new TunnelSessionManager({
			initial: expired(),
			timeoutMs: 20,
			oauthAccessToken: async () => "synthetic-oauth",
			fetchImpl: async () => {
				calls += 1;
				if (calls === 1)
					return new Promise<Response>((resolve) => {
						answer = resolve;
					});
				return Response.json(tokens);
			},
		});
		await expect(manager.usableSession()).rejects.toMatchObject({
			failure: "network",
		});
		await expect(manager.usableSession()).resolves.toMatchObject({
			grant: "synthetic-fresh",
		});
		answer(Response.json({ ...tokens, access_token: "synthetic-obsolete" }));
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(manager.current?.grant).toBe("synthetic-fresh");
		expect(calls).toBe(2);
	});
});
