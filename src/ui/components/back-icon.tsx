import {
	ArrowLeft,
	ArrowRight,
	ChevronLeft,
	ChevronRight,
} from "lucide-react-native";

import { useIsRTL } from "@/ui/direction";

/**
 * The BACK affordance, mirrored in a right-to-left layout.
 *
 * WHY IT MIRRORS. A back arrow points at the edge the reader came FROM, which is
 * the reading-start of the active layout — left in English, right in Urdu. An
 * arrow named `ArrowLeft` is therefore the one class of glyph that must flip, and
 * it is also the class most easily got wrong: five hand-written copies (the
 * session, agent-job, video, notification-list and notification-detail headers)
 * is five places to forget.
 *
 * WHY A DIFFERENT GLYPH RATHER THAN `scaleX: -1`. A mirrored arrow and
 * `ArrowRight` draw the same pixels, and the glyph name keeps the intent legible
 * in a diff; a transform would also mirror the glyph's stroke rounding and, on
 * the video surface, sit inside an animated container where a transform already
 * means something.
 *
 * WHAT IS DELIBERATELY NOT MIRRORED HERE, and must not be by a later pass: the
 * brand mark (`navigation-mark.tsx`), media transport controls (`Play` on a
 * thumbnail and in the video surface, which depict a physical action on media and
 * not a reading direction), object icons (`Laptop`, `Server`, `Mic`, `Bell`), and
 * the chevron on a disclosure row (`ChevronDown`, vertical). A caller that passes
 * `glyph="chevron"` is the horizontal back chevron of a detail header, not a
 * disclosure.
 */
export const BackIcon = ({
	color,
	size,
	glyph = "arrow",
}: {
	color: string;
	size: number;
	/** `chevron` for the thin detail-header back chevron; `arrow` (default) for
	 *  the full-width back arrow of a screen header. */
	glyph?: "arrow" | "chevron";
}) => {
	const rtl = useIsRTL();
	if (glyph === "chevron") {
		return rtl ? (
			<ChevronRight color={color} size={size} />
		) : (
			<ChevronLeft color={color} size={size} />
		);
	}
	return rtl ? (
		<ArrowRight color={color} size={size} />
	) : (
		<ArrowLeft color={color} size={size} />
	);
};
