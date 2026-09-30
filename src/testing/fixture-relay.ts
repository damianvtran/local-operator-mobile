/**
 * A real HTTP server that plays the relay by replaying `fixtures/relay/**`.
 *
 * It exists so the app's own client can be driven over an actual socket without a
 * `lop` daemon: every response body here is a captured fixture, never a value the
 * test author typed, so a drift between the client and the wire fails a test
 * instead of being agreed with. PR #8 ships a fuller typed mock relay; until it is
 * on `main` this minimal server stands in, and the suite only needs its base URL,
 * so swapping the peer is a one-line change in `startFixtureRelay`'s caller.
 *
 * Auth mirrors the two routes' real rules:
 *
 * - `custom`: `POST /login` with the right password answers `303` and sets
 *   `lop_mobile`; every `/api` route then requires that cookie (`401` otherwise).
 * - `radient`: the edge is modelled as a gate that requires EXACTLY
 *   `__Host-radient-grant=<grant>` in the `Cookie` header and `Origin` equal to
 *   the tunnel origin — so the exact bytes the client sends are what is checked.
 *
 * Every request is recorded (method, path, headers) so a test can assert what the
 * server actually saw.
 */

import {
	createServer,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { loadFixture } from "./fixtures";

/** The payload of a captured fixture (`body` for HTTP, `data` for SSE). */
export function fixtureBody(rel: string): unknown {
	const file = loadFixture<{ body?: unknown; data?: unknown }>(rel);
	return file.body ?? file.data;
}

/* Hoisted: matched on every request the server handles. */
const SESSION_ROUTE =
	/^\/api\/sessions\/([^/]+)\/(events|command|history|seen)$/;

export const FIXTURE_SESSION_ID = "6714def86197";
const PASSWORD = "correct horse";
const COOKIE_NAME = "lop_mobile";

export interface RecordedRequest {
	method: string;
	path: string;
	headers: IncomingHttpHeaders;
	body: unknown;
}

export interface FixtureRelayOptions {
	/** `custom`: cookie login. `radient`: exact grant cookie + tunnel origin. */
	auth:
		| { mode: "custom"; password?: string }
		| { mode: "radient"; grant: string; origin: string };
	/** Close each SSE body after this many ms, as the gateway's lease does. */
	cutStreamAfterMs?: number;
	/** Hold the FIRST stream open and silent (headers, then nothing). */
	silentFirstStream?: boolean;
	/** Answer `POST /login` with a refusal instead of the password flow: a corpus
	 *  fixture path (the captured `http/login-cross-origin.json` is the relay's own 403
	 *  for a page whose `Origin` is not the relay's), a bare status, or an explicit
	 *  `{status, body, contentType}` for a shape the corpus has no capture of — a
	 *  proxy's body-less or HTML 502 is the one that matters, because neither is a
	 *  sentence. A real relay answers this gate BEFORE it looks at a password, which is
	 *  why it is a server option rather than a test's password. */
	loginRefusal?:
		| string
		| number
		| { status: number; body?: string; contentType?: string };
	/** For the Nth (1-based) `POST …/command`, act on it and drop the connection
	 *  before answering — a lost acknowledgement. */
	dropAckOnCommand?: number;
	/** For the Nth (1-based) `POST …/command`, answer the relay's own DEFINITIVE
	 *  rejection (the corpus's `command-unknown-op.json`, a `422`) and admit nothing.
	 *  The counterpart of `dropAckOnCommand`: one leaves the delivery unknown, the
	 *  other proves it never happened, and the retry envelope's rules differ. */
	rejectCommandOn?: number;
	/** Projection frames per stream, in order. Defaults to the live-idle capture. */
	projectionFrames?: (connection: number) => unknown[];
	/** From this SSE connection number on, answer the stream open with 401. */
	rejectStreamsFrom?: number;
	/** Fixture files to serve by the request each one RECORDS (`request.method` +
	 *  `request.path`), for the routes this server does not model by hand. The
	 *  fixtures carry their originating request, so a route table built from them
	 *  cannot drift from the capture: a client that asks for the wrong path gets a
	 *  404 here rather than a passing test. First match wins. */
	replay?: readonly string[];
}

export interface FixtureRelay {
	baseUrl: string;
	requests: RecordedRequest[];
	/** How many times each command_id was ADMITTED (a replay is not a second one). */
	admitted: Map<string, number>;
	/** SSE connections opened, per path. */
	streamOpens: Map<string, number>;
	close(): Promise<void>;
}

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
	});
}

