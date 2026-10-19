/**
 * The Library wire's runtime reading.
 *
 * The fixture is the mock relay's hand-authored listing (the relay routes had not
 * shipped when this client slice was written), so these tests do double duty:
 * they prove the schemas accept the frozen contract's own shape, and they pin the
 * absence rules that a phone must not turn into invented facts — a null size is
 * "not measured", never `0`; an absent `librarian` is "not shipped", never a
 * disabled object; an unknown kind degrades to `other` rather than blanking a
 * page.
 */

import { describe, expect, it } from "vitest";

import { parsePayload } from "@/contracts";
import { loadFixture } from "@/testing/fixtures";

const listingBody = (): unknown =>
	loadFixture<{ body: unknown }>("synthetic/library-listing.json").body;

const firstRow = (): Record<string, unknown> => {
	const body = listingBody() as { rows: Record<string, unknown>[] };
	return body.rows[0] ?? {};
};

describe("library listing", () => {
	it("parses the frozen contract's shape, including the null librarian", () => {
		const listing = parsePayload("libraryList", listingBody());
		expect(listing.rows).toHaveLength(4);
		expect(listing.state).toBe("ready");
		expect(listing.total).toBe(4);
		expect(listing.counts.category.image).toBe(1);
		expect(listing.tags.find((tag) => tag.name === "reference")?.count).toBe(2);
		/* The Librarian package is a later slice: the backend declares the key
		 * nullable for exactly this reason, and the client must not invent an
		 * "enabled: false" status it was never sent. */
		expect(listing.librarian).toBeNull();
	});

	it("keeps a null size as null instead of painting 0 B", () => {
		const body = listingBody() as {
			rows: Record<string, unknown>[];
		};
		const audio = body.rows.find((row) => row.kind === "audio");
		const row = parsePayload("libraryAsset", audio);
		expect(row.size_bytes).toBe(128000);
		expect(row.duration_s).toBe(12.4);
		expect(row.width).toBeNull();

		const unmeasured = parsePayload("libraryAsset", {
			...firstRow(),
			size_bytes: null,
		});
		expect(unmeasured.size_bytes).toBeNull();
	});

	it("degrades an unknown kind and origin group instead of failing the page", () => {
		const row = parsePayload("libraryAsset", {
			...firstRow(),
			kind: "hologram",
			origin_group: "invented",
		});
		expect(row.kind).toBe("other");
		expect(row.origin_group).toBe("mentioned");
	});

	it("defaults additive absences to the inert reading", () => {
		const row = parsePayload("libraryAsset", {
			id: "la_0000000000000000",
			ref: { type: "artifact", digest: "abc", content_type: "image/png" },
			kind: "image",
			category: "image",
			origin_group: "generated",
		});
		expect(row.exists).toBe(false);
		expect(row.favorite).toBe(false);
		expect(row.locked).toBe(false);
		expect(row.chat).toBeNull();
		expect(row.preview.state).toBe("unsupported");
		expect(row.archived).toBe(false);
	});
});

describe("library writes", () => {
	it("parses a tag with its count and provenance", () => {
		const response = parsePayload("libraryTags", {
			tags: [
				{
					id: "0a1b2c3d4e",
					name: "reference",
					category: "topic",
					created_by: "librarian",
					count: 2,
					created_at: 1791000000.0,
					updated_at: 1791000000.0,
				},
			],
		});
		expect(response.tags[0]?.count).toBe(2);
		expect(response.tags[0]?.created_by).toBe("librarian");
	});

	it("parses both chat answer shapes: desktop receipt and phone clear", () => {
		const linked = parsePayload("libraryChat", {
			asset_id: "la_0123456789abcdef",
			chat: {
				session_id: "a1b2c3d4e5f6",
				title: "Design review",
				updated_at: 1792000300.0,
			},
			cleared: false,
		});
		expect(linked.chat?.session_id).toBe("a1b2c3d4e5f6");

		/* #2624's phone plane answers `{chat}` on a link and `{ok, cleared}` on a
		 *  clear; the desktop receipt names the fields. Both must read as the same
		 *  client value, or a clear on the phone looks like a frame error. */
		const phoneLink = parsePayload("libraryChat", {
			chat: { session_id: "a1b2c3d4e5f6", title: "", updated_at: 0 },
		});
		expect(phoneLink.chat?.session_id).toBe("a1b2c3d4e5f6");
		expect(phoneLink.cleared).toBe(false);

		const cleared = parsePayload("libraryChat", {
			ok: true,
			cleared: true,
		});
		expect(cleared.chat).toBeNull();
		expect(cleared.cleared).toBe(true);
	});
});
