import { pasteTempRoots } from "./attach-rule";
import {
	isOwnedPasteFile,
	isOwnedPickerCacheFile,
	pickerPrivacy,
} from "./picker-privacy";

export async function removePickedCacheCopy(
	uri: string | undefined,
): Promise<void> {
	try {
		const { File, Paths } = await import("expo-file-system");
		if (!uri || !isOwnedPickerCacheFile(uri, Paths.cache.uri))
			throw new Error("unowned image copy");
		const file = new File(uri);
		// `exists` alone maps a denied read to false in Expo. `info()` validates
		// permission, so an inaccessible copy cannot masquerade as a missing one.
		if (file.info().exists) file.delete();
		if (file.info().exists) throw new Error("image copy remains");
	} catch {
		// Native filesystem exceptions can contain the asset URI. Propagate a
		// failure through the existing attachment surface without leaking it.
		throw new Error("the image could not be read");
	}
}
/**
 * Delete the file `expo-paste-input` wrote for a pasted image, once its bytes
 * are in memory. Same contract as `removePickedCacheCopy`: only a file directly
 * in the app's own cache or `tmp/` directory is touched, and a copy that cannot
 * be verified gone fails the attachment rather than lingering after sign-out.
 */
export async function removePastedCopy(uri: string | undefined): Promise<void> {
	try {
		const { File, Paths } = await import("expo-file-system");
		if (!uri || !isOwnedPasteFile(uri, pasteTempRoots(Paths.cache.uri)))
			throw new Error("unowned image copy");
		const file = new File(uri);
		if (file.info().exists) file.delete();
		if (file.info().exists) throw new Error("image copy remains");
	} catch {
		throw new Error("the image could not be read");
	}
}
/** A process can die inside the native picker before JS receives an asset URI.
 * After draining active pickers, sweep ONLY Expo's dedicated cache/ImagePicker,
 * never a Photos source, a document-provider URI or the whole cache/sentinel.
 * The drain is bounded (`PickerPrivacy`): sweeps chain on `sweeping`, so an
 * unbounded wait on one never-settling picker held every later sweep — and
 * every startup admission gated on it — for the life of the process. */
let sweeping: Promise<void> = Promise.resolve();
export function clearNativePickerCache(): Promise<void> {
	const next = sweeping
		.catch(() => undefined)
		.then(async () => {
			await pickerPrivacy.drain();
			try {
				const { Directory, Paths } = await import("expo-file-system");
				const directory = new Directory(Paths.cache, "ImagePicker");
				if (directory.info().exists) directory.delete();
				if (directory.info().exists) throw new Error("image cache remains");
			} catch {
				throw new Error("private image cache removal could not be confirmed");
			}
		});
	sweeping = next;
	return next;
}
