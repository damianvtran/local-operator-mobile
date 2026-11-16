import type { TranscriptFileRef } from "../../contracts";
import type { ImageBytes } from "../../relay";

const PATH_SEPARATORS = /[\\/]/;
const DOTS_ONLY = /^\.+$/;

/** A display name never becomes a relay path or a local directory. Both slash
 * conventions and control characters are removed before a platform save. */
export const retainedFilename = (filename: string): string =>
	filename
		.split(PATH_SEPARATORS)
		.at(-1)
		?.split("")
		.filter(
			(character) =>
				character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
		)
		.join("")
		.trim()
		.replace(DOTS_ONLY, "") || "attachment";

export type RetainedFileSave = (
	bytes: Uint8Array,
	filename: string,
	mime: string,
) => Promise<boolean>;

/** The only source is the admitted client's owner-bound row/index endpoint.
 * Metadata never supplies a URL, filesystem path, bearer token or byte source. */
export async function downloadRetainedFile(
	load: (entry: string, index: number) => Promise<ImageBytes>,
	entry: string,
	file: TranscriptFileRef,
	save: RetainedFileSave,
): Promise<boolean> {
	const result = await load(entry, file.index);
	return save(
		result.bytes,
		retainedFilename(file.filename),
		result.mimeType ?? file.mime_type,
	);
}

export async function saveRetainedFile(
	bytes: Uint8Array,
	filename: string,
	mime: string,
	platform: string,
): Promise<boolean> {
	if (platform === "web") {
		// Always download opaque bytes: even an HTML document must not execute in
		// the app's authenticated origin if a browser disregards its filename.
		const url = URL.createObjectURL(
			new Blob([bytes as BlobPart], { type: "application/octet-stream" }),
		);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		try {
			anchor.click();
		} finally {
			anchor.remove();
			// Revoked on a LATER task: Safari and Firefox can drop a download whose
			// object URL is revoked in the same task as the click (review R1-3).
			setTimeout(() => URL.revokeObjectURL(url), 0);
		}
		return true;
	}
	if (platform === "android") {
		const fs = await import("expo-file-system/legacy");
		const permission =
			await fs.StorageAccessFramework.requestDirectoryPermissionsAsync();
		if (!permission.granted) return false;
		const uri = await fs.StorageAccessFramework.createFileAsync(
			permission.directoryUri,
			filename,
			mime || "application/octet-stream",
		);
		const { toBase64 } = await import("./runtime");
		await fs.writeAsStringAsync(uri, toBase64(bytes), {
			encoding: fs.EncodingType.Base64,
		});
		return true;
	}
	const { Directory, File, Paths } = await import("expo-file-system");
	const { randomUUID } = await import("expo-crypto");
	const { Share } = await import("react-native");
	const directory = new Directory(Paths.cache, `retained-${randomUUID()}`);
	directory.create({ intermediates: true });
	try {
		const cached = new File(directory, filename);
		cached.create({ intermediates: true });
		cached.write(bytes);
		// iOS's standard share sheet provides Save to Files without another native
		// dependency. Only our retained cache bytes leave the app, never credentials.
		const result = await Share.share({ url: cached.uri, title: filename });
		return result.action === Share.sharedAction;
	} finally {
		// The sheet has finished with the URL once `share` resolves; a plaintext
		// copy must not linger in the cache until iOS purges it (review R1-2).
		directory.delete();
	}
}
