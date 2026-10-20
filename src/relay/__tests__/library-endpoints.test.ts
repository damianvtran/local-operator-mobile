/**
 * The Library endpoints' wire shape.
 *
 * Every assertion is about what the RELAY will receive, because that is where a
 * client mistake is silent: a filter sent under the desktop name the relay does
 * not read (`session` instead of `session_id`), a PATCH that sends an empty field
 * the route accepts as "clear it", a tag set sent as a delta when the route
 * REPLACES the whole assignment. The bodies are the frozen contract's own
 * (`docs/design/library.md` §4), not a shape this client invented.
 */

import { describe, expect, it } from "vitest";

import { parsePayload } from "../../contracts";
import {
	LIBRARY_LIMIT,
	RelayEndpoints,
	type RelayHttpClient,
	type RelayRequest,
} from "../index";

class RecordingHttp {
	readonly requests: RelayRequest[] = [];
	constructor(
		private readonly answer: (request: RelayRequest, schema: string) => unknown,
	) {}

	async json(schema: string, request: RelayRequest) {
		this.requests.push(request);
		return parsePayload(
			schema as Parameters<typeof parsePayload>[0],
			this.answer(request, schema),
		);
	}

	async bytes(request: RelayRequest) {
		this.requests.push(request);
		return { status: 200, mimeType: "image/png", bytes: new Uint8Array([1]) };
	}
}

const client = (answer: (request: RelayRequest, schema: string) => unknown) => {
	const http = new RecordingHttp(answer);
	return {
		http,
		endpoints: new RelayEndpoints(http as unknown as RelayHttpClient),
	};
};

const row = {
	id: "la_0123456789abcdef",
	ref: { type: "path", display_path: "~/x.png", content_type: "image/png" },
	kind: "image",
	category: "image",
	origin_group: "generated",
};

describe("the listing's query", () => {
	it("maps every filter to the relay's key", async () => {
		const { http, endpoints } = client(() => ({
			state: "ready",
			revision: 1,
			total: 0,
			counts: {},
			tags: [],
			rows: [],
			next_cursor: null,
			cursor_reset: false,
			scan: { sessions_total: 0, sessions_scanned: 0 },
			librarian: null,
		}));
		await endpoints.libraryList({
			q: "sunset",
			category: "image",
			kind: "image",
			origin_group: "created",
			tag: "0a1b2c3d4e",
			tag_mode: "any",
			highlighted: true,
			organized: false,
			favorite: true,
			session: "a1b2c3d4e5f6",
			sort: "name",
			order: "asc",
			limit: 999,
			cursor: "abc",
		});
		const path = http.requests[0]?.path ?? "";
		expect(path.startsWith("/api/library/assets?")).toBe(true);
		for (const part of [
			"q=sunset",
			"category=image",
			"kind=image",
			"origin_group=created",
			"tag=0a1b2c3d4e",
			"tag_mode=any",
			"highlighted=1",
			"organized=0",
			"favorite=1",
			"session=a1b2c3d4e5f6",
			"sort=name",
			"order=asc",
			`limit=${LIBRARY_LIMIT.max}`,
			"cursor=abc",
		]) {
			expect(path).toContain(part);
		}
	});

	it("omits every opinion it was not given", async () => {
		const { http, endpoints } = client(() => ({
			state: "ready",
			revision: 0,
			total: 0,
			counts: {},
			tags: [],
			rows: [],
			next_cursor: null,
			cursor_reset: false,
			scan: { sessions_total: 0, sessions_scanned: 0 },
			librarian: null,
		}));
		await endpoints.libraryList({});
		expect(http.requests[0]?.path).toBe("/api/library/assets");
	});
});

describe("the writes", () => {
	it("patches only the fields the caller named", async () => {
		const { http, endpoints } = client((_request, schema) =>
			schema === "libraryAsset" ? row : {},
		);
		await endpoints.patchLibraryAsset("la_0123456789abcdef", {
			name: "New name",
			favorite: true,
		});
		expect(http.requests[0]?.method).toBe("PATCH");
		expect(http.requests[0]?.body).toEqual({
			name: "New name",
			favorite: true,
		});
	});

	it("replaces the tag set with PUT, not a delta", async () => {
		const { http, endpoints } = client(() => row);
		await endpoints.setLibraryAssetTags(
			"la_0123456789abcdef",
			["0a1b2c3d4e", "1a2b3c4d5e"],
			"0a1b2c3d4e",
		);
		expect(http.requests[0]?.method).toBe("PUT");
		expect(http.requests[0]?.body).toEqual({
			tags: ["0a1b2c3d4e", "1a2b3c4d5e"],
			primary: "0a1b2c3d4e",
		});
	});

	it("creates, renames and merges against the tag family", async () => {
		const { http, endpoints } = client(() => ({
			tag: {
				id: "0a1b2c3d4e",
				name: "reference",
				category: "topic",
				count: 0,
			},
		}));
		await endpoints.createLibraryTag("reference", "topic");
		await endpoints.renameLibraryTag("0a1b2c3d4e", { name: "refs" });
		await endpoints.mergeLibraryTag("0a1b2c3d4e", "1a2b3c4d5e");
		expect(
			http.requests.map((request) => [request.method, request.path]),
		).toEqual([
			["POST", "/api/library/tags"],
			["PATCH", "/api/library/tags/0a1b2c3d4e"],
			["POST", "/api/library/tags/0a1b2c3d4e/merge"],
		]);
		expect(http.requests[2]?.body).toEqual({ into: "1a2b3c4d5e" });
	});

	it("links and clears the chat on the asset's own route", async () => {
		const { http, endpoints } = client(() => ({
			asset_id: "la_0123456789abcdef",
			chat: null,
			cleared: true,
		}));
		await endpoints.linkLibraryChat("la_0123456789abcdef", "a1b2c3d4e5f6");
		await endpoints.unlinkLibraryChat("la_0123456789abcdef");
		expect(http.requests[0]).toMatchObject({
			method: "PUT",
			path: "/api/library/assets/la_0123456789abcdef/chat",
			body: { session_id: "a1b2c3d4e5f6" },
		});
		expect(http.requests[1]).toMatchObject({
			method: "DELETE",
			path: "/api/library/assets/la_0123456789abcdef/chat",
		});
	});

	it("reads bytes from the id, never a caller path", async () => {
		const { http, endpoints } = client(() => ({}));
		await endpoints.libraryContent("la_0123456789abcdef");
		await endpoints.libraryThumbnail("la_0123456789abcdef", 1200);
		expect(http.requests[0]?.path).toBe(
			"/api/library/assets/la_0123456789abcdef/content",
		);
		expect(http.requests[1]?.path).toBe(
			"/api/library/assets/la_0123456789abcdef/thumbnail?w=480",
		);
	});
});
