import { Platform } from "react-native";

import { boundToLimits } from "@/team-bridge/attachments";

/**
 * Where a Team Bridge image comes from on the device, and how it becomes the
 * bounded PNG/JPEG bytes the hub accepts.
 *
 * TWO SOURCES. The system photo picker (`expo-image-picker`: iOS PHPicker,
 * Android Photo Picker; no photo-library permission, the same configuration the
 * session composer relies on, `src/features/session/attach.ts`) and the
 * clipboard (`expo-clipboard` `getImageAsync`). Both hand over a URI (a picked
 * asset's file URI, or the pasteboard's `data:` URL) and the source size.
 *
 * ONE CONVERSION. Every image goes through `expo-image-manipulator` (bundled
 * with this Expo SDK) and `boundToLimits`: HEIC/WebP/GIF become JPEG (PNG
 * stays PNG when it fits), the long edge is capped at 1024 px and the bytes at
 * 1 MiB (manager decision D3). The re-encode is also what strips camera
 * EXIF/GPS metadata before anything leaves the phone. Unlike the session
 * composer, which relies on the relay's own refit, the hub keeps these bytes
 * for every member, so the bound happens HERE.
 *
 * PRIVACY OF THE TEMP FILE. The manipulator writes its output into the app's
 * own cache directory; it is read back as base64 and deleted immediately, so no
 * converted image lingers on disk. Nothing here logs a URI, a size or a byte.
 */

export interface PreparedImage {
	bytes: Uint8Array;
	mime: "image/png" | "image/jpeg";
	width: number;
	height: number;
}

interface RawImage {
	uri: string;
	width: number;
	height: number;
	isPng: boolean;
}

/** Up to `limit` images from the system photo picker; `[]` when cancelled. */
export async function pickTeamBridgeImages(limit: number): Promise<RawImage[]> {
	const { launchImageLibraryAsync } = await import("expo-image-picker");
	const result = await launchImageLibraryAsync({
		mediaTypes: ["images"],
		// No `base64`: the picker's own base64 is a full-resolution JPEG
		// re-encode (attach-rule.ts `sniffImageMime`), and every image is
		// re-encoded once below anyway.
		allowsMultipleSelection: limit > 1,
		selectionLimit: limit,
		quality: 1,
	});
	if (result.canceled) return [];
	return result.assets.slice(0, limit).map((asset) => ({
		uri: asset.uri,
		width: asset.width,
		height: asset.height,
		isPng: asset.mimeType === "image/png",
	}));
}

/**
 * The clipboard's image, or `null` when it holds none. `null` also covers an
 * iOS paste denial: the platform does not distinguish the two, so the composer
 * reports only that no image was pasted.
 */
export async function pasteTeamBridgeImage(): Promise<RawImage | null> {
	const Clipboard = await import("expo-clipboard");
	// PNG: the common pasteboard image is a screenshot, and PNG keeps its text
	// sharp; `boundToLimits` falls back to JPEG when PNG does not fit.
	const image = await Clipboard.getImageAsync({ format: "png" });
	if (image === null) return null;
	return {
		uri: image.data,
		width: image.size.width,
		height: image.size.height,
		isPng: true,
	};
}

/** Convert and bound one picked/pasted image (see the module comment). */
export async function prepareTeamBridgeImage(
	raw: RawImage,
): Promise<PreparedImage> {
	const { ImageManipulator, SaveFormat } = await import(
		"expo-image-manipulator"
	);
	return boundToLimits(raw, async (step) => {
		const context = ImageManipulator.manipulate(raw.uri);
		try {
			const rendered = await context
				.resize({ width: step.width, height: step.height })
				.renderAsync();
			try {
				const saved = await rendered.saveAsync({
					format: step.format === "png" ? SaveFormat.PNG : SaveFormat.JPEG,
					compress: step.quality,
					base64: true,
				});
				await removeTemp(saved.uri);
				if (typeof saved.base64 !== "string" || saved.base64.length === 0)
					throw new Error("the image could not be converted");
				return saved.base64;
			} finally {
				rendered.release();
			}
		} finally {
			context.release();
		}
	});
}

/** Delete the manipulator's cache-directory output. Best effort, never logged. */
async function removeTemp(uri: string): Promise<void> {
	if (Platform.OS === "web" || !uri.startsWith("file:")) return;
	try {
		const { File } = await import("expo-file-system");
		const file = new File(uri);
		if (file.exists) file.delete();
	} catch {
		/* A leftover cache file is cleared by the OS; never fail the send for it. */
	}
}
