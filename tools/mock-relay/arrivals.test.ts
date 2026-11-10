import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createArrivalLog, userAgentClass } from "./arrivals.ts";

/* Against a real listener: the property under test is the difference between
 * ARRIVAL and COMPLETION on actual sockets, which a stubbed req/res cannot show. */
let server: Server | null = null;
afterEach(async () => {
	await new Promise<void>((done) =>
		server ? server.close(() => done()) : done(),
	);
	server = null;
});

async function listen(log: ReturnType<typeof createArrivalLog>) {
	server = createServer((req, res) => {
		const path = (req.url ?? "/").split("?")[0] ?? "/";
		log.arrive(req, res, path);
		if (path === "/stream") {
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.write(": open\n\n");
			return; // held open, like an SSE stream
		}
		res.writeHead(303, { location: "/" });
		res.end();
	});
	await new Promise<void>((done) => server?.listen(0, "127.0.0.1", done));
	return (server.address() as AddressInfo).port;
}

const get = (port: number, path: string, ua?: string) =>
	new Promise<ReturnType<typeof request>>((resolve) => {
		const req = request({
			host: "127.0.0.1",
			port,
			path,
			headers: ua ? { "user-agent": ua, cookie: "lo_session=secret" } : {},
		});
		req.on("response", (res) => {
			res.once("data", () => resolve(req));
			res.once("end", () => resolve(req));
			res.resume();
		});
		req.on("error", () => undefined);
		req.end();
	});

describe("mock relay arrival log", () => {
	it("records a finished request with its status and no query string", async () => {
		const log = createArrivalLog();
		const port = await listen(log);
		await get(
			port,
			"/login?password=nope",
			"LocalOperator/348 CFNetwork/3826 Darwin/25",
		);
		await new Promise((done) => setTimeout(done, 20));
		const { rows, open } = log.snapshot();
		expect(open).toHaveLength(0);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			method: "GET",
			path: "/login",
			userAgent: "ios-native",
			outcome: "finished",
			status: 303,
		});
		expect(JSON.stringify(rows)).not.toMatch(/nope|secret|CFNetwork/);
	});

	it("shows a stream that arrived and never finished as open, then aborted", async () => {
		const log = createArrivalLog();
		const port = await listen(log);
		const req = await get(port, "/stream");
		expect(log.snapshot().open.map((row) => row.path)).toEqual(["/stream"]);
		req.destroy();
		await new Promise((done) => setTimeout(done, 50));
		const [row] = log.snapshot().rows;
		expect(row?.outcome).toBe("aborted");
		expect(log.snapshot().open).toHaveLength(0);
	});

	it("is bounded, oldest dropped", async () => {
		const log = createArrivalLog(2);
		const port = await listen(log);
		for (const path of ["/a", "/b", "/c"]) await get(port, path);
		expect(log.snapshot().rows.map((row) => row.path)).toEqual(["/b", "/c"]);
	});

	it("classifies user agents without keeping them", () => {
		expect(userAgentClass(undefined)).toBe("none");
		expect(userAgentClass("okhttp/4.12.0")).toBe("android-native");
		expect(userAgentClass("Mozilla/5.0 (iPhone)")).toBe("browser");
		expect(userAgentClass("node")).toBe("node");
		expect(userAgentClass("curl/8.7.1")).toBe("curl");
		expect(userAgentClass("weird")).toBe("other");
	});
});
