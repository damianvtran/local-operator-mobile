/**
 * The Library's pure half: filters, paging, naming and preview classification.
 *
 * Everything here is deliberate about one contract rule — the relay is the only
 * one who searches, sorts or pages. This module MAPS the screen's vocabulary to
 * the route's query keys and merges pages; it never re-filters a page locally,
 * because a client-side filter would silently shrink a server-paged list and the
 * "Load more" affordance would be lying about what remains.
 *
 * It is React-free and React-Native-free so the rules run in the Node unit suite
 * (`library-model.test.ts`), which is where the paging reset and the prompt's
 * first context line are checked.
 */

import type {
	Capabilities,
	LibraryAsset,
	LibraryListResponse,
	LibraryTag,
	LibraryTagRef,
} from "@/contracts";
import {
	isRelayError,
	type LibraryListRequest,
	type RelayEndpoints,
} from "@/relay";

/* --------------------------------------------------------------- vocabulary */

/** The five single-kind segments plus the overflow bucket. `More` is not a
 *  category of its own: it opens the secondary sheet and resolves to one of
 *  `MORE_CATEGORIES`, because the wire accepts one `category` per request. */
export type LibrarySegment =
	| "all"
	| "image"
	| "sound"
	| "document"
	| "presentation"
	| "video"
	| "more";

export const LIBRARY_SEGMENTS: ReadonlyArray<{
	value: LibrarySegment;
	label: string;
}> = [
	{ value: "all", label: "All" },
	{ value: "image", label: "Images" },
	{ value: "sound", label: "Sounds" },
	{ value: "document", label: "Docs" },
	{
		value: "presentation",
		label: "Slides",
	},
	{ value: "video", label: "Video" },
	{ value: "more", label: "More" },
];

/** The categories `More` offers. `document`/`presentation` are already segments,
 *  so repeating them here would be two doors into one filter. */
export const MORE_CATEGORIES: ReadonlyArray<{
	value: string;
	label: string;
}> = [
	{
		value: "spreadsheet",
		label: "Spreadsheets",
	},
	{ value: "code", label: "Code" },
	{ value: "other", label: "Other" },
];

export type LibraryOriginTab = "all" | "created" | "mentioned";

export const LIBRARY_ORIGINS: ReadonlyArray<{
	value: LibraryOriginTab;
	label: string;
}> = [
	{ value: "all", label: "All" },
	{ value: "created", label: "Created" },
	{
		value: "mentioned",
		label: "Mentioned",
	},
];

export type LibraryStatus = "any" | "highlighted" | "unorganized" | "favorites";

export const LIBRARY_STATUSES: ReadonlyArray<{
	value: LibraryStatus;
	label: string;
}> = [
	{ value: "any", label: "Any status" },
	{
		value: "highlighted",
		label: "Highlighted",
	},
	{
		value: "unorganized",
		label: "Unorganized",
	},
	{
		value: "favorites",
		label: "Favorites",
	},
];

export type LibrarySortValue =
	| "recent"
	| "name"
	| "kind"
	| "size"
	| "created"
	| "modified"
	| "organized";

export const LIBRARY_SORTS: ReadonlyArray<{
	value: LibrarySortValue;
	label: string;
}> = [
	{ value: "recent", label: "Recently seen" },
	{ value: "name", label: "Name" },
	{ value: "kind", label: "Kind" },
	{ value: "size", label: "Largest" },
	{ value: "created", label: "Newest" },
	{
		value: "modified",
		label: "Recently modified",
	},
	{
		value: "organized",
		label: "Recently organized",
	},
];

/** The browse state the screen holds. `query` is the field's text; the caller
 *  debounces before putting it into a request, so this type does not know about
 *  timers. */
export interface LibraryBrowse {
	query: string;
	segment: LibrarySegment;
	/** The category chosen under `More`; ignored for every other segment. */
	moreCategory: string | null;
	origin: LibraryOriginTab;
	tag: string | null;
	status: LibraryStatus;
	sort: LibrarySortValue;
}