function json(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function startFixtureRelay(
	options: FixtureRelayOptions,
): Promise<FixtureRelay> {
	const requests: RecordedRequest[] = [];
	const admitted = new Map<string, number>();
	const streamOpens = new Map<string, number>();
	const sockets = new Set<import("node:net").Socket>();
	let commandCount = 0;
	let streamCount = 0;
	const session = { token: "" };

	/* Built once from the fixtures' own recorded requests. */
	const replayIndex = new Map<
		string,
		{ status: number; body: unknown; contentType: string }
	>();
	for (const rel of options.replay ?? []) {
		const file = loadFixture<{
			status?: number;
			headers?: Record<string, string>;
			body?: unknown;
			request?: { method?: string; path?: string };
		}>(rel);
		if (!file.request?.method || !file.request.path) continue;
		const contentType = file.headers?.["content-type"] ?? "application/json";
		replayIndex.set(`${file.request.method} ${file.request.path}`, {
			status: file.status ?? 200,
			body: file.body,
			contentType,
		});
	}

	const server: Server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://relay.invalid");
		const path = url.pathname;
		const raw = await readBody(request);
		let parsed: unknown;
		try {
			parsed = raw ? JSON.parse(raw) : undefined;
		} catch {
			parsed = raw;
		}
		requests.push({
			method: request.method ?? "GET",
			path: url.pathname + url.search,
			headers: request.headers,
			body: parsed,
		});

		if (path === "/healthz") {
			json(response, 200, fixtureBody("http/healthz.json"));
			return;
		}

		const { auth } = options;
		if (auth.mode === "custom" && path === "/login") {
			if (options.loginRefusal !== undefined) {
				const refusal = options.loginRefusal;
				if (typeof refusal === "object") {
					response.writeHead(refusal.status, {
						"content-type": refusal.contentType ?? "text/plain",
					});
					response.end(refusal.body ?? "");
					return;
				}
				if (typeof refusal === "number") {
					response.writeHead(refusal);
					response.end();
					return;
				}
				const fixture = loadFixture<{
					status?: number;
					headers?: Record<string, string>;
					body?: unknown;
				}>(refusal);
				response.writeHead(fixture.status ?? 403, {
					"content-type":
						fixture.headers?.["content-type"] ?? "application/json",
				});
				response.end(JSON.stringify(fixture.body ?? {}));
				return;
			}
			const password = new URLSearchParams(raw).get("password");
			if (password !== (auth.password ?? PASSWORD)) {
				response.writeHead(401, { "content-type": "text/html" });
				response.end("<!doctype html><title>login</title>");
				return;
			}
			session.token = `${Date.now()}.signature`;
			response.writeHead(303, {
				location: "/",
				"set-cookie": `${COOKIE_NAME}=${session.token}; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax`,
			});
			response.end();
			return;
		}
		if (auth.mode === "custom" && path === "/logout") {
			session.token = "";
			response.writeHead(303, {
				location: "/login",
				"set-cookie": `${COOKIE_NAME}=""; Max-Age=0; Path=/`,
			});
			response.end();
			return;
		}

		/* The gate. Custom: the jar's cookie. Radient: exact bytes. */
		const cookie = request.headers.cookie ?? "";
		const authorised =
			auth.mode === "custom"
				? session.token !== "" &&
					cookie.includes(`${COOKIE_NAME}=${session.token}`)
				: cookie === `__Host-radient-grant=${auth.grant}` &&
					request.headers.origin === auth.origin;
		if (!authorised) {
			if (auth.mode === "radient") {
				response.writeHead(401, {
					"x-radient-login": "/_radient/login",
					"content-type": "text/plain",
				});
				response.end("Sign in with Radient to access this tunnel");
			} else {
				json(response, 401, fixtureBody("http/unauth-api-sessions.json"));
			}
			return;
		}

		if (path === "/api/sessions" && request.method === "GET") {
			/* The full list frame, not `http/list_row_live.json`: that file is a
			 * single-row EXCERPT with no `degraded` array, and serving it made the
			 * client (correctly) reject the body. */
			json(response, 200, fixtureBody("sse/sse-list-frame.json"));
			return;
		}
		if (path === "/api/models" && request.method === "GET") {
			/* Modelled rather than replayed because the CLIENT reads it on the sign-in
			 * path: `endpoints.admission()` asks the cheapest gated route whether the
			 * cookie was accepted, so a relay that cannot answer it cannot be signed into
			 * from a browser at all. */
			json(response, 200, fixtureBody("http/models.json"));
			return;
		}
		if (path === "/api/sessions/start" && request.method === "POST") {
			json(response, 200, fixtureBody("http/start-session.json"));
			return;
		}
		if (path === "/api/sessions/events") {
			openStream(request, response, path, (connection) => [
				sse("sessions", fixtureBody("sse/sse-list-frame.json")),
				...(connection < 0 ? [] : []),
			]);
			return;
		}
		const sessionRoute = path.match(SESSION_ROUTE);
		if (sessionRoute) {
			const [, , action] = sessionRoute;
			if (action === "events") {
				openStream(request, response, path, (connection) =>
					(options.projectionFrames
						? options.projectionFrames(connection)
						: [fixtureBody("sse/sse-projection-live-idle.json")]
					).map((frame) => sse("projection", frame)),
				);
				return;
			}
			if (action === "history") {
				json(response, 200, fixtureBody("http/history-ok.json"));
				return;
			}
			if (action === "seen") {
				json(response, 200, fixtureBody("http/seen-real-token.json"));
				return;
			}
			if (action === "command") {
				commandCount += 1;
				const body = parsed as { command_id?: string } | undefined;
				const id = body?.command_id ?? "";
				if (options.rejectCommandOn === commandCount) {
					/* The corpus's own `422`: a DEFINITIVE rejection, answered before the
					 * ledger is touched, because "never admitted" is what the client's
					 * envelope disposition reads. */
					json(response, 422, fixtureBody("http/command-unknown-op.json"));
					return;
				}
				const seenBefore = admitted.has(id);
				if (!seenBefore) admitted.set(id, 1);
				/* Acting on the command BEFORE dropping the socket is the point: the
				 * relay admitted it, and only the acknowledgement was lost. */
				if (options.dropAckOnCommand === commandCount) {
					request.socket.destroy();
					return;
				}
				json(
					response,
					200,
					seenBefore
						? fixtureBody("http/command-prompt-duplicate.json")
						: fixtureBody("http/command-prompt-ok.json"),
				);
				return;
			}
		}
		const replayed = replayIndex.get(`${request.method} ${path}${url.search}`);
		if (replayed) {
			response.writeHead(replayed.status, {
				"content-type": replayed.contentType,
			});
			/* A binary fixture's body is a description, not the bytes; the routes
			 * replayed here are the JSON ones, and the image route is asserted for its
			 * request rather than its payload. */
			response.end(
				replayed.contentType.includes("json")
					? JSON.stringify(replayed.body)
					: String(replayed.body ?? ""),
			);
			return;
		}

		json(response, 404, { error: "not found" });
	});

	function openStream(
		request: IncomingMessage,
		response: ServerResponse,
		path: string,
		framesFor: (connection: number) => string[],
	): void {
		streamCount += 1;
		const connection = streamCount;
		streamOpens.set(path, (streamOpens.get(path) ?? 0) + 1);
		if (
			options.rejectStreamsFrom !== undefined &&
			connection >= options.rejectStreamsFrom
		) {
			response.writeHead(401, {
				"x-radient-login": "/_radient/login",
				"content-type": "text/plain",
			});
			response.end("Sign in with Radient to access this tunnel");
			return;
		}
		response.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-store",
		});
		response.flushHeaders();
		if (options.silentFirstStream && connection === 1) return;
		for (const frame of framesFor(connection)) response.write(frame);
		if (options.cutStreamAfterMs !== undefined) {
			const timer = setTimeout(() => response.end(), options.cutStreamAfterMs);
			request.on("close", () => clearTimeout(timer));
		}
	}

	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;

	return {
		baseUrl: `http://127.0.0.1:${port}`,
		requests,
		admitted,
		streamOpens,
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
