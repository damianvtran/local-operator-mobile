import { Platform } from "react-native";

import type { PromptImage } from "@/contracts";
import { fromDataUrl, sniffImageMime } from "@/features/session/attach-rule";

/**
 * The pickers behind the composer's attach sheet, and the one page they all read
 * their image onto (`{ data_b64, mime_type }`).
 *
 * **Three sources, one wire form.** `library` is the platform's modern photo
 * chooser — iOS 14+ `PHPickerViewController`, Android 13+ Photo Picker, through
 * `expo-image-picker` — which is where screenshots and camera-roll photos live
 * and which needs NO photo-library permission on either platform (the plugin is
 * configured to declare nothing; `app.config.ts` has the why). `files` is the
 * document picker this control has used since the session view landed
 * (`expo-file-system`'s `File.pickFileAsync` on native, the browser's own
 * `<input type="file">` on the web target). `paste` reads an image out of the
 * clipboard (`expo-clipboard`'s `getImageAsync`; `navigator.clipboard.read` on
 * the web target). Whichever one produced the image, what the composer adds is
 * the same `{ data_b64, mime_type }` the send path already carries.
 *
 * **Failures are not "cancelled".** A read that fails after the reader chose an
 * image throws, so the composer can say so: collapsing it into `null` would tell
 * the reader nothing happened when their image was lost. `null` means exactly one
 * thing — the reader backed out, or the clipboard held no image.
 *
 * **Not downscaled.** The kit asks for a 1568 px long-edge cap before upload, and
 * none of these three paths resizes: the photo picker's base64 output is its own
 * full-resolution re-encode (not a downscale), and re-encoding needs an image
 * pipeline this app does not have. Oversize images are sent at their original
 * size, which the runtime accepts and refits on its own side (contract § 8.10);
 * the retry envelope refuses to RETAIN one past its own size cap, visibly, rather
 * than dropping it.
 */

/** The system photo picker: iOS 14+ PHPicker, Android 13+ Photo Picker. The web
 *  target's build has no photo library, and its sheet offers the file input
 *  instead (`attachActions`), so this resolves to that same chooser. */
export const pickImageFromLibrary = async (): Promise<PromptImage | null> =>
	Platform.OS === "web" ? pickOnWeb() : pickFromLibraryNative();

const pickFromLibraryNative = async (): Promise<PromptImage | null> => {
	// Imported on call: the module is only evaluated on the platform that uses it.
	const { launchImageLibraryAsync } = await import("expo-image-picker");
	const result = await launchImageLibraryAsync({
		mediaTypes: ["images"],
		// The wire needs the bytes, and the picker can hand them over already
		// base64-encoded — one read instead of a second file-system round trip.
		base64: true,
		allowsMultipleSelection: false,
	});
	if (result.canceled) return null;
	// Narrowed on the discriminant the API carries, never cast: the cancelled arm
	// has no `assets` at all, and asserting otherwise turns a cancel into a crash.
	const asset = result.assets[0];
	// `base64` is genuinely optional (`string | null`), and an empty payload is
	// the same fact: there are no bytes to attach. Thrown rather than returned as
	// `null`, because "the reader chose nothing" and "the bytes are missing" are
	// different outcomes and only one of them is silent.
	if (typeof asset?.base64 !== "string" || asset.base64.length === 0) {
		throw new Error("the image could not be read");
	}
	return {
		data_b64: asset.base64,
		// NOT `asset.mimeType`: see `sniffImageMime` — the picker's base64 output
		// is always JPEG, while the reported type is the SOURCE asset's.
		mime_type: sniffImageMime(asset.base64, asset.mimeType ?? ""),
	};
};

/** The document picker path (native) / the browser's file input (web) — the
 *  chooser this control has had since the session view landed, unchanged. */
export const pickImageFromFiles = async (): Promise<PromptImage | null> =>
	Platform.OS === "web" ? pickOnWeb() : pickFromFilesNative();

