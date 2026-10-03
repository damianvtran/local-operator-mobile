import { describe, expect, it } from "vitest";

import { fromDataUrl } from "@/features/session/attach-rule";

/**
 * The one rule in the picker that can be wrong without anything crashing: which
 * MIME type an attachment is sent as. A wrong or empty type is forwarded to the
 * model and fails there, far from the screen that caused it.
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
