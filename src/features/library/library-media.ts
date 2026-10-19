/**
 * Fetching a Library asset's bytes into something a preview can open.
 *
 * The relay's content route is authenticated with the app's own cookie policy,
 * which a platform image/video loader does not share. So every preview goes
 * through the typed client and the bytes are handed to the renderer in a form it
 * can read:
 *
 *   - an image becomes a `data:` URI (the transcript's own convention);
 *   - audio/video become a native cache file (`expo-file-system`) or a Blob
 *     object URL on web — the two platforms' players need opposite things, and
 *     `features/session/runtime.ts` already established the cache-file shape;
 *   - text-like documents become the decoded string, which the existing
 *     markdown/text renderers paint.
 *
 * Nothing is fetched for a preview kind this build cannot render: a PDF has no
 * native renderer here and the server has no rasteriser, so the detail screen
 * says so instead of downloading megabytes to show a blank box. That is the
 * contract's "unsupported cell is a designed state", not an omission.
 */

import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import type { LibraryAsset } from "@/contracts";
import {
	type PreviewKind,
	previewKind,
} from "@/features/library/library-model";
import type { RelayEndpoints } from "@/relay";

/** What a preview renderer receives. `null` means "not loaded yet"; `error`
 *  carries the relay's own sentence when it gave one. */
export type LibraryMedia =
	| { kind: "image"; uri: string }
	| { kind: "audio"; uri: string }
	| { kind: "video"; uri: string }
	| { kind: "text"; text: string }
	| { kind: "html"; html: string };

export interface LibraryMediaState {
	media: LibraryMedia | null;
	loading: boolean;
	error: string | null;
}

/** The preview kinds whose bytes are fetched. `unsupported` is absent on purpose:
 *  a screen must ask `previewKind` first and never fetch bytes it cannot paint. */
const FETCHED: ReadonlySet<PreviewKind> = new Set([
	"image",
	"audio",
	"video",
	"markdown",
	"text",
	"html",
]);

const MEDIA_EXTENSIONS: Record<string, string> = {
	"audio/mpeg": "mp3",
	"audio/mp4": "m4a",
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/ogg": "ogg",
	"video/mp4": "mp4",
	"video/quicktime": "mov",
	"video/webm": "webm",
};

const extensionFor = (mimeType: string | null): string => {
	const base = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
	return MEDIA_EXTENSIONS[base] ?? "bin";
};

/** Text decode. HTML/Markdown/text are UTF-8 on the wire; a byte that is not is
 *  replacement-charactered rather than thrown away, which is the honest reading
 *  of a document the relay called text. */
const decodeText = (bytes: Uint8Array): string =>
	new TextDecoder("utf-8", { fatal: false }).decode(bytes);

async function cacheNativeBytes(
	assetId: string,
	mimeType: string | null,
	bytes: Uint8Array,
): Promise<string> {
	const { Directory, File, Paths } = await import("expo-file-system");
	// One directory for Library media, the same OS-reclaimable posture as the
	// transcript's video cache. Keyed by the opaque id, never by a path.
	const directory = new Directory(Paths.cache, "lo-library");
	if (!directory.exists) directory.create({ intermediates: true });
	const file = new File(
		directory,
		`${assetId.replace(/[^a-zA-Z0-9_-]/g, "")}.${extensionFor(mimeType)}`,
	);
	if (!file.exists) file.create({ intermediates: true });
	file.write(bytes);
	return file.uri;
}

/**
 * One asset's bytes, read once per mount.
 *
 * The abort flag is not an optimisation: a detail screen can be popped while the
 * fetch is in flight, and writing state into an unmounted tree is the warning
 * React Native's dev build turns into a red screen.
 */
