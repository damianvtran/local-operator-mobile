/**
 * The tunnel route's cookie policy, driven end to end.
 *
 * The client under test is the real `createRelayClient` making real `fetch`
 * calls to a local `node:http` server that records the exact bytes of the
 * `Cookie` header it receives. Asserting on the wire is the point: a unit test of
 * a header-building function would keep passing if some other layer appended a
 * second cookie, which is the defect this guards (the 30-day refresh handle
 * riding on every request, ADR 0002 §6 / `tunnel-edge.md` §2.1).
 */

import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import type { TunnelSession } from "../index";
import { createRelayClient } from "../index";

const GRANT_COOKIE = "__Host-radient-grant";
const REFRESH_COOKIE = "__Host-radient-refresh";

const servers: Server[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

/** A relay that records every request's headers and answers `/healthz` with the
 *  supplied extra headers — used to make the "edge" try to set cookies. */
async function relay(responseHeaders: Record<string, string | string[]>) {
	const seen: IncomingHttpHeaders[] = [];
	const server = createServer((request, response) => {
		seen.push(request.headers);
		response.writeHead(200, {
			"content-type": "application/json",
			...responseHeaders,
		});
		response.end(
			JSON.stringify({ ok: true, version: 5, sessions: 0, dist: false }),
		);
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { seen, port: (server.address() as AddressInfo).port };
}

function session(overrides: Partial<TunnelSession> = {}): TunnelSession {
	return {
		grant: "grant-jwt",
		refreshHandle: "handle-secret-30-days",
		grantExpiresAt: 0,
		refreshExpiresAt: 0,
		hostname: "0123456789abcdef0123456789abcdef-lop.radienthq.com",
		tunnelId: "t-1",
		mintedAt: 0,
		...overrides,
	};
}

/** The tunnel origin is https and fixed by the route, so the request is redirected
 *  to the local server by a fetch that rewrites only the URL — the headers the
 *  client built are passed through untouched, which is what is being asserted. */
function toLocal(port: number): typeof globalThis.fetch {
	return (input, init) => {
		const url = new URL(typeof input === "string" ? input : input.toString());
		return globalThis.fetch(
			`http://127.0.0.1:${port}${url.pathname}${url.search}`,
			init,
		);
	};
}

describe("the tunnel route sends the grant and nothing else", () => {
	it("puts exactly one cookie on the wire, and never the refresh handle", async () => {
		const { seen, port } = await relay({});
		const client = createRelayClient({
			route: {
				mode: "radient",
				hostname: session().hostname,
				tunnelId: "t-1",
			},
			tunnelSession: () => session(),
			fetchImpl: toLocal(port),
		});
		await client.healthz();
		await client.healthz();

		expect(seen).toHaveLength(2);
		for (const headers of seen) {
			expect(headers.cookie).toBe(`${GRANT_COOKIE}=grant-jwt`);
			expect(String(headers.cookie)).not.toContain(REFRESH_COOKIE);
			expect(String(headers.cookie)).not.toContain("handle-secret");
			expect(headers.origin).toBe(`https://${session().hostname}`);
		}
	});

	it("ignores every response cookie and sends the same header afterwards", async () => {
		/* The edge (or anything in front of it) tries to rotate both cookies. The
		 * app must neither adopt them nor let them change what it sends next. */
		const { seen, port } = await relay({
			"set-cookie": [
				`${GRANT_COOKIE}=edge-issued-grant; Path=/; Secure; HttpOnly`,
				`${REFRESH_COOKIE}=edge-issued-handle; Path=/; Secure; HttpOnly`,
			],
		});
		const client = createRelayClient({
			route: {
				mode: "radient",
				hostname: session().hostname,
				tunnelId: "t-1",
			},
			tunnelSession: () => session(),
			fetchImpl: toLocal(port),
		});
		await client.healthz();
		await client.healthz();

		expect(seen[1]?.cookie).toBe(`${GRANT_COOKIE}=grant-jwt`);
		expect(String(seen[1]?.cookie)).not.toContain("edge-issued");
	});

	it("treats an empty grant as absent instead of sending a blank credential", async () => {
		const { seen, port } = await relay({});
		const client = createRelayClient({
			route: {
				mode: "radient",
				hostname: session().hostname,
				tunnelId: "t-1",
			},
			tunnelSession: () => session({ grant: "   " }),
			fetchImpl: toLocal(port),
		});
		await client.healthz();
		expect(seen[0]?.cookie).toBeUndefined();
	});

	it("follows a grant refreshed between requests, since it is read per request", async () => {
		const { seen, port } = await relay({});
		let current = session();
		const client = createRelayClient({
			route: {
				mode: "radient",
				hostname: current.hostname,
				tunnelId: "t-1",
			},
			tunnelSession: () => current,
			fetchImpl: toLocal(port),
		});
		await client.healthz();
		current = session({ grant: "grant-after-refresh" });
		await client.healthz();
		expect(seen.map((headers) => headers.cookie)).toEqual([
			`${GRANT_COOKIE}=grant-jwt`,
			`${GRANT_COOKIE}=grant-after-refresh`,
		]);
	});
});
