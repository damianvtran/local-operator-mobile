// biome-ignore-all lint/performance/useTopLevelRegex: a regex literal inside an
// assertion is not a hot path — there is no per-frame work here to hoist out of.
// biome-ignore-all lint/style/noNonNullAssertion: an assertion after an explicit
// length/definedness check is the guard; a longhand local for it would obscure it.
/**
 * The endpoint functions: what path, what query, what body, and which schema the
 * answer is checked against.
 *
 * The assertions are about the *wire shape* the relay actually validates, because
 * that is where a client's mistakes are silent: a `pin` sent as a toggle flips
 * back on a retry, a `seen` without the completion token acknowledges nothing, an
 * unclamped `limit` is quietly corrected by the relay so a bug looks like it
 * works, and a `prompt` without a `command_id` is a `422` no test would have
 * caught. The bodies the fixtures captured are parsed through the same code path,
 * so the schemas and the routes cannot disagree.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parsePayload } from "../../contracts";
import {
	HISTORY_LIMIT,
	RelayEndpoints,
	RelayError,
	RelayHttpClient,
	type RelayRequest,
	type RequestAuth,
	SEARCH_LIMIT,
} from "../index";

const FIXTURE_ROOT = fileURLToPath(
	new URL("../../../fixtures/relay", import.meta.url),
);

const BASE = "https://tunnel.example.invalid";
const auth: RequestAuth = {
	cookie: "jwt=access",
	origin: BASE,
	credentials: "omit",
};

/** A stub that records the request and answers with a canned result, so the
 *  endpoint's shape is asserted without a network. The responder is told which
 *  schema is being asked for, because most tests care about exactly one route and
 *  a single canned body would make every other route's answer a parse failure. */
class RecordingHttp {
	readonly requests: RelayRequest[] = [];
	constructor(
		private readonly responder: (
			request: RelayRequest,
			schema: string,
		) => { json?: unknown; text?: string; bytes?: Uint8Array } = () => ({
			json: {},
		}),
	) {}

	async json(schema: string, request: RelayRequest) {
		this.requests.push(request);
		const answer = this.responder(request, schema);
		if (answer.json === undefined)
			throw new Error("no json canned for this test");
		return parsePayload(
			schema as Parameters<typeof parsePayload>[0],
			answer.json,
		);
	}

	async raw(request: RelayRequest) {
		this.requests.push(request);
		const answer = this.responder(request, "");
		return { status: 200, headers: {}, text: answer.text ?? "" };
	}

	async bytes(request: RelayRequest) {
		this.requests.push(request);
		const answer = this.responder(request, "");
		return {
			status: 200,
			mimeType: "image/png",
			bytes: answer.bytes ?? new Uint8Array(),
		};
	}

	async text(request: RelayRequest) {
		this.requests.push(request);
		return this.responder(request, "").text ?? "";
	}

	stream(): never {
		/* The stream shape is asserted in sse.test.ts against a real reader; here it
		 * would only restate the stub. */
		throw new Error("not used in this suite");
	}
}

function endpoints(
	responder?: (
		request: RelayRequest,
		schema: string,
	) => { json?: unknown; text?: string; bytes?: Uint8Array },
) {
	const http = new RecordingHttp(responder);
	return {
		http,
		client: new RelayEndpoints(http as unknown as RelayHttpClient),
	};
}

function fixtureBody(rel: string): { status: number; body: unknown } {
	const raw = JSON.parse(readFileSync(join(FIXTURE_ROOT, rel), "utf8")) as {
		status?: number;
		body: unknown;
	};
	return { status: raw.status ?? 200, body: raw.body };
}

