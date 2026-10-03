import { Platform } from "react-native";

import type { PromptImage } from "@/contracts";
import { fromDataUrl } from "@/features/session/attach-rule";

/**
 * Pick one image and read it into the wire form (`{ data_b64, mime_type }`).
 *
 * **Two pickers, because the package only has one.** `expo-file-system`'s
 * `File.pickFileAsync` is the platform's own document picker on iOS and Android.
 * On the web build the same call is a stub — it logs "not supported on web" and
 * resolves `undefined` — so the web path uses the browser's own
 * `<input type="file">`, which is what the shipped web client does. Both resolve
 * `null` on cancel, so the composer has exactly one "nothing was attached" state.
 *
 * **Not downscaled.** The kit asks for a 1568 px long-edge cap before upload, and
 * re-encoding needs an image pipeline this app does not have. An oversize image is
 * sent at its original size, which the runtime accepts; the retry envelope refuses
 * to RETAIN one past its own size cap, visibly, rather than dropping it.
 *
 * **Failures are not "cancelled".** A read that fails after the reader chose a file
 * throws, so the composer can say so: collapsing it into `null` would tell the
 * reader nothing happened when their image was lost.
 */
export const pickImage = async (): Promise<PromptImage | null> =>
	Platform.OS === "web" ? pickOnWeb() : pickOnNative();

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
				const reader = new FileReader();
				reader.addEventListener("load", () => {
					// `readAsDataURL` always yields a string; narrowed rather than cast,
					// because the property's declared type also admits an ArrayBuffer.
					const result = reader.result;
					if (typeof result !== "string") {
						reject(new Error("the image could not be read"));
						return;
					}
					resolve(fromDataUrl(result, file.type));
				});
				reader.addEventListener("error", () =>
					reject(new Error("the image could not be read")),
				);
				reader.readAsDataURL(file);
			},
			{ once: true },
		);
		input.click();
	});

/** The platform document picker, through `expo-file-system`. */
const pickOnNative = async (): Promise<PromptImage | null> => {
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
