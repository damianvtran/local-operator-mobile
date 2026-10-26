import { Image } from "react-native";

/** The established desktop identity, not a theme-derived redraw. The white disk
 * keeps the black figure recognizable on both native grounds. It is decorative
 * beside a named destination; duplicating that name would add screen-reader noise.
 * Source and the narrow design-kit exception: docs/design/native-interaction-guidelines.md. */
export const NavigationMark = ({ size = 28 }: { size?: 28 | 32 }) => (
	<Image
		source={require("../../../assets/brand/navigation-mark.png")}
		style={{ width: size, height: size }}
		resizeMode="contain"
		accessible={false}
		accessibilityElementsHidden
		importantForAccessibility="no-hide-descendants"
	/>
);