describe("reads use the contract's paths and query", () => {
	it("probes /healthz without a body", async () => {
		const { http, client } = endpoints(() => ({
			json: { ok: true, version: 5, sessions: 0, dist: false },
		}));
		const health = await client.healthz();
		expect(health.version).toBe(5);
		expect(http.requests[0]?.method).toBe("GET");
		expect(http.requests[0]?.path).toBe("/healthz");
	});

	it("lists sessions from the API, not from the stream, when asked for one shot", async () => {
		const list = fixtureBody("http/sessions-empty.json").body;
		const { http, client } = endpoints(() => ({ json: list }));
		await client.sessions();
		/* The same payload as the `sessions` SSE event, on a second transport. */
		expect(http.requests[0]?.path).toBe("/api/sessions");
	});

	it("clamps history's limit to the contract's range instead of sending a value the relay would silently correct", async () => {
		const page = fixtureBody("http/history-ok.json").body;
		const { http, client } = endpoints(() => ({ json: page }));
		await client.history("6714def86197", { before: "a1b2", limit: 9_999 });
		await client.history("6714def86197", { limit: 0 });
		await client.history("6714def86197", {});
		expect(http.requests[0]?.path).toBe(
			`/api/sessions/6714def86197/history?before=a1b2&limit=${HISTORY_LIMIT.max}`,
		);
		expect(http.requests[1]?.path).toBe(
			`/api/sessions/6714def86197/history?limit=${HISTORY_LIMIT.min}`,
		);
		expect(http.requests[2]?.path).toBe(
			`/api/sessions/6714def86197/history?limit=${HISTORY_LIMIT.default}`,
		);
	});

	it("escapes a search query rather than concatenating it", async () => {
		const body = fixtureBody("http/search-hit.json").body;
		const { http, client } = endpoints(() => ({ json: body }));
		await client.searchSessions({ query: "hello world & more" });
		expect(http.requests[0]?.path).toContain("q=hello+world+%26+more");
		expect(http.requests[0]?.path).toContain(`limit=${SEARCH_LIMIT.default}`);
	});

	it("addresses the subagent routes the detail view needs", async () => {
		const detail = parsePayload("subagentDetail", {
			job_id: "job-1",
			label: "scout",
			agent: "scout",
			status: "running",
			progress: "",
			elapsed_s: null,
			model_label: "m",
			result_text: "",
			error_text: "",
			parent_job_id: null,
			session_id: null,
			prompt: "",
			launch_message_id: "",
			effort: "",
			ancestors: [],
			ancestor_ids: [],
			child_ids: [],
			peer_ids: [],
			transcript: [],
			todos: [],
			activity: "",
			version: 12,
		});
		const { http, client } = endpoints(() => ({ json: detail }));
		await client.agentDetail("6714def86197", "job-1");
		expect(http.requests[0]?.path).toBe(
			"/api/sessions/6714def86197/agents/job-1",
		);
	});

	it("never calls the web shell, which a native client has no use for", async () => {
		const { http, client } = endpoints((_request, schema) => {
			switch (schema) {
				case "sessionListFrame":
					return { json: { sessions: [], degraded: [], capabilities: {} } };
				case "commands":
					return { json: { commands: [] } };
				case "models":
					return { json: { models: [] } };
				case "directories":
					return { json: { home: "~", recent: [] } };
				case "pastSessions":
					return { json: { sessions: [], degraded: [] } };
				default:
					throw new Error(`unexpected schema ${schema}`);
			}
		});
		await client.sessions();
		await client.commands();
		await client.models();
		await client.directories();
		await client.pastSessions();
		expect(http.requests.map((request) => request.path)).toEqual([
			"/api/sessions",
			"/api/commands",
			"/api/models",
			"/api/directories",
			"/api/sessions/past",
		]);
	});
});

describe("mutations send exactly the bodies the relay validates", () => {
	it("pins the desired state rather than a toggle", async () => {
		const { http, client } = endpoints(() => ({
			json: { ok: true, pinned: true },
		}));
		const result = await client.pin("6714def86197", true);
		expect(http.requests[0]?.body).toEqual({ pinned: true });
		/* The body is the state the STORE read back, so a caller cannot be told a pin
		 * that was pruned. */
		expect(result.pinned).toBe(true);
	});

	it("acknowledges the completion token the projection named", async () => {
		const body = fixtureBody("http/seen-real-token.json").body;
		const { http, client } = endpoints(() => ({ json: body }));
		await client.seen("6714def86197", "cf6b89c0-1fde-4b8f-9032-700119607c60");
		expect(http.requests[0]?.path).toBe("/api/sessions/6714def86197/seen");
		expect(http.requests[0]?.body).toEqual({
			completion_token: "cf6b89c0-1fde-4b8f-9032-700119607c60",
		});
	});

	it("rejects a prompt with no command_id before it leaves the device", async () => {
		const { http, client } = endpoints(() => ({
			json: { ok: true, detail: "prompt admitted" },
		}));
		/* Identity is mandatory over HTTP: a prompt without one is a 422 and, worse,
		 * a command that can never be de-duplicated. */
		await expect(
			client.command("6714def86197", { op: "prompt", text: "hi" } as never),
		).rejects.toThrow();
		expect(http.requests).toHaveLength(0);
	});

	it("sends a well-formed prompt, images included", async () => {
		const body = fixtureBody("http/command-prompt-image.json").body;
		const { http, client } = endpoints(() => ({ json: body }));
		const ack = await client.command("9ed9e2f534cd", {
			op: "prompt",
			command_id: "cf13127c-6523-4138-a225-0eccdba095da",
			text: "",
			images: [{ data_b64: "AAAA", mime_type: "image/png" }],
			input_mode: "typed",
		});
		expect(ack.detail).toBe("prompt admitted");
		expect(http.requests[0]?.path).toBe("/api/sessions/9ed9e2f534cd/command");
		expect(http.requests[0]?.body).toMatchObject({
			op: "prompt",
			text: "",
			input_mode: "typed",
		});
	});

	it("refuses an input_mode the relay would refuse, so the refusal happens where it is cheap", async () => {
		const { http, client } = endpoints(() => ({
			json: { ok: true, detail: "" },
		}));
		await expect(
			client.command("9ed9e2f534cd", {
				op: "steer",
				command_id: "cf13127c-6523-4138-a225-0eccdba095da",
				text: "x",
				input_mode: "spoken",
			} as never),
		).rejects.toThrow();
		expect(http.requests).toHaveLength(0);
	});

	it("starts a session with a resolved directory and reports the id the child will use", async () => {
		const body = fixtureBody("http/start-session.json").body;
		const { http, client } = endpoints(() => ({ json: body }));
		const started = await client.startSession({
			cwd: "~/work",
			provider: "test",
			model_id: "mock",
		});
		expect(http.requests[0]?.path).toBe("/api/sessions/start");
		expect(http.requests[0]?.body).toEqual({
			cwd: "~/work",
			provider: "test",
			model_id: "mock",
		});
		expect(started.session_id).toMatch(/^[0-9a-f]+$/);
	});

	it("resumes by id and does not promise the cwd back", async () => {
		const { http, client } = endpoints(() => ({
			json: { ok: true, pid: 1, session_id: "6714def86197" },
		}));
		const resumed = await client.resumeSession("6714def86197");
		expect(http.requests[0]?.path).toBe("/api/sessions/resume");
		expect(http.requests[0]?.body).toEqual({ session_id: "6714def86197" });
		/* The relay uses the account home, not the conversation's recorded cwd. */
		expect(resumed.session_id).toBe("6714def86197");
	});
});

