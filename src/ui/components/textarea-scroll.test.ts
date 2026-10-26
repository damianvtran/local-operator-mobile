import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fieldScrollsWithContent } from "@/ui/variants";

/**
 * An empty composer field must not be able to scroll.
 *
 * The resting floor is clamped to one placeholder line on purpose (design D1/D20),
 * so at 200 % text the PLACEHOLDER can be taller than the box. When that height
 * fed the scroll decision, a field the reader had typed nothing into painted a
 * scrollbar — and, on the web build, the scrollbar's corner glyph — which is the
 * regression the design round reported. Only the reader's CONTENT may scroll.
 */
describe("textarea scroll decision", () => {
	it("stays still for an empty field whose placeholder overflows", () => {
		// 64 pt resting box, six-line cap of 264 at 200 %: the placeholder may need
		// three lines, and nothing about that is the reader's text.
		expect(fieldScrollsWithContent(60, 264)).toBe(false);
	});

	it("scrolls once the reader's own text passes the cap", () => {
		expect(fieldScrollsWithContent(300, 264)).toBe(true);
		expect(fieldScrollsWithContent(264, 264)).toBe(false);
	});

	it("is the only input to scrollEnabled", () => {
		const source = readFileSync(
			fileURLToPath(new URL("./textarea.tsx", import.meta.url)),
			"utf8",
		);
		// A second, placeholder-aware expression here is the defect: it is how the
		// empty-field scrollbar came back the first time.
		expect(source).toContain(
			"scrollEnabled={fieldScrollsWithContent(contentFloor, cap)}",
		);
		expect(source).not.toContain(
			"Math.max(contentFloor, placeholderFloor) > cap",
		);
	});
});
