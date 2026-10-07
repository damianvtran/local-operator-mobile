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
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

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
		// Headers are passed through except two, and both exceptions exist because
		// the proxy is a *server-side* hop rather than a browser one:
		//
		//  - `host` must name the upstream, not the proxy;
		//  - `origin` must be RE-WRITTEN, not forwarded. The browser sets it to this
		//    proxy's own origin (that is the URL it called), and forwarding that
		//    verbatim makes a same-origin request arrive at the relay as a FOREIGN
		//    one — so the relay's CSRF rule refuses every mutation and `POST /login`
		//    can never succeed, which is a relay-backed cell that renders the
		//    degraded screen for a harness reason. The relay's own origin is what
		//    the hop really is, and the relay allows its own origin (see
		//    `RelayState.allowedOrigins`).
		//
		// The cookie and `x-radient-*` headers the relay reads are all preserved,
		// which is the point of proxying rather than rewriting.
		const headers = new Headers();
		for (const [key, value] of Object.entries(req.headers)) {
			if (key === "host" || key === "origin" || value === undefined) continue;
			headers.set(key, Array.isArray(value) ? value.join(", ") : value);
		}
		if (req.headers.origin !== undefined)
			headers.set("origin", new URL(upstream).origin);
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
			// The body is PIPED, never buffered.
			//
			// `await upstreamRes.arrayBuffer()` does not resolve for a response that
			// never ends, and the relay has one: `/api/sessions/<id>/events` is an
			// endless `text/event-stream` (the app's live transcript). Buffering it
			// meant that route answered **no status line and no bytes at all** through
			// this proxy — `http=000`, 0 B — while the same request called directly was
			// a live stream. A hop that cannot carry the one response the app is built
			// around is not a hop. Piping also keeps the hop's memory bounded by what
			// is in flight rather than by the whole body.
			const outHeaders: Record<string, string> = {};
			upstreamRes.headers.forEach((value, key) => {
				// Three headers must not be copied onto the response, and each for its
				// own reason:
				//
				//  - content-length is recomputed by Node, and is not even available for a
				//    streamed body (Node frames it as chunked instead);
				//  - content-encoding describes the bytes the UPSTREAM sent, but
				//    `fetch` has already decompressed the body by the time it is read
				//    here. Forwarding it makes the browser try to un-gzip a plain
				//    body and fail with ERR_CONTENT_DECODING_FAILED — so `/api/sessions`
				//    never resolves and EVERY relay-backed cell renders the app's
				//    degraded screen with no rows, which is a harness fault wearing the
				//    app's name. Dropped alongside content-length, which is the same
				//    class of header: one the hop re-derives rather than passes on;
				//  - set-cookie is handled below, because its multiple values must not
				//    be folded into one header.
				if (key === "content-length" || key === "content-encoding") return;
				outHeaders[key] = value;
			});
			const cookies = upstreamRes.headers.getSetCookie?.() ?? [];
			res.writeHead(
				upstreamRes.status,
				cookies.length > 0
					? { ...outHeaders, "set-cookie": cookies }
					: outHeaders,
			);
			if (upstreamRes.body === null) {
				res.end();
			} else {
				// `pipeline`, not a hand-rolled read loop: it propagates an upstream error
				// onto the client's socket and destroys BOTH ends, so a stream the relay
				// ends early (the gateway's 60 s cap, `--fault sse-cut-after`) closes the
				// connection instead of leaving a half-open one behind, and a client that
				// goes away mid-stream tears down the upstream fetch with it.
				//
				// The cast is the DOM/node stream-type seam: `lib: ["esnext", "dom"]`
				// types `upstreamRes.body` as the DOM `ReadableStream` and `Readable.fromWeb`
				// takes `node:stream/web`'s — the same object at runtime (Node's fetch is
				// undici, whose bodies are node web streams).
				await pipeline(
					Readable.fromWeb(upstreamRes.body as unknown as NodeReadableStream),
					res,
				);
			}
		} catch (error) {
			// An abort is the shutdown path, not a failure to report to the page.
			if (error instanceof Error && error.name === "AbortError") {
				if (!res.writableEnded) res.destroy();
				return;
			}
			// Once the status and headers are on the wire a 502 cannot be sent over
			// them, and pretending otherwise would throw a second error over the first:
			// a stream that fails mid-flight is ended, never re-answered.
			if (res.headersSent) {
				res.destroy();
				return;
			}
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

	/* The browser reuses an idle socket on its own schedule — Chrome holds them
	 * for minutes — while a Node server drops one after `keepAliveTimeout` (5 s by
	 * default). In the overlap the page reuses a socket the server just closed and
	 * writes its next request into it: a GET the browser will retry on a fresh
	 * socket, so the loss is invisible, but a POST with a body no client silently
	 * retries — it pends until its own deadline and the server never sees it.
	 * Measured: the frame rig's send click landed 5.1 s after the last request and
	 * the relay never saw its `POST …/command` (frames-rig run
	 * 2026-10-07T00-14-45), the same drive clicking inside the window always sent.
	 * Raising the window past any client's reuse leaves the kill to the client,
	 * where it is safe (Node's own guidance for servers browsers talk to; 65 s is
	 * the nginx-family default for the same reason). `headersTimeout` must exceed
	 * `keepAliveTimeout`. */
	server.keepAliveTimeout = 65_000;
	server.headersTimeout = 66_000;

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