describe("streams are built from the route that owns them", () => {
	it("offers both stream routes and a stop that is the connection's own", () => {
		const { client } = endpoints();
		const list = client.sessionsStream({ onFrame: () => undefined });
		const session = client.sessionStream("6714def86197", {
			onFrame: () => undefined,
		});
		expect(list.connection.status.state).toBe("idle");
		expect(session.connection.status.state).toBe("idle");
		list.stop();
		session.stop();
		expect(list.connection.isRunning).toBe(false);
	});
});

describe("the login and logout routes are the custom route's whole auth story", () => {
	it("detects the form the relay serves", async () => {
		const { http, client } = endpoints(() => ({
			text: '<html><body><form method="post" action="/login">',
		}));
		const page = await client.loginPage();
		expect(page.isForm).toBe(true);
		expect(http.requests[0]?.path).toBe("/login");
	});

	it("treats only a 303 as a signed-in session", async () => {
		const { http, client } = endpoints(() => ({ text: "" }));
		const result = await client.login("hunter2");
		expect(http.requests[0]?.form).toEqual({ password: "hunter2" });
		expect(http.requests[0]?.method).toBe("POST");
		/* The mock answers 200: a wrong password renders the page again as a 401, and
		 * neither is a session. */
		expect(result.signedIn).toBe(false);
	});

	it("calls logout without expecting a cookie to be respected", async () => {
		const { http, client } = endpoints(() => ({ text: "" }));
		await client.logout();
		expect(http.requests[0]?.path).toBe("/logout");
	});
});

describe("an error from a real http client still arrives as one typed error", () => {
	it("turns a 404 for an unknown session into a RelayError the caller can act on", async () => {
		const unknown = fixtureBody("http/history-unknown.json");
		const fetchImpl = (async () =>
			new Response(JSON.stringify(unknown.body), {
				status: unknown.status,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof globalThis.fetch;
		const http = new RelayHttpClient({
			baseUrl: BASE,
			auth: () => auth,
			fetchImpl,
		});
		const client = new RelayEndpoints(http);
		const error = (await client
			.history("ffffffffffff")
			.catch((caught: unknown) => caught)) as RelayError;
		expect(error).toBeInstanceOf(RelayError);
		expect(error.kind).toBe("rejected");
		expect(error.serverError).toBe("unknown session");
		/* A missing session is not a broken tunnel. */
		expect(error.surface).toBe("none");
	});

	it("fetches image bytes with the stored mime type", async () => {
		const bytes = new Uint8Array([0x89, 0x50]);
		const fetchImpl = (async () =>
			new Response(bytes, {
				status: 200,
				headers: { "content-type": "image/png" },
			})) as unknown as typeof globalThis.fetch;
		const client = new RelayEndpoints(
			new RelayHttpClient({ baseUrl: BASE, auth: () => auth, fetchImpl }),
		);
		const image = await client.image("9ed9e2f534cd", "abc-123", 0);
		expect(image.mimeType).toBe("image/png");
		expect(Array.from(image.bytes)).toEqual([0x89, 0x50]);
	});
});
