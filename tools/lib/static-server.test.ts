import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serveDir } from "./static-server.ts";

describe("static asset and relay precedence", () => {
	let root: string;
	let outside: string;
	let server: Awaited<ReturnType<typeof serveDir>>;
	let upstream: ReturnType<typeof createServer>;
	let requests: string[];

	beforeEach(async () => {
		root = mkdtempSync(
			join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "static-server-"),
		);
		outside = mkdtempSync(
			join(
				process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
				"static-outside-",
			),
		);
		requests = [];
		upstream = createServer((req, res) => {
			requests.push(req.url ?? "/");
			res.writeHead(req.url?.includes("missing") ? 404 : 200, {
				"content-type": "text/plain",
			});
			res.end(`relay:${req.url}`);
		});
		await new Promise<void>((resolve) =>
			upstream.listen(0, "127.0.0.1", resolve),
		);
		const address = upstream.address();
		if (!address || typeof address === "string")
			throw new Error("no upstream port");
		server = await serveDir(root, {
			proxy: `http://127.0.0.1:${address.port}`,
		});
	});

	afterEach(async () => {
		await server?.close();
		await new Promise<void>((resolve) => upstream.close(() => resolve()));
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});

	function local(path: string, body: string) {
		const file = join(root, path);
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, body);
	}

	// Node's request keeps dot segments intact; fetch/URL normalizes them before
	// sending and would turn a traversal regression into a false passing test.
	function get(path: string): Promise<{ status: number; body: string }> {
		return new Promise((resolve, reject) => {
			request(`${server.url}`, { path }, (res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
			})
				.on("error", reject)
				.end();
		});
	}

	it("serves an existing compiled asset locally with an upstream configured", async () => {
		local("assets/assets/brand/mark.hash.png", "compiled asset");
		expect(await get("/assets/assets/brand/mark.hash.png")).toEqual({
			status: 200,
			body: "compiled asset",
		});
		expect(requests).toEqual([]);
	});

	it.each([
		["app.js", "payload.bin", "text/javascript; charset=utf-8"],
		["mark.png", "image.bin", "image/png"],
		["opaque.unknown", "source.js", "application/octet-stream"],
	])(
		"uses the requested extension for an in-root symlink: %s",
		async (name, storageName, contentType) => {
			local(`assets/${storageName}`, "actual target bytes");
			symlinkSync(storageName, join(root, "assets", name));
			const response = await fetch(`${server.url}/assets/${name}`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe(contentType);
			expect(await response.text()).toBe("actual target bytes");
			expect(requests).toEqual([]);
		},
	);

	it.each([
		["assets/plain.js", "text/javascript; charset=utf-8"],
		["assets/plain.unknown", "application/octet-stream"],
		["docs/", "text/html; charset=utf-8"],
		["deep/link", "text/html; charset=utf-8"],
	])("retains MIME for ordinary files and fallbacks: %s", async (path, type) => {
		local("assets/plain.js", "plain script");
		local("assets/plain.unknown", "opaque bytes");
		local("docs/index.html", "directory index");
		local("index.html", "SPA index");
		const response = await fetch(`${server.url}/${path}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(type);
		expect(requests).toEqual([]);
	});

	it("proxies the same asset URL when the local file is absent", async () => {
		const path = "/assets/assets/brand/mark.hash.png";
		expect(await get(path)).toEqual({ status: 200, body: `relay:${path}` });
		expect(requests).toEqual([path]);
	});

	it("preserves a genuine upstream asset 404", async () => {
		expect(await get("/assets/missing.png")).toEqual({
			status: 404,
			body: "relay:/assets/missing.png",
		});
	});

	it.each([
		"/api/status",
		"/healthz",
		"/login",
		"/logout",
		"/v1/agents/demo/avatar",
	])("keeps backend precedence over a local file at %s", async (path) => {
		local(path, "must not be served");
		expect(await get(path)).toEqual({ status: 200, body: `relay:${path}` });
		expect(requests).toEqual([path]);
	});

	it.each(["/assets/../api/status", "/assets/%2e%2e/api/status"])(
		"proxies normalized backend routes despite the raw asset prefix: %s",
		async (path) => {
			local("api/status", "must not be served");
			expect(await get(path)).toEqual({
				status: 200,
				body: "relay:/api/status",
			});
			expect(requests).toEqual(["/api/status"]);
		},
	);

	it.each(["file", "directory"])(
		"refuses an escaping %s symlink before local precedence or proxy",
		async (kind) => {
			mkdirSync(join(root, "assets"));
			writeFileSync(join(outside, "secret.txt"), "outside secret");
			const path =
				kind === "file" ? "/assets/link.txt" : "/assets/link/secret.txt";
			symlinkSync(
				kind === "file" ? join(outside, "secret.txt") : outside,
				join(root, kind === "file" ? "assets/link.txt" : "assets/link"),
			);
			expect(await get(path)).toEqual({ status: 404, body: "not found" });
			expect(requests).toEqual([]);
		},
	);

	it.each([
		"/assets/../../etc/passwd",
		"/assets/%2e%2e/%2e%2e/etc/passwd",
		"/assets/..%2f..%2fetc/passwd",
	])("refuses traversal without reaching upstream: %s", async (path) => {
		expect(await get(path)).toEqual({ status: 404, body: "not found" });
		expect(requests).toEqual([]);
	});

	it("retains forwarding of double-encoded traversal (pre-existing behavior)", async () => {
		const path = "/assets/%252e%252e/%252e%252e/etc/passwd";
		expect(await get(path)).toEqual({ status: 200, body: `relay:${path}` });
		expect(requests).toEqual([path]);
	});

	it("does not decode unshared backend paths before forwarding", async () => {
		const path = "/api/%ZZ";
		expect(await get(path)).toEqual({ status: 200, body: `relay:${path}` });
		expect(requests).toEqual([path]);
	});

	it("rejects malformed asset escapes", async () => {
		expect(await get("/assets/%ZZ.png")).toEqual({
			status: 400,
			body: "bad request",
		});
		expect(requests).toEqual([]);
	});
});
