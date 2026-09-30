import { View } from "react-native";

import { dividerClasses } from "@/ui/variants";

/**
 * A hairline rule.
 *
 * `hairline`, not `border-control`: it is decorative and never the sole boundary
 * of required content, which is the distinction the two roles encode
 * (tokens.json § color.line). A divider that becomes the only thing separating
 * two required blocks is a `border-control` case, and should say so.
 *
 * `accessible={false}` because a rule is not content; a screen reader announcing
 * it is noise between two real elements.
 */
export const Divider = ({ testID }: { testID?: string }) => (
	<View className={dividerClasses} accessible={false} testID={testID} />
);
