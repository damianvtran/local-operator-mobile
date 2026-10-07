import { describe, expect, it } from "vitest";

import {
	attachActions,
	fromDataUrl,
	sniffImageMime,
} from "@/features/session/attach-rule";

/**
 * The attach path's rules that can be wrong without anything crashing: which
 * MIME type an attachment is sent as, and which sources the sheet offers where.
 * A wrong or empty type is forwarded to the model and fails there, far from the
 * screen that caused it; a wrong row set is a chooser that opens something the
 * platform does not have.
 */
describe("an attachment's MIME type", () => {
	it("trusts the data URL's own header over the file's reported type", () => {
		expect(fromDataUrl("data:image/png;base64,AAAA", "image/jpeg")).toEqual({
			data_b64: "AAAA",
			mime_type: "image/png",
		});
	});

	it("falls back to the reported type when the header carries none", () => {
		// Some browsers emit `data:;base64,` for an image whose type they could not
		// sniff; the file's own `type` is then the only evidence.
		expect(fromDataUrl("data:;base64,AAAA", "image/webp").mime_type).toBe(
			"image/webp",
		);
	});

	it("never sends an empty type, which the relay cannot forward", () => {
		expect(fromDataUrl("data:;base64,AAAA", "").mime_type).toBe("image/jpeg");
	});

	it("keeps only the payload after the header's comma", () => {
		expect(fromDataUrl("data:image/gif;base64,R0lG", "").data_b64).toBe("R0lG");
	});
});

describe("the MIME type sniffed from the payload's own bytes", () => {
	it("reads JPEG bytes as image/jpeg even when the picker reports the source type", () => {
		/* The case `sniffImageMime` exists for: expo-image-picker's base64 output is
		 * re-encoded JPEG whatever the source was, while `mimeType` still names the
		 * SOURCE asset (`image/heic` for a camera photo). The bytes win. */
		expect(sniffImageMime("/9j/4AAQSkZJRg", "image/heic")).toBe("image/jpeg");
	});

	it("reads PNG and GIF from their own headers", () => {
		expect(sniffImageMime("iVBORw0KGgoAAAANSUhEUg", "image/jpeg")).toBe(
			"image/png",
		);
		expect(sniffImageMime("R0lGODlhAQAB", "")).toBe("image/gif");
	});

	it("falls back to the reported type only when it is an image type", () => {
		expect(sniffImageMime("AAAA", "image/webp")).toBe("image/webp");
		expect(sniffImageMime("AAAA", "application/octet-stream")).toBe(
			"image/jpeg",
		);
		expect(sniffImageMime("", "")).toBe("image/jpeg");
	});
});

describe("the attach sheet's rows", () => {
	it("offers the photo picker, the document picker and the clipboard on native", () => {
		expect(attachActions("native").map((action) => action.source)).toEqual([
			"library",
			"files",
			"paste",
		]);
	});

	it("collapses to the file input and the clipboard on the web build", () => {
		/* No photo library and no document picker exist for a browser tab: `library`
		 * there is the browser's own file input (`pickImageFromLibrary`), and the
		 * `files` row would open the same chooser under a second name. */
		expect(attachActions("web").map((action) => action.source)).toEqual([
			"library",
			"paste",
		]);
	});

	it("gives every row a visible label", () => {
		for (const kind of ["native", "web"] as const) {
			for (const action of attachActions(kind)) {
				expect(action.label.trim().length).toBeGreaterThan(0);
			}
		}
	});
});
