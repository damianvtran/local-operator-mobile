/**
 * The mock relay's Library store — the executable stand-in for
 * `/api/library/assets*` and `/api/library/tags*`.
 *
 * WHY A STORE RATHER THAN A REPLAYED CAPTURE. The Library routes had not shipped
 * when this client slice was written, so there is no captured corpus to replay.
 * The seed therefore comes from one hand-authored fixture
 * (`fixtures/relay/http/library-listing.json`) written against the FROZEN wire
 * contract (`docs/design/library.md` §4) and the desktop models
 * (`local_operator/server/models/desktop_library.py`) — and the mock mutates it
 * exactly as the real metadata store does, because a create/tag/patch that did
 * not change the listing would make every cell after it a lie.
 *
 * The rules modelled here are the ones a client can get wrong:
 *
 *   - `q` searches the effective name, description, tag names, derived name,
 *     display path and source titles, case-insensitively;
 *   - `tag` is a single id, `tag_mode=all|any` is accepted (with one tag the two
 *     agree, which is why the mock does not invent a second filter);
 *   - `organized=1` means a non-null `organized` row, `organized=0` the absence;
 *   - the sort/order pair follows the contract's defaults;
 *   - a cursor is minted against a revision, and a mutation bumps the revision,
 *     so a page requested from an older cursor restarts at the top with
 *     `cursor_reset: true` — the exact rule the grid merges on;
 *   - content is resolved from the id only (never a caller path), which is the
 *     security rule the phone projection exists to keep.
 *
 * WHAT IT DOES NOT MODEL, named rather than implied: thumbnails beyond the image
 * kind (the contract says the others have none), Range requests (the client's
 * players stream the whole body locally), and the Librarian (the listing carries
 * `librarian: null` until that package lands).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { asString, isRecord, type Json } from "../lib/json.ts";
import type { FixtureCorpus } from "./fixtures.ts";

/** A real 1×1 PNG: the image fixture's bytes and its thumbnail. */
const TINY_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
	"base64",
);

/** A short, valid mono WAV (0.2 s of silence), so expo-audio opens the route's
 *  bytes rather than failing on an empty body. */
const TINY_WAV = (() => {
	const sampleRate = 8000;
	const samples = Math.floor(sampleRate * 0.2);
	const data = Buffer.alloc(samples * 2);
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
})();

const MARKDOWN_BYTES = Buffer.from(
	"# Library notes\n\nThis document came from a conversation.\n\n- one\n- two\n",
	"utf8",
);

interface Row extends Record<string, unknown> {
	id: string;
	name: string;
	derived_name: string;
	description: string;
	kind: string;
	category: string;
	origin_group: string;
	ref: Record<string, unknown>;
	tags: Array<Record<string, unknown>>;
	occurrences: Array<Record<string, unknown>>;
	chat: Record<string, unknown> | null;
	organized: Record<string, unknown> | null;
	favorite: boolean;
	locked: boolean;
	archived: boolean;
	highlighted: boolean;
	exists: boolean;
	size_bytes: number | null;
	created_at: number;
	modified_at: number;
	last_seen_at: number;
}

interface Tag extends Record<string, unknown> {
	id: string;
	name: string;
	category: string;
	created_by: string;
	count: number;
}

export interface LibraryListing {
	state: "ready" | "building";
	revision: number;
	total: number;
	counts: Record<string, Record<string, number>>;
	tags: Tag[];
	rows: Row[];
	next_cursor: string | null;
	cursor_reset: boolean;
	scan: { sessions_total: number; sessions_scanned: number };
	librarian: null;
}

const clone = <T>(value: T): T => structuredClone(value);

const cursorFor = (offset: number, revision: number): string =>
	Buffer.from(JSON.stringify({ o: offset, r: revision })).toString("base64url");

const cursorAt = (
	cursor: string | null,
): { offset: number; revision: number } | null => {
	if (cursor === null || cursor === "") return null;
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		);
		if (!isRecord(parsed)) return null;
		const offset = parsed.o;
		const revision = parsed.r;
		if (typeof offset !== "number" || typeof revision !== "number") return null;
		return { offset, revision };
	} catch {
		return null;
	}
};

const sortKey = (row: Row, sort: string): string | number => {
	switch (sort) {
		case "name":
			return String(row.name || row.derived_name).toLowerCase();
		case "kind":
			return String(row.kind);
		case "size":
			return row.size_bytes ?? 0;
		case "created":
			return row.created_at;
		case "modified":
			return row.modified_at;
		case "organized":
			return row.organized === null ? 0 : Number(row.organized.at ?? 0);
		default:
			return row.last_seen_at;
	}
};