/** The platform document picker, through `expo-file-system`. */
const pickFromFilesNative = async (): Promise<PromptImage | null> => {
	// Imported on call: the module is only evaluated on the platform that uses it.
	const { File } = await import("expo-file-system");
	const picked = await File.pickFileAsync({ mimeTypes: ["image/*"] });
	// Narrowed on the discriminant the API carries, never cast: the cancelled arm's
	// `result` is `null`, and asserting otherwise turns a cancel into a crash.
	if (picked.canceled) return null;
	const file = picked.result;
	return {
		data_b64: await file.base64(),
		mime_type: file.type || "image/jpeg",
	};
};

/** The browser's own picker. Resolves `null` on cancel (the `cancel` event). */
const pickOnWeb = (): Promise<PromptImage | null> =>
	new Promise((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.addEventListener("cancel", () => resolve(null), { once: true });
		input.addEventListener(
			"change",
			() => {
				const file = input.files?.[0];
				if (!file) {
					resolve(null);
					return;
				}
				readWebImageFile(file).then(resolve, reject);
			},
			{ once: true },
		);
		input.click();
	});

/**
 * Read one web `File` — from the file input, a paste event, or the clipboard —
 * into the wire form.
 *
 * Exported because three callers now share it, and the rule it composes (the
 * data URL's own type header wins over the reported one) is the same rule
 * `attach-rule.ts` tests: a browser reports `""` for some images, and the relay
 * needs a real type to forward the attachment to a model.
 */
export const readWebImageFile = async (file: File): Promise<PromptImage> => {
	const url = await readBlobAsDataUrl(file);
	return fromDataUrl(url, file.type);
};

/** `FileReader.readAsDataURL` as a promise. Written once: the file input, the
 *  paste event and the clipboard read all decode the same way. `readAsDataURL`
 *  always yields a string, narrowed rather than cast, because the property's
 *  declared type also admits an ArrayBuffer. */
const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			const result = reader.result;
			if (typeof result !== "string") {
				reject(new Error("the image could not be read"));
				return;
			}
			resolve(result);
		});
		reader.addEventListener("error", () =>
			reject(new Error("the image could not be read")),
		);
		reader.readAsDataURL(blob);
	});

/**
 * Read an image out of the clipboard, or `null` when the clipboard holds none.
 *
 * **Two indistinguishable `null` arms, on purpose.** `getImageAsync` answers
 * `null` both when there is no image and when iOS 16+ denies the paste — the
 * platform offers no way to tell them apart (its own documentation says so), so
 * the composer's sentence for `null` reports only the outcome and never blames
 * the clipboard's contents for a denial.
 */
export const pasteImage = async (): Promise<PromptImage | null> =>
	Platform.OS === "web" ? pasteOnWeb() : pasteOnNative();

const pasteOnNative = async (): Promise<PromptImage | null> => {
	// Imported on call, like the pickers: evaluated only where it exists.
	const Clipboard = await import("expo-clipboard");
	// PNG, deliberately: the pasteboard's dominant case is a screenshot, and a
	// screenshot IS a PNG — asking for PNG re-encodes losslessly, where JPEG
	// would quantise small text. A pasted photo pays a larger payload here, which
	// the relay's own refit (contract § 8.10) absorbs on the way to the model.
	const image = await Clipboard.getImageAsync({ format: "png" });
	// `data` is a full data URL (`data:image/png;base64,…`), so the existing
	// splitter reads the type from the header the platform itself wrote.
	return image === null ? null : fromDataUrl(image.data, "image/png");
};

const pasteOnWeb = async (): Promise<PromptImage | null> => {
	/* The Clipboard API needs a secure context and a user gesture. The sheet
	 * press is the gesture and localhost is a secure context; a browser without
	 * the API (or without permission) lands on `null` — the same reading as "no
	 * image on the clipboard", which is the sentence the composer shows. The
	 * web target ALSO listens for a real paste event (the composer's own
	 * listener), which is the path that does not need this API at all. */
	const clipboard = globalThis.navigator?.clipboard;
	if (typeof clipboard?.read !== "function") return null;
	const items = await clipboard.read();
	for (const item of items) {
		const type = item.types.find((candidate) => candidate.startsWith("image/"));
		if (type === undefined) continue;
		const blob = await item.getType(type);
		return fromDataUrl(await readBlobAsDataUrl(blob), type);
	}
	return null;
};
