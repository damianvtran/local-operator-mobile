import type { PromptImage } from "@/contracts";

/*
 * The attach path's rules, in a module with no `react-native` import.
 *
 * Split out of `attach.ts` for the reason `vitest.config.ts` states: unit tests run
 * in Node, and anything a test touches must be free of `react-native`, which Node
 * cannot parse (it is Flow). The pickers stay beside the platform they need, and
 * the decisions — which sources a platform offers, which MIME type a payload
 * really is — live here, where a test can drive them.
 */

/** The MIME type in a `data:` URL's header. Hoisted so it compiles once. */
const DATA_URL_TYPE = /^data:([^;,]+)/;

/**
 * Split a `data:` URL into the wire's two fields.
 *
 * Exported because it is the one piece of this module with a rule to get wrong:
 * the MIME type comes from the URL's own header when it has one, and only falls
 * back to the file's reported type — a browser reports `""` for some images, and
 * the relay needs a real type to forward the attachment to a model.
 */
export const fromDataUrl = (url: string, reportedType: string): PromptImage => {
	const comma = url.indexOf(",");
	const header = comma >= 0 ? url.slice(0, comma) : "";
	const data = comma >= 0 ? url.slice(comma + 1) : url;
	const headerType = DATA_URL_TYPE.exec(header)?.[1] ?? "";
	const mime = headerType || reportedType || "image/jpeg";
	return { data_b64: data, mime_type: mime };
};

/** Base64 prefixes of the file headers: PNG `\x89PNG`, JPEG `\xFF\xD8\xFF`,
 *  GIF87a/GIF89a. A table at module scope so `sniffImageMime` reads data and
 *  nothing else — the same shape the contract's own sniffing implies. */
const IMAGE_MAGIC: ReadonlyArray<readonly [string, string]> = [
	["iVBOR", "image/png"],
	["/9j/", "image/jpeg"],
	["R0lGOD", "image/gif"],
];

/**
 * The MIME type a base64 payload REALLY is, from its own magic prefix.
 *
 * This exists because `expo-image-picker`'s `base64` field is not the picked
 * file's bytes: its iOS implementation re-encodes anything that is not JPEG into
 * JPEG before base64-encoding (`readJpegBase64From` — "base64 output is always
 * JPEG regardless of the source file's original format", its own comment, read at
 * 57.0.20), while `mimeType` still reports the SOURCE asset's type. Taking
 * `mimeType` at face value therefore labels JPEG bytes `image/heic` (or
 * `image/png`) — and that label is what this client shows on the chip and
 * declares on the wire.
 *
 * The relay does not read that declared label: `server.py`'s `image_blocks`
 * decides the format by CONTENT ("the client's declared `mime_type` is
 * deliberately NOT read … the wire mime comes back from the bound") and drops an
 * entry whose bytes it does not recognise. The sniff here is the same judgement
 * made at the client edge, so the declared type is true to the bytes it describes
 * instead of whatever the picker's metadata claimed. The set is deliberately
 * small — the formats these pickers and clipboards actually produce — and
 * everything else falls back to the reported type (when it is an image type) or
 * JPEG.
 */
export const sniffImageMime = (dataB64: string, reported: string): string => {
	for (const [prefix, mime] of IMAGE_MAGIC) {
		if (dataB64.startsWith(prefix)) return mime;
	}
	return reported.startsWith("image/") ? reported : "image/jpeg";
};

/* ------------------------------------------------------------ the sources */

/**
 * Where an attachment comes from. The attach sheet's rows are these, and the
 * composer's one chip strip is where every one of them lands — the sources differ,
 * the attached image does not.
 */
export type AttachSource = "library" | "files" | "paste";

/** One row of the attach sheet. */
export interface AttachAction {
	readonly source: AttachSource;
	/** The row's visible label. `Photo Library` as the OS itself spells it, and
	 *  `Files` as the document picker's own heading — the readable names a reader
	 *  meets in the system UI either of them opens. */
	readonly label: string;
}

/**
 * The rows the attach sheet shows, per build kind.
 *
 * The split is what each platform's chooser MEANS, not a cosmetic difference:
 * on iOS/Android `library` is the system photo picker (screenshots and photos),
 * `files` is the document picker the attach control has used since the session
 * view landed, and `paste` reads the clipboard through the platform's own image
 * channel. On the web build there is no photo library and no document picker —
 * the browser's file input is the one chooser — so its sheet collapses to
 * `Choose image` and `Paste image`. Every row lands in the same attachment
 * strip, with the same removal and the same send path (docs/ux/flows.md § 6).
 */
export const attachActions = (
	kind: "web" | "native",
): readonly AttachAction[] =>
	kind === "web"
		? [
				{ source: "library", label: "Choose image" },
				{ source: "paste", label: "Paste image" },
			]
		: [
				{ source: "library", label: "Photo Library" },
				{ source: "files", label: "Files" },
				{ source: "paste", label: "Paste image" },
			];
