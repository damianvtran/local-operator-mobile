import { describe, expect, it } from "vitest";

import { scrollAnchorFromValue } from "@/features/session/scroll-hook";

/**
 * The `lo-scroll` parse. The one accepted value is `top`; everything else —
 * absent, a typo, a value a future revision might add — is the tail-following
 * default, because a capture that silently anchors somewhere unintended is a
 * frame that lies about what a reader sees.
 */
describe("scrollAnchorFromValue", () => {
	it("accepts exactly `top`", () => {
		expect(scrollAnchorFromValue("top")).toBe("top");
	});

	it("resolves everything else to the default anchor", () => {
		expect(scrollAnchorFromValue(null)).toBe(null);
		expect(scrollAnchorFromValue("")).toBe(null);
		expect(scrollAnchorFromValue("TOP")).toBe(null);
		expect(scrollAnchorFromValue("bottom")).toBe(null);
	});
});
