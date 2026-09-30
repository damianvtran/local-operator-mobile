/**
 * A dependency-free static file server on loopback, for serving a build
 * directory to the browser harnesses.
 *
 * Deliberately small, and deliberately SPA-aware: the app under test is an
 * Expo Router export, so a deep link like `/session/abc` has no matching file
 * on disk and must fall back to `index.html` or the navigation story cannot be
 * exercised at all. The fallback is only for extensionless paths — a missing
 * `.js` must still 404, or a broken bundle import silently returns HTML and the
 * failure surfaces as a confusing syntax error in the console.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".txt": "text/plain; charset=utf-8",
	".wasm": "application/wasm",
};

/**
 * Start a static server rooted at `rootDir` on an ephemeral loopback port.
 * Resolves to `{ url, port, close() }`. Port 0 means the OS picks, so two
 * harnesses in one CI job never collide.
 */
export async function serveDir(rootDir, { port = 0, host = "127.0.0.1" } = {}) {
	const root = resolve(rootDir);
	if (!existsSync(root)) throw new Error(`static root does not exist: ${root}`);

	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`);
		let pathname;
		try {
			pathname = decodeURIComponent(url.pathname);
		} catch {
			res.writeHead(400, { "content-type": "text/plain" });
			res.end("bad request");
			return;
		}
		let target = resolve(join(root, normalize(pathname)));
		// Traversal guard: a path that escapes the root is a 404, not a file read.
		if (target !== root && !target.startsWith(root + sep)) {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found");
			return;
		}
		if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
		if (!existsSync(target) && extname(pathname) === "") target = join(root, "index.html");
		if (!existsSync(target) || statSync(target).isDirectory()) {
			res.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
			res.end("not found");
			return;
		}
		res.writeHead(200, {
			"content-type": TYPES[extname(target)] ?? "application/octet-stream",
			// A capture must never render a cached bundle from a previous run.
			"cache-control": "no-store",
			"access-control-allow-origin": "*",
		});
		createReadStream(target).pipe(res);
	});

	await new Promise((resolvePromise, reject) => {
		server.once("error", reject);
		server.listen(port, host, resolvePromise);
	});
	const actual = server.address().port;
	return {
		url: `http://${host}:${actual}`,
		port: actual,
		root,
		close: () => new Promise((done) => server.close(done)),
	};
}