export const DEFAULT_BROWSE: LibraryBrowse = {
	query: "",
	segment: "all",
	moreCategory: null,
	origin: "all",
	tag: null,
	status: "any",
	sort: "recent",
};

/** The category one segment asks the server for, or `undefined` for "all". */
export const categoryForBrowse = (
	browse: LibraryBrowse,
): string | undefined => {
	if (browse.segment === "all") return undefined;
	if (browse.segment === "more") return browse.moreCategory ?? undefined;
	return browse.segment;
};

/** The route's default direction for each sort, stated here because the sort
 *  sheet has no separate direction control: the contract fixes them (§4). */
const SORT_ORDER: Record<LibrarySortValue, "asc" | "desc"> = {
	recent: "desc",
	name: "asc",
	kind: "asc",
	size: "desc",
	created: "desc",
	modified: "desc",
	organized: "desc",
};

/** Maps the screen state onto the relay's own query keys. Absent means "no
 *  opinion" and is left off the wire — the relay's defaults are its policy. */
export const libraryListRequest = (
	browse: LibraryBrowse,
	cursor?: string,
	limit?: number,
): LibraryListRequest => {
	const q = browse.query.trim();
	const request: LibraryListRequest = {
		sort: browse.sort,
		order: SORT_ORDER[browse.sort],
	};
	if (q !== "") request.q = q;
	const category = categoryForBrowse(browse);
	if (category !== undefined) request.category = category;
	if (browse.origin !== "all") request.origin_group = browse.origin;
	if (browse.tag !== null) request.tag = browse.tag;
	if (browse.status === "highlighted") request.highlighted = true;
	if (browse.status === "unorganized") request.organized = false;
	if (browse.status === "favorites") request.favorite = true;
	// Never a value the relay has to correct: the endpoint clamps a supplied
	// limit, and omitting it lets the relay's own page size apply.
	if (limit !== undefined) request.limit = limit;
	if (cursor !== undefined) request.cursor = cursor;
	return request;
};

/** True when any filter is narrowing the catalog — the difference between "you
 *  have no assets" and "nothing matched". */
export const hasActiveFilters = (browse: LibraryBrowse): boolean =>
	browse.query.trim() !== "" ||
	browse.segment !== "all" ||
	browse.origin !== "all" ||
	browse.tag !== null ||
	browse.status !== "any";

/* -------------------------------------------------------------------- paging */

export interface LibraryPageMerge {
	rows: LibraryAsset[];
	/** True when the relay restarted the walk because the catalog revision moved.
	 *  The screen shows the fresh first page rather than concatenating two
	 *  revisions, which is the contract's own rule (§3.2). */
	reset: boolean;
	revision: number;
}

/**
 * Merges one page into what is on screen.
 *
 * `cursor_reset` WINS over `append`: a cursor minted at an older revision names
 * rows that may have moved, and the relay restarts at the top precisely so a
 * client does not skip the ones that shifted. Dedupes by id as a second guard —
 * two occurrences of one asset are one row, and a page boundary must not paint it
 * twice.
 */
export const applyLibraryPage = (
	current: LibraryAsset[],
	page: LibraryListResponse,
	append: boolean,
): LibraryPageMerge => {
	if (!append || page.cursor_reset) {
		return {
			rows: page.rows,
			reset: page.cursor_reset,
			revision: page.revision,
		};
	}
	const seen = new Set(current.map((row) => row.id));
	return {
		rows: [
			...current,
			...page.rows.filter((row) => {
				if (seen.has(row.id)) return false;
				seen.add(row.id);
				return true;
			}),
		],
		reset: false,
		revision: page.revision,
	};
};

/* -------------------------------------------------------------------- naming */

/** The name a reader sees: the user's name, then the scanner's derived one, then
 *  the file's last segment. The id is the last resort, never a path — the whole
 *  point of the projection is that the phone does not hold one. */
