import { Text, View } from "react-native";

import {
	alertClasses,
	alertGlyph,
	alertWordClasses,
	type SemanticTone,
} from "@/ui/variants";

/**
 * An inline alert: a block of text with a semantic border and wash — never a
 * dialog (docs/design/components.md § 9).
 *
 * Every severity carries a word or a glyph BESIDES the colour, because colour
 * alone is anti-pattern 17 and a reader with a colour-vision difference has no
 * other channel. The glyphs are text, not icons: they survive every system font
 * and never become tofu (§ 3, tokens.json § size.icon.stateGlyphs).
 *
 * Distinct from a Banner: this is a response to something the reader just did; a
 * banner is the page's own status.
 */
export type AlertProps = {
	severity: "error" | "warning" | "info" | "success";
	/** Optional short lead-in, in the severity's colour. */
	title?: string;
	children: string;
	testID?: string;
};

export const Alert = ({ severity, title, children, testID }: AlertProps) => {
	const tone: SemanticTone =
		severity === "error"
			? "danger"
			: severity === "success"
				? "success"
				: severity === "warning"
					? "warning"
					: "info";
	return (
		<View
			className={alertClasses(tone)}
			testID={testID}
			accessibilityRole="alert"
			accessibilityLiveRegion={severity === "error" ? "assertive" : "polite"}
		>
			<View className="flex-row items-start gap-2">
				<Text className={`text-mono ${alertWordClasses(tone)}`} aria-hidden>
					{alertGlyph(tone)}
				</Text>
				<View className="flex-1 gap-1">
					{title ? (
						<Text
							className={`text-body-sm font-semibold ${alertWordClasses(tone)}`}
						>
							{title}
						</Text>
					) : null}
					<Text className="text-body-sm text-ink">{children}</Text>
				</View>
			</View>
		</View>
	);
};
