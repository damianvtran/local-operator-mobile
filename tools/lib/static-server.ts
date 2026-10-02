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
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

/**
 * The routes a proxied upstream owns when `serveDir` is given one.
 *
 * The app under test is a native client compiled for the web: it talks to the
 * relay on its own origin. Serving that build from a *different* origin than the
 * relay leaves every relay-backed cell rendering an app with no route — measured
 * on 320 px, five different `S4` states produced one byte-identical image of the
 * unauthenticated screen while the audit reported 408 PASS rows. Forwarding the
 * relay's own paths at the SAME origin is what fixes it, and it needs no
 * page-side seeding: the app's configured route is simply this origin.
 *
 * A path is proxied when it matches these prefixes exactly; everything else
 * stays a file lookup, so the app's own bundle is never shadowed.
 */
export const PROXIED_PREFIXES = [
	"/api/",
	"/healthz",
	"/login",
	"/logout",
	"/assets/",
] as const;

/** True when a path belongs to the relay rather than to the app bundle. */
export function isProxiedPath(pathname: string): boolean {
	return PROXIED_PREFIXES.some((prefix) =>
		prefix.endsWith("/")
			? pathname.startsWith(prefix)
			: pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".ts": "text/javascript; charset=utf-8",
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
/** Read a request body fully; used only on the proxied mutation path. */
async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req)
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
	return Buffer.concat(chunks);
}

export interface ServeOptions {
	port?: number;
	host?: string;
	/**
	 * A relay origin to forward `PROXIED_PREFIXES` to, so the app and the relay
	 * share one origin. Omitted means a plain static server.
	 */
	proxy?: string | undefined;
}

export interface ServedDir {
	url: string;
	port: number;
	proxy: string | null;
	close: () => Promise<void>;
}

export async function serveDir(
	rootDir: string,
	{ port = 0, host = "127.0.0.1", proxy }: ServeOptions = {},
): Promise<ServedDir> {
	const root = resolve(rootDir);
	if (!existsSync(root)) throw new Error(`static root does not exist: ${root}`);
	const upstream = proxy === undefined ? null : new URL(proxy).origin;

	const forward = async (
		req: IncomingMessage,
		res: ServerResponse,
		url: URL,
	): Promise<void> => {
		if (upstream === null) {
			res.writeHead(502, { "content-type": "text/plain" });
			res.end("no proxy upstream configured");
			return;
		}
		// Headers are passed through except `host`, which must name the upstream;
		// the cookie and `x-radient-*` headers the relay reads are all preserved,
		// which is the point of proxying rather than rewriting.
		const headers = new Headers();
		for (const [key, value] of Object.entries(req.headers)) {
			if (key === "host" || value === undefined) continue;
			headers.set(key, Array.isArray(value) ? value.join(", ") : value);
		}
		const body =
			req.method === "GET" || req.method === "HEAD"
				? undefined
				: await readBody(req);
		const controller = new AbortController();
		upstreams.add(controller);
		try {
			const upstreamRes = await fetch(
				`${upstream}${url.pathname}${url.search}`,
				{
					method: req.method ?? "GET",
					headers,
					body: body === undefined ? undefined : new Uint8Array(body),
					redirect: "manual",
					signal: controller.signal,
				},
			);
			// `Uint8Array`, not `Buffer`: Node's fetch accepts the former as a body and
			// the DOM `BodyInit` type does not include `Buffer`'s shape, so passing a
			// Buffer is a type error even though it works at runtime.
			const out = new Uint8Array(await upstreamRes.arrayBuffer());
			const outHeaders: Record<string, string> = {};
			upstreamRes.headers.forEach((value, key) => {
				// Content-length is recomputed by Node; set-cookie is handled below
				// because its multiple values must not be folded into one header.
				if (key === "content-length") return;
				outHeaders[key] = value;
			});
			const cookies = upstreamRes.headers.getSetCookie?.() ?? [];
			res.writeHead(
				upstreamRes.status,
				cookies.length > 0
					? { ...outHeaders, "set-cookie": cookies }
					: outHeaders,
			);
			res.end(out);
		} catch (error) {
			// An abort is the shutdown path, not a failure to report to the page.
			if (error instanceof Error && error.name === "AbortError") return;
			const reason = error instanceof Error ? error.message : String(error);
			res.writeHead(502, { "content-type": "text/plain" });
			res.end(`proxy upstream unreachable: ${reason}`);
		} finally {
			upstreams.delete(controller);
		}
	};

	const upstreams = new Set<AbortController>();

	/** Close within a bound, destroying what is still open rather than waiting. */
	const closeServer = (): Promise<void> =>
		new Promise<void>((done) => {
			let settled = false;
			const finish = (): void => {
				if (settled) return;
				settled = true;
				done();
			};
			server.close(() => finish());
			// The proxied SSE connections are the ones that never end on their own.
			server.closeAllConnections?.();
			for (const controller of upstreams) controller.abort();
			upstreams.clear();
			const timer = setTimeout(finish, 2000);
			timer.unref?.();
		});

	const server = createServer(async (req, res) => {
		const url = new URL(
			req.url ?? "/",
			`http://${req.headers.host ?? "127.0.0.1"}`,
		);
		if (upstream !== null && isProxiedPath(url.pathname)) {
			await forward(req, res, url);
			return;
		}
		let pathname: string;
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
		if (existsSync(target) && statSync(target).isDirectory())
			target = join(target, "index.html");
		if (!existsSync(target) && extname(pathname) === "")
			target = join(root, "index.html");
		if (!existsSync(target) || statSync(target).isDirectory()) {
			res.writeHead(404, {
				"content-type": "text/plain",
				"cache-control": "no-store",
			});
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

	await new Promise<void>((resolvePromise, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => resolvePromise());
	});
	const address = server.address();
	const actual =
		typeof address === "object" && address !== null ? address.port : 0;
	return {
		url: `http://${host}:${actual}`,
		port: actual,
		proxy: upstream,
		close: () => closeServer(),
	};
}

/**
 * Close the server, and never wait on a client that will not go away.
 *
 * `server.close()` calls back only once every connection has ended, and this
 * server proxies the relay's event stream — so a page that opened an SSE stream
 * holds a connection open forever and the callback never fires. That is a hang,
 * not a slow shutdown: measured in CI, the capture step ran past a 45-minute job
 * timeout with a completed capture sitting behind a close that could not finish.
 *
 * The order that terminates: refuse new connections, drop the open ones, abort
 * the upstream fetches they were riding, and bound the wait — because even
 * `closeAllConnections` can be raced by a connection arriving in the same tick.
 */