export function useLibraryMedia(
	client: RelayEndpoints | null,
	asset: LibraryAsset | null,
): LibraryMediaState {
	const [state, setState] = useState<LibraryMediaState>({
		media: null,
		loading: false,
		error: null,
	});
	const assetId = asset?.id ?? null;
	const requestSeq = useRef(0);

	useEffect(() => {
		if (client === null || asset === null || assetId === null) {
			setState({ media: null, loading: false, error: null });
			return;
		}
		const kind = previewKind(asset);
		if (!FETCHED.has(kind) || !asset.exists) {
			// A missing file is not an error to retry: the row says `exists: false`
			// and the screen owns that sentence.
			setState({ media: null, loading: false, error: null });
			return;
		}
		const seq = requestSeq.current + 1;
		requestSeq.current = seq;
		let cancelled = false;
		/* The web player is handed an object URL, not bytes. Keep the handle so
		 *  teardown can release it even when the fetch finishes after unmount. */
		let objectUrl: string | null = null;
		setState({ media: null, loading: true, error: null });

		void (async () => {
			try {
				const { bytes, mimeType } = await client.libraryContent(asset.id);
				if (cancelled || seq !== requestSeq.current) return;
				const type = mimeType ?? asset.ref.content_type;
				let media: LibraryMedia;
				if (kind === "image") {
					media = {
						kind: "image",
						uri: `data:${type ?? "image/png"};base64,${toBase64(bytes)}`,
					};
				} else if (kind === "audio" || kind === "video") {
					let uri: string;
					if (Platform.OS === "web") {
						objectUrl = URL.createObjectURL(
							new Blob([bytes as BlobPart], {
								type: type ?? (kind === "audio" ? "audio/mpeg" : "video/mp4"),
							}),
						);
						/* The effect was torn down while this fetch was in flight: no
						 *  component will ever receive the URL, so release it here. */
						if (cancelled || seq !== requestSeq.current) {
							URL.revokeObjectURL(objectUrl);
							return;
						}
						uri = objectUrl;
					} else {
						uri = await cacheNativeBytes(asset.id, type, bytes);
					}
					media = { kind, uri };
				} else if (kind === "html") {
					media = { kind: "html", html: decodeText(bytes) };
				} else {
					media = { kind: "text", text: decodeText(bytes) };
				}
				setState({ media, loading: false, error: null });
			} catch {
				if (cancelled || seq !== requestSeq.current) return;
				setState({
					media: null,
					loading: false,
					error:
						"This preview could not be read. The asset is still in your library.",
				});
			}
		})();

		return () => {
			cancelled = true;
			// The web player receives an object URL; releasing it here keeps a detail
			// screen visited ten times from holding ten copies of a video in memory.
			// Native cache files are the OS's to reclaim (runtime.ts's own posture).
			if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
		};
	}, [client, asset?.id, assetId, asset]);

	return state;
}

const thumbnailCache = new Map<string, string>();

/** The grid's thumbnail for one asset. Images only — the contract says every
 *  other kind carries no thumbnail and surfaces draw a kind icon. Failures are
 *  silent by design: a tile without a thumbnail is a designed state, and a grid
 *  of twenty retry rows would be noise, not information. */
export function useLibraryThumbnail(
	client: RelayEndpoints | null,
	asset: LibraryAsset,
): string | null {
	const [uri, setUri] = useState<string | null>(
		() => thumbnailCache.get(asset.id) ?? null,
	);
	useEffect(() => {
		if (client === null || asset.kind !== "image" || !asset.exists) return;
		const cached = thumbnailCache.get(asset.id);
		if (cached !== undefined) {
			setUri(cached);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const { bytes, mimeType } = await client.libraryThumbnail(
					asset.id,
					480,
				);
				if (cancelled) return;
				const value = `data:${mimeType ?? "image/webp"};base64,${toBase64(bytes)}`;
				thumbnailCache.set(asset.id, value);
				setUri(value);
			} catch {
				// A designed absence; the tile's kind icon is already painted.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [client, asset.id, asset.kind, asset.exists]);
	return uri;
}

/** Base64 without `Buffer` (native has none). The same loop as the session
 *  runtime's helper; imported from there instead would pull the transcript's
 *  module graph into every Library tile. */
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
