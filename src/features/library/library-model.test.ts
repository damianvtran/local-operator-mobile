/**
 * The Library's pure rules: filters, paging and the first context line.
 *
 * These are the facts a screen cannot re-derive safely. In particular the paging
 * test pins `cursor_reset`, whose failure mode is silent: appending a restarted
 * page shows the same rows twice, which looks like a catalog with duplicates
 * rather than a client that ignored the revision.
 */

import { describe, expect, it } from "vitest";

import type {
	Capabilities,
	LibraryAsset,
	LibraryListResponse,
} from "@/contracts";
import {
	applyLibraryPage,
	categoryForBrowse,
	composerPrompt,
	DEFAULT_BROWSE,
	formatBytes,
	hasActiveFilters,
	kindLabel,
	libraryEnabled,
	libraryListRequest,
	previewKind,
	promptImage,
	unsupportedReason,
} from "@/features/library/library-model";
import { loadFixture } from "@/testing/fixtures";

const asset = (overrides: Partial<LibraryAsset> = {}): LibraryAsset => {
	const fixture = loadFixture<{ body: { rows: LibraryAsset[] } }>(
		"synthetic/library-listing.json",
	).body.rows[0];
	if (fixture === undefined) throw new Error("fixture has no rows");
	return { ...fixture, ...overrides };
};

const listing = (
	rows: LibraryAsset[],
	extra: Partial<LibraryListResponse> = {},
): LibraryListResponse => ({
	state: "ready",
	revision: 7,
	total: rows.length,
	counts: { category: {}, origin_group: {}, kind: {} },
	tags: [],
	rows,
	next_cursor: null,
	cursor_reset: false,
	scan: { sessions_total: 12, sessions_scanned: 12 },
	librarian: null,
	...extra,
});

describe("filters map to the relay's own keys", () => {
	it("asks for a category only when one is chosen", () => {
		expect(libraryListRequest(DEFAULT_BROWSE).category).toBeUndefined();
		expect(
			libraryListRequest({ ...DEFAULT_BROWSE, segment: "image" }).category,
		).toBe("image");
		expect(
			libraryListRequest({
				...DEFAULT_BROWSE,
				segment: "more",
				moreCategory: "code",
			}).category,
		).toBe("code");
		expect(
			categoryForBrowse({ ...DEFAULT_BROWSE, segment: "all" }),
		).toBeUndefined();
	});

	it("maps each status to the route's own boolean, not a client filter", () => {
		expect(
			libraryListRequest({ ...DEFAULT_BROWSE, status: "highlighted" })
				.highlighted,
		).toBe(true);
		expect(
			libraryListRequest({ ...DEFAULT_BROWSE, status: "unorganized" })
				.organized,
		).toBe(false);
		expect(
			libraryListRequest({ ...DEFAULT_BROWSE, status: "favorites" }).favorite,
		).toBe(true);
	});

	it("omits a limit it was not given, so the relay's default applies", () => {
		expect(libraryListRequest(DEFAULT_BROWSE).limit).toBeUndefined();
		expect(libraryListRequest(DEFAULT_BROWSE, undefined, 24).limit).toBe(24);
	});

	it("counts an active query as a filter, so the empty state can differ", () => {
		expect(hasActiveFilters(DEFAULT_BROWSE)).toBe(false);
		expect(hasActiveFilters({ ...DEFAULT_BROWSE, query: "sunset" })).toBe(true);
	});
});

describe("cursor paging", () => {
	it("appends a later page and dedupes by id", () => {
		const a = asset({ id: "la_0000000000000001" });
		const b = asset({ id: "la_0000000000000002" });
		const merged = applyLibraryPage(
			[a],
			listing([a, b], { next_cursor: "next" }),
			true,
		);
		expect(merged.rows.map((row) => row.id)).toEqual([a.id, b.id]);
		expect(merged.reset).toBe(false);
	});

	it("replaces when the relay restarted the walk", () => {
		const a = asset({ id: "la_0000000000000001" });
		const b = asset({ id: "la_0000000000000002" });
		const merged = applyLibraryPage(
			[a],
			listing([b], { cursor_reset: true }),
			true,
		);
		expect(merged.rows.map((row) => row.id)).toEqual([b.id]);
		expect(merged.reset).toBe(true);
	});
});

describe("the chat prompt", () => {
	it("leads with the asset path, on its own line", () => {
		const prompt = composerPrompt(asset(), "What changed here?");
		expect(prompt.split("\n")[0]).toBe("Asset: ~/Pictures/library-sunset.png");
		expect(prompt.endsWith("\n\nWhat changed here?")).toBe(true);
	});

	it("leads with the digest when the asset has no path", () => {
		const prompt = composerPrompt(
			asset({
				ref: {
					type: "artifact",
					display_path: "digest:abc123",
					digest: "abc123",
					content_type: "image/png",
				},
			}),
			"Describe it.",
		);
		expect(prompt.split("\n")[0]).toBe("Asset digest: abc123");
	});

	it("attaches image bytes and refuses audio bytes", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		expect(promptImage(asset(), bytes)?.mime_type).toBe("image/png");
		expect(promptImage(asset({ kind: "audio" }), bytes)).toBeNull();
		expect(promptImage(asset(), null)).toBeNull();
	});
});

describe("capability gate", () => {
	const capabilities = (features: Record<string, unknown>): Capabilities =>
		({ features }) as Capabilities;

	it("hides the entry when an older relay omits the key", () => {
		expect(libraryEnabled(capabilities({}))).toBe(false);
		expect(libraryEnabled(capabilities({ library: 0 }))).toBe(false);
		expect(libraryEnabled(capabilities({ library: false }))).toBe(false);
	});
	it("shows it for the relay's version-flag value", () => {
		expect(libraryEnabled(capabilities({ library: 1 }))).toBe(true);
		expect(libraryEnabled(capabilities({ library: 2 }))).toBe(true);
	});
});

describe("preview classification and copy", () => {
	it("names the kinds this build can render", () => {
		expect(previewKind(asset())).toBe("image");
		expect(previewKind(asset({ kind: "markdown" }))).toBe("markdown");
		expect(previewKind(asset({ kind: "pdf" }))).toBe("unsupported");
		expect(unsupportedReason(asset({ kind: "pptx" }))).toContain("desktop");
	});

	it("never prints a null byte count as a number", () => {
		expect(formatBytes(null)).toBe("0 B");
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(kindLabel("sound")).toBe("File");
		expect(kindLabel("audio")).toBe("Audio");
	});
});
