import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sectionHeaderIndentPt } from "@/features/sessions/section-indent";
import { LIST_ROW_SLOT_PT, listRowHangingIndicator } from "@/ui/variants";

/**
 * A section header starts where its rows' TITLES start, not where their
 * indicator slot does (docs/design/components.md § 7).
 *
 * The slot is reserved on every row so a title never moves when a row starts
 * streaming or turns unread. Headers sat at the gutter instead, so in a section
 * where no row had a mark (OLDER, most of the time) every title looked indented
 * 24 pt under its own heading. The indicator now hangs in the gutter beside the
 * title column, and the heading shares that column.
 */
/* Top-level for biome's useTopLevelRegex: the header's padding is the helper's
 *  answer for the slot THIS list's rows reserve. */
const HEADER_INDENT_WIRING =
	/paddingStart:\s*sectionHeaderIndentPt\(\s*anyRowPictured \? ROW_AVATAR_PT : undefined,?\s*\)/;

describe("the drawer's section header indent", () => {
	/* The row's own geometry: the indicator hangs `start` pt before the title, so
	 *  the title column begins that far past the gutter. */
	const titleOffset = (slotPt?: number) =>
		-listRowHangingIndicator({ slotPt, scale: 1 }).start;

	it("lines a plain list's headers up with its titles", () => {
		expect(sectionHeaderIndentPt()).toBe(titleOffset());
		expect(sectionHeaderIndentPt()).toBe(titleOffset(LIST_ROW_SLOT_PT));
	});

	it("follows the wider slot a pictured list reserves", () => {
		const pictureSlot = 24;
		expect(sectionHeaderIndentPt(pictureSlot)).toBe(titleOffset(pictureSlot));
		expect(sectionHeaderIndentPt(pictureSlot)).toBeGreaterThan(
			sectionHeaderIndentPt(),
		);
	});

	it("is what the pane's header row is padded by", () => {
		const pane = readFileSync(
			fileURLToPath(new URL("./conversations-pane.tsx", import.meta.url)),
			"utf8",
		);
		expect(pane).toMatch(HEADER_INDENT_WIRING);
	});
});
