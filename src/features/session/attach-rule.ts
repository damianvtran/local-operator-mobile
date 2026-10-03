import type { PromptImage } from "@/contracts";

/*
 * The attach path's one rule, in a module with no `react-native` import.
 *
 * Split out of `attach.ts` for the reason `vitest.config.ts` states: unit tests run
 * in Node, and anything a test touches must be free of `react-native`, which Node
 * cannot parse (it is Flow). The pickers stay beside the platform they need.
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
