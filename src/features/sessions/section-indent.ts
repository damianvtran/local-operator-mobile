import { LIST_ROW_GAP_PT, LIST_ROW_SLOT_PT } from "@/ui/variants";

/**
 * How far past the row gutter a drawer section header starts: the row's title
 * column (docs/design/components.md § 7).
 *
 * Every row reserves its indicator slot so a title never moves when the row
 * starts streaming or turns unread. A header at the gutter therefore sat 24 pt
 * left of every title beneath it, which read as misaligned in any section with
 * no marks (OLDER, most of the time). Headers share the title column instead and
 * the indicator hangs in the gutter beside it, as it already does on the row
 * (`listRowHangingIndicator`). `slotPt` is the slot the list's rows reserve: 12,
 * or the picture width when some row in the list carries one.
 */
export const sectionHeaderIndentPt = (slotPt?: number): number =>
	(slotPt ?? LIST_ROW_SLOT_PT) + LIST_ROW_GAP_PT;