const DEFAULT_ORDER: Record<string, "asc" | "desc"> = {
	recent: "desc",
	name: "asc",
	kind: "asc",
	size: "desc",
	created: "desc",
	modified: "desc",
	organized: "desc",
};

export interface LibraryQuery {
	q: string;
	category: string | null;
	kind: string | null;
	origin_group: string | null;
	tag: string | null;
	tag_mode: "all" | "any";
	highlighted: boolean | null;
	organized: boolean | null;
	favorite: boolean | null;
	session_id: string | null;
	sort: string;
	order: string | null;
	limit: number;
	cursor: string | null;
}

export function createLibraryStore(fix: FixtureCorpus) {
	/* Read directly from the SYNTHETIC corpus: `FixtureCorpus.body` resolves the
	 * captured HTTP family only, and this sample is deliberately synthetic (the
	 * relay routes it describes had not shipped when it was written). The
	 * provenance field is what the corpus's own test reads, so this path is the
	 * one the fixture's marker names. */
	const seed = JSON.parse(
		readFileSync(join(fix.dir, "synthetic", "library-listing.json"), "utf8"),
	).body as unknown as LibraryListing & { rows: Row[] };
	let rows: Row[] = clone(seed.rows);
	let revision = 1;
	let tagSeq = 100;

	const tags = (): Tag[] => {
		const byId = new Map<string, Tag>();
		// `seed.tags` is the catalogue vocabulary with counts; rows only carry
		// briefs, so the seed's own list is the anchor and mutation updates counts.
		for (const tag of clone(seed.tags)) byId.set(tag.id, tag);
		for (const tag of byId.values()) tag.count = 0;
		for (const row of rows) {
			for (const tag of row.tags) {
				const id = asString(tag.id) ?? "";
				const known = byId.get(id);
				if (known !== undefined) known.count += 1;
			}
		}
		return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
	};

	const counts = () => {
		const result: Record<string, Record<string, number>> = {
			category: {},
			origin_group: {},
			kind: {},
		};
		for (const row of rows) {
			for (const [bucket, key] of [
				["category", row.category],
				["origin_group", row.origin_group],
				["kind", row.kind],
			] as const) {
				const current = result[bucket] ?? {};
				current[key] = (current[key] ?? 0) + 1;
				result[bucket] = current;
			}
		}
		return result;
	};

	const listing = (query: LibraryQuery): LibraryListing => {
		const needle = query.q.trim().toLowerCase();
		const tagName = new Map(tags().map((tag) => [tag.id, tag.name]));
		const matches = rows.filter((row) => {
			if (query.category !== null && row.category !== query.category)
				return false;
			if (query.kind !== null && row.kind !== query.kind) return false;
			if (
				query.origin_group !== null &&
				row.origin_group !== query.origin_group
			)
				return false;
			if (query.tag !== null && !row.tags.some((tag) => tag.id === query.tag))
				return false;
			if (query.highlighted !== null && row.highlighted !== query.highlighted)
				return false;
			if (query.favorite !== null && row.favorite !== query.favorite)
				return false;
			if (
				query.organized !== null &&
				(row.organized !== null) !== query.organized
			)
				return false;
			if (
				query.session_id !== null &&
				!row.occurrences.some(
					(occurrence) => occurrence.session_id === query.session_id,
				)
			) {
				return false;
			}
			if (needle !== "") {
				const haystack = [
					row.name,
					row.derived_name,
					row.description,
					asString(row.ref.display_path) ?? "",
					...row.tags.map((tag) => tagName.get(asString(tag.id) ?? "") ?? ""),
					...row.occurrences.map((occurrence) => occurrence.session_title),
				]
					.join(" ")
					.toLowerCase();
				if (!haystack.includes(needle)) return false;
			}
			return true;
		});

		const order = query.order ?? DEFAULT_ORDER[query.sort] ?? "desc";
		const direction = order === "asc" ? 1 : -1;
		matches.sort((a, b) => {
			const left = sortKey(a, query.sort);
			const right = sortKey(b, query.sort);
			if (left === right) return a.id.localeCompare(b.id) * direction;
			return (left < right ? -1 : 1) * direction;
		});

		const cursor = cursorAt(query.cursor);
		const reset = cursor !== null && cursor.revision !== revision;
		const offset = reset ? 0 : (cursor?.offset ?? 0);
		const limit = Math.min(200, Math.max(1, query.limit));
		const page = matches.slice(offset, offset + limit);
		const next =
			offset + limit < matches.length
				? cursorFor(offset + limit, revision)
				: null;

		return {
			state: "ready",
			revision,
			total: matches.length,
			counts: counts(),
			tags: tags(),
			rows: clone(page),
			next_cursor: next,
			cursor_reset: reset,
			scan: { sessions_total: 12, sessions_scanned: 12 },
			librarian: null,
		};
	};

	const find = (assetId: string): Row | null =>
		rows.find((row) => row.id === assetId) ?? null;

	const touch = (row: Row) => {
		row.modified_at = Date.now() / 1000;
		revision += 1;
	};

	return {
		reset(): void {
			rows = clone(seed.rows);
			revision = 1;
		},
		list(query: LibraryQuery): LibraryListing {
			return listing(query);
		},
		detail(assetId: string): Row | null {
			const row = find(assetId);
			return row === null ? null : clone(row);
		},
		patch(assetId: string, body: Record<string, unknown>): Row | null {
			const row = find(assetId);
			if (row === null) return null;
			for (const key of [
				"name",
				"description",
				"favorite",
				"locked",
				"archived",
			]) {
				if (key in body && body[key] !== null) {
					(row as Record<string, unknown>)[key] = body[key];
				}
			}
			touch(row);
			return clone(row);
		},
		setTags(
			assetId: string,
			tagIds: string[],
			primary: string | null,
		): Row | null {
			const row = find(assetId);
			if (row === null) return null;
			const known = new Map(tags().map((tag) => [tag.id, tag]));
			row.tags = tagIds
				.filter((id) => known.has(id))
				.map((id) => {
					const tag = known.get(id);
					return {
						id: tag?.id ?? id,
						name: tag?.name ?? id,
						category: tag?.category ?? "custom",
					};
				});
			row.primary_tag = primary;
			touch(row);
			return clone(row);
		},
		tags(): Tag[] {
			return tags();
		},
		createTag(name: string, category: string): Tag {
			const tag: Tag = {
				id: (++tagSeq).toString(16).padStart(10, "0").slice(0, 10),
				name,
				category,
				created_by: "user",
				count: 0,
			};
			seed.tags.push(clone(tag));
			revision += 1;
			return tag;
		},
		renameTag(
			tagId: string,
			body: { name?: string; category?: string },
		): Tag | null {
			const tag = seed.tags.find((candidate) => candidate.id === tagId);
			if (tag === undefined) return null;
			if (body.name !== undefined) {
				tag.name = body.name;
				for (const row of rows) {
					for (const assigned of row.tags) {
						if (assigned.id === tagId) assigned.name = body.name;
					}
				}
			}
			if (body.category !== undefined) tag.category = body.category;
			revision += 1;
			return clone(tag);
		},
		mergeTag(tagId: string, into: string): Tag | null {
			const source = seed.tags.find((tag) => tag.id === tagId);
			const target = seed.tags.find((tag) => tag.id === into);
			if (source === undefined || target === undefined) return null;
			for (const row of rows) {
				if (row.tags.some((tag) => tag.id === tagId)) {
					row.tags = row.tags.filter((tag) => tag.id !== tagId);
					if (!row.tags.some((tag) => tag.id === into)) {
						row.tags.push({
							id: target.id,
							name: target.name,
							category: target.category,
						});
					}
				}
			}
			seed.tags = seed.tags.filter((tag) => tag.id !== tagId);
			revision += 1;
			return clone(target);
		},
		linkChat(assetId: string, sessionId: string): Row | null {
			const row = find(assetId);
			if (row === null) return null;
			const occurrence = row.occurrences.find(
				(candidate) => candidate.session_id === sessionId,
			);
			row.chat = {
				session_id: sessionId,
				title: asString(occurrence?.session_title) ?? "Conversation",
				updated_at: Date.now() / 1000,
			};
			revision += 1;
			return clone(row);
		},
		unlinkChat(assetId: string): { row: Row | null; cleared: boolean } {
			const row = find(assetId);
			if (row === null) return { row: null, cleared: false };
			const cleared = row.chat !== null;
			row.chat = null;
			if (cleared) revision += 1;
			return { row: clone(row), cleared };
		},
		content(assetId: string): { bytes: Buffer; mimeType: string } | null {
			const row = find(assetId);
			if (row === null) return null;
			const mimeType =
				asString(row.ref.content_type) ?? "application/octet-stream";
			if (row.kind === "image") return { bytes: TINY_PNG, mimeType };
			if (row.kind === "audio") return { bytes: TINY_WAV, mimeType };
			if (row.kind === "markdown") return { bytes: MARKDOWN_BYTES, mimeType };
			if (row.kind === "text" || row.kind === "code" || row.kind === "html") {
				return { bytes: MARKDOWN_BYTES, mimeType };
			}
			return { bytes: Buffer.from("Library asset\n"), mimeType };
		},
		thumbnail(assetId: string): { bytes: Buffer; mimeType: string } | null {
			const row = find(assetId);
			if (row === null || row.kind !== "image") return null;
			return { bytes: TINY_PNG, mimeType: "image/png" };
		},
	};
}

export type LibraryStore = ReturnType<typeof createLibraryStore>;
