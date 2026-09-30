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

import { describe, expect, it } from "vitest";
import { parsePayload } from "../../contracts";
import { loadFixture } from "../../testing/fixtures";
import {
	HISTORY_LIMIT,
	RelayEndpoints,
	RelayError,
	RelayHttpClient,
	type RelayRequest,
	type RequestAuth,
	SEARCH_LIMIT,
} from "../index";

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
	const raw = loadFixture<{ status?: number; body: unknown }>(rel);
	return { status: raw.status ?? 200, body: raw.body };
}

describe("reads use the contract's paths and query", () => {
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
});

describe("mutations send exactly the bodies the relay validates", () => {
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
