/**
 * What a sheet's scrolling body offers the content inside it: a way to bring one
 * of its own fields into view.
 *
 * WHY A CONTEXT, not a prop: the field that needs revealing is several components
 * below the `Sheet` (the ask sheet's question rows), and threading a callback
 * through every layer would make each of them know about scrolling. The sheet
 * already owns the measured body, the scroll position and the footer height, so
 * it publishes one call and reads nothing back.
 */
import { createContext, useContext } from "react";
import type { View } from "react-native";

export type SheetBodyScroll = {
	/**
	 * Scroll so the FIELD's bottom edge sits the sheet's footer gap above the
	 * footer line — or, when the whole `block` (the question it belongs to) fits,
	 * so the block's top sits just under the header. `field` and `block` are the
	 * views to measure; either may be null when a caller only has one.
	 */
	revealField: (target: { block: View | null; field: View | null }) => void;
	/**
	 * Scroll so the BLOCK's top sits just under the header, whether or not the
	 * block fits. `revealField` cannot say this: a block taller than the viewport
	 * pins its FIELD's bottom instead, which is right for a caret and wrong for
	 * "start reading this card from its first line" (the ask sheet moving to the
	 * next ask).
	 */
	scrollToBlock: (block: View | null) => void;
};

export const SheetBodyScrollContext = createContext<SheetBodyScroll | null>(
	null,
);

/** Null outside a sheet, so a component that also renders standalone (a test,
 *  the settled transcript card) simply does not scroll. */
export const useSheetBodyScroll = (): SheetBodyScroll | null =>
	useContext(SheetBodyScrollContext);