export const effectiveName = (asset: LibraryAsset): string => {
	if (asset.name.trim() !== "") return asset.name;
	if (asset.derived_name.trim() !== "") return asset.derived_name;
	const path = asset.ref.display_path.trim();
	if (path !== "") {
		const segment = path.split("/").filter(Boolean).at(-1);
		if (segment !== undefined) return segment;
	}
	return asset.id;
};

const KIND_LABELS: Record<string, string> = {
	image: "Image",
	audio: "Audio",
	video: "Video",
	pdf: "PDF",
	pptx: "Slides",
	docx: "Document",
	markdown: "Markdown",
	html: "HTML",
	spreadsheet: "Spreadsheet",
	text: "Text",
	code: "Code",
	other: "File",
};

export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? "File";

const CATEGORY_LABELS: Record<string, string> = {
	image: "Images",
	sound: "Sounds",
	document: "Documents",
	presentation: "Presentations",
	video: "Video",
	spreadsheet: "Spreadsheets",
	code: "Code",
	other: "Other",
};

export const categoryLabel = (category: string): string =>
	CATEGORY_LABELS[category] ?? "Other";

/** A byte count in the register a catalog uses: whole units, one decimal only
 *  where it helps (`1.5 MB`), and never a bare `0` for an empty file. */
export const formatBytes = (bytes: number | null): string => {
	if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${rounded} ${units[unit]}`;
};

export const assetFacts = (asset: LibraryAsset): string => {
	const parts = [kindLabel(asset.kind)];
	if ((asset.size_bytes ?? 0) > 0) parts.push(formatBytes(asset.size_bytes));
	if (asset.session_count > 1) parts.push(`${asset.session_count} chats`);
	if (!asset.exists) parts.push("file missing");
	return parts.join(" · ");
};

/* ------------------------------------------------------------------ previews */

export type PreviewKind =
	| "image"
	| "audio"
	| "video"
	| "markdown"
	| "html"
	| "text"
	| "unsupported";

/** Which renderer the detail screen uses. PDF/PPTX/DOCX are unsupported on this
 *  client because the relay has no preview page and no office rasteriser — the
 *  contract's §10 non-goal — so the screen says so rather than showing a blank
 *  WebView. HTML uses the WebView with scripts off; markdown uses the existing
 *  transcript renderer; spreadsheet/code/text are read as text. */
export const previewKind = (asset: LibraryAsset): PreviewKind => {
	switch (asset.kind) {
		case "image":
			return "image";
		case "audio":
			return "audio";
		case "video":
			return "video";
		case "markdown":
			return "markdown";
		case "html":
			return "html";
		case "text":
		case "code":
		case "spreadsheet":
			return "text";
		default:
			return "unsupported";
	}
};

/** The honest reason line for an unsupported preview. It names what the reader
 *  has and what still works — the contract's "designed state, not a blank pane"
 *  rule (§7). */
export const unsupportedReason = (asset: LibraryAsset): string => {
	const label = kindLabel(asset.kind);
	return `${label} previews open on the desktop. The file and its details are still here.`;
};

/* ------------------------------------------------------------------ composer */

/** The first context line a chat receives. The PATH (or digest) leads, on its
 *  own line, so the model reads the asset reference before the question — the
 *  contract's own ordering rule (§4.1). */
export const assetContextLine = (asset: LibraryAsset): string => {
	if (asset.ref.type === "artifact") {
		const digest = asset.ref.digest ?? asset.id;
		return `Asset digest: ${digest}`;
	}
	return `Asset: ${asset.ref.display_path}`;
};

/**
 * The prompt the Library composer sends.
 *
 * The metadata block is deliberately short and stable: it is context for the
 * model, not a transcript of the catalog. The user's own words follow after a
 * blank line, unchanged, so the first message still reads as THEIR message —
 * which is also why an empty compose is the caller's to refuse, not this
 * function's to fill with a canned question.
 */
export const composerPrompt = (asset: LibraryAsset, text: string): string => {
	const lines = [
		assetContextLine(asset),
		`Name: ${effectiveName(asset)}`,
		`Kind: ${kindLabel(asset.kind)}`,
	];
	if ((asset.size_bytes ?? 0) > 0)
		lines.push(`Size: ${formatBytes(asset.size_bytes)}`);
	if (asset.tags.length > 0) {
		lines.push(`Tags: ${asset.tags.map((tag) => tag.name).join(", ")}`);
	}
	if (asset.description.trim() !== "") {
		lines.push(`Description: ${asset.description.trim()}`);
	}
	return `${lines.join("\n")}\n\n${text.trim()}`;
};

/** The image attachment for an image asset, or `null` when the prompt wire has
 *  no place for these bytes. The relay's prompt body carries images only (no
 *  audio), which is why audio clips travel as a path line instead. */
export const promptImage = (
	asset: LibraryAsset,
	bytes: Uint8Array | null,
): { data_b64: string; mime_type: string } | null => {
	if (asset.kind !== "image" || bytes === null || bytes.length === 0)
		return null;
	const mime = asset.ref.content_type ?? asset.preview.mime_type ?? "image/png";
	// A phone camera's bytes can be megabytes; the relay's prompt body has no
	// streaming arm, so the same bound the attach path uses applies here.
	if (bytes.length > 8 * 1024 * 1024) return null;
	return { data_b64: toBase64(bytes), mime_type: mime };
};

/** Base64 without `Buffer` (which does not exist on native). Mirrors
 *  `features/session/runtime.ts`'s helper; kept local so this module stays
 *  importable by the Node suite without pulling in the session runtime. */
const toBase64 = (bytes: Uint8Array): string => {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i] ?? 0;
		const b = bytes[i + 1];
		const c = bytes[i + 2];
		out += alphabet[a >> 2] ?? "";
		out += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)] ?? "";
		out +=
			b === undefined
				? "="
				: (alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)] ?? "");
		out += c === undefined ? "=" : (alphabet[c & 63] ?? "");
	}
	return out;
};

/* ------------------------------------------------------------ metadata saves */

/** The sentence a tag-half failure shows. Named so a test asserts the COPY the
 *  reader sees, not a copy re-typed in the test. */
export const TAG_SAVE_FAILURE_COPY =
	"The name and description were saved, but the tags were not. Save again to retry the tags.";

/** What one Save produced. `close` is false for a partial success: the sheet
 *  stays open with the refusal and the intended tag set, so the reader can retry
 *  instead of being told the whole save failed (review round 1, major 2). */
export interface MetadataSaveOutcome {
	asset: LibraryAsset;
	vocabulary: LibraryTag[];
	assigned: string[];
	refusal: string | null;
	close: boolean;
}

/** Tags arrive on an asset row as briefs (no count/provenance); the editor's
 *  chips want the catalogue row. The missing fields are filled from what the
 *  sheet already knows, never invented as a new count. */
const asCatalogueTag = (
	tag: LibraryTagRef,
	vocabulary: LibraryTag[],
): LibraryTag => ({
	...tag,
	count: vocabulary.find((known) => known.id === tag.id)?.count ?? 0,
	created_by: "user",
	created_at: 0,
	updated_at: 0,
});

/** Merges tag rows by id, keeping the catalogue's name order. */
export const mergeVocabulary = (
	current: LibraryTag[],
	incoming: LibraryTag[],
): LibraryTag[] => {
	const byId = new Map(current.map((tag) => [tag.id, tag]));
	for (const tag of incoming) byId.set(tag.id, tag);
	return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * The editor resets when it OPENS, never when a parent row update arrives.
 *
 * The defect this guards: a successful PATCH answers with the row read back —
 * which still carries the SERVER's tags. Updating the parent asset while the
 * sheet was open re-ran the reset effect, cleared the reader's just-assigned
 * tags and erased the refusal sentence, so the screen looked as if the tag write
 * had never been attempted. `openedFor` is the asset id the sheet last reset
 * for; `null` means closed.
 */
export const editorShouldReset = (
	visible: boolean,
	openedFor: string | undefined,
	assetId: string,
): boolean => visible && openedFor !== assetId;

/**
 * One Save: PATCH the metadata, then replace the tag assignment, and reconcile
 * the outcome explicitly.
 *
 * A tag refusal keeps `assigned` as the reader intended and `close: false`; a
 * success returns the server's own tag set as `assigned`, so the two cannot
 * disagree after a retry. A PATCH refusal throws — nothing landed, and the
 * caller shows its own sentence.
 */
export async function saveAssetMetadata(
	client: RelayEndpoints,
	input: {
		asset: LibraryAsset;
		name: string;
		description: string;
		assigned: string[];
		vocabulary: LibraryTag[];
	},
): Promise<MetadataSaveOutcome> {
	const updated = await client.patchLibraryAsset(input.asset.id, {
		name: input.name,
		description: input.description,
	});
	try {
		const withTags = await client.setLibraryAssetTags(
			input.asset.id,
			input.assigned,
			input.assigned[0],
		);
		/* The tag write changed the global counts, and the list paints those
		 *  counts. Re-read the vocabulary here, before the sheet closes, so Back
		 *  cannot show the pre-save numbers; a failed re-read keeps the merged
		 *  local view rather than failing a save that already landed. */
		let vocabulary = mergeVocabulary(
			input.vocabulary,
			withTags.tags.map((tag) => asCatalogueTag(tag, input.vocabulary)),
		);
		try {
			vocabulary = (await client.libraryTags()).tags;
		} catch {
			// No count refresh; the rows and tag names are still correct.
		}
		return {
			asset: withTags,
			vocabulary,
			assigned: withTags.tags.map((tag) => tag.id),
			refusal: null,
			close: true,
		};
	} catch (failure) {
		return {
			asset: updated,
			vocabulary: input.vocabulary,
			assigned: input.assigned,
			refusal: isRelayError(failure)
				? (failure.displayableMessage ?? TAG_SAVE_FAILURE_COPY)
				: TAG_SAVE_FAILURE_COPY,
			close: false,
		};
	}
}

/** Applies every saved detail row to the rows the list already holds. Ids are
 *  opaque, so this is the only join key; a row outside the loaded pages is left
 *  alone and appears on the next fetch. A Map keeps saves for different assets
 *  independent, which an append cannot overwrite. */
export const applyLibraryUpdates = (
	rows: LibraryAsset[],
	updates: ReadonlyMap<string, LibraryAsset>,
): LibraryAsset[] => rows.map((row) => updates.get(row.id) ?? row);

/** Retires saved-row overrides a later authoritative fetch has moved past.
 *  A fetch that STARTED after the save may replace the row; one that was already
 *  in flight when the save happened must keep the local value. */
export const retireAuthoritativeOverrides = (
	overrides: Map<string, LibraryAsset>,
	epochs: Map<string, number>,
	returned: LibraryAsset[],
	requestEpoch: number,
): void => {
	for (const row of returned) {
		const savedAt = epochs.get(row.id);
		if (savedAt !== undefined && requestEpoch > savedAt) {
			overrides.delete(row.id);
			epochs.delete(row.id);
		}
	}
};

/* ---------------------------------------------------------------------- gate */

/**
 * Whether this relay knows the Library at all.
 *
 * The capability bag is a lazy flag dict on the relay's side and its values are
 * version numbers, so a key's PRESENCE (a non-zero value) is the claim. An older
 * relay omits the key and the footer entry is hidden — never shown as a control
 * that would 404. A value of `0`, `false`, `null` or an empty string is the same
 * absence.
 */
export const libraryEnabled = (capabilities: Capabilities): boolean => {
	const value = capabilities.features?.library;
	if (value === undefined || value === null || value === false) return false;
	if (typeof value === "number") return value > 0;
	if (typeof value === "string") return value !== "" && value !== "0";
	return true;
};
