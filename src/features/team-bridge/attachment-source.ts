import { Platform } from "react-native";

import { boundToLimits } from "@/team-bridge/attachments";
import { syntheticAttachmentSource } from "@/testing/team-bridge-attachment-source";

/**
 * Where a Team Bridge image comes from on the device, and how it becomes the
 * bounded PNG/JPEG bytes the hub accepts.
 *
 * THREE SOURCES. The system camera (`takeTeamBridgePhoto`), the system photo picker (`expo-image-picker`: iOS PHPicker,
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

export interface RawImage {
	uri: string;
	width: number;
	height: number;
	isPng: boolean;
}

/** Up to `limit` images from the system photo picker; `[]` when cancelled. */
export async function pickTeamBridgeImages(limit: number): Promise<RawImage[]> {
	const synthetic = syntheticAttachmentSource();
	if (synthetic) return limit > 0 ? [synthetic] : [];
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
 * One photo from the system camera, or `null` when the reader backed out.
 *
 * Team Bridge's Take Photo row (round 1 of PR #278, U5/D1: Team Bridge renders
 * the session composer's AttachSheet). The camera PERMISSION is not asked here:
 * the shared sheet's `prepareCamera` asks on the reader's press and only hands
 * the row over once access is granted, exactly as for the session composer.
 * What differs is the pipeline after the shutter — this returns the same
 * `RawImage` (a cache-file URI plus dimensions) as a picked photo, so the
 * capture is bounded, EXIF-stripped and its cache copy released by the same
 * `prepareTeamBridgeImage` / `releaseTeamBridgeSource` as the library.
 */
export async function takeTeamBridgePhoto(): Promise<RawImage | null> {
	const synthetic = syntheticAttachmentSource();
	if (synthetic) return synthetic;
	const { launchCameraAsync } = await import("expo-image-picker");
	const result = await launchCameraAsync({
		mediaTypes: ["images"],
		// No `base64`, for the library's reason: every image is re-encoded once
		// in `prepareTeamBridgeImage`.
		quality: 1,
	});
	if (result.canceled) return null;
	const asset = result.assets[0];
	if (asset === undefined) return null;
	return {
		uri: asset.uri,
		width: asset.width,
		height: asset.height,
		isPng: asset.mimeType === "image/png",
	};
}

/**
 * The clipboard's image, or `null` when it holds none. `null` also covers an
 * iOS paste denial: the platform does not distinguish the two, so the composer
 * reports only that no image was pasted.
 */
export async function pasteTeamBridgeImage(): Promise<RawImage | null> {
	const synthetic = syntheticAttachmentSource();
	if (synthetic) return synthetic;
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

/**
 * Release a picked source's on-device copy. `expo-image-picker` copies every
 * picked asset into the app cache (`Caches/ImagePicker/` on iOS, the cache
 * directory on Android) at FULL resolution with its original EXIF/GPS; that
 * copy must not outlive the bounded re-encode. A pasted image is a `data:` URL
 * in memory and has nothing on disk.
 */
export async function releaseTeamBridgeSource(raw: RawImage): Promise<void> {
	await removeTemp(raw.uri);
}

/** Delete one app-cache file. Best effort, never logged. */
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
