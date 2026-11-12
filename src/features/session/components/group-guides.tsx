import { View } from "react-native";

import {
	GROUP_GUIDE_CLASS,
	GROUP_GUIDE_START_CLASS,
} from "@/features/session/components/trace-rail";
import { groupGuideId } from "@/ui/a11y";
import { cx } from "@/ui/variants";

/**
 * The containment guides of a row inside opened groups: one 1 pt hairline per
 * level, under that level's bar glyph (`GROUP_GUIDE_START_CLASS`). Absolutely
 * positioned over the row's full height, so a run of members draws one
 * unbroken line and the measured height the offset table reads is unchanged.
 * Decorative only: hidden from assistive tech and never a touch target.
 */
export const GroupGuides = ({ depth }: { depth: number }) => (
	<>
		{GROUP_GUIDE_START_CLASS.slice(0, depth).map((start, level) => (
			<View
				key={start}
				testID={groupGuideId(level + 1)}
				className={cx(GROUP_GUIDE_CLASS, start)}
				pointerEvents="none"
				aria-hidden
			/>
		))}
	</>
);
