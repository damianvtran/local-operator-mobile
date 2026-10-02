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
			/* `maxWidth: "100%"` and the shrink constraint below are INLINE, not classes,
			 *  and that is not belt-and-braces: this is the component that carries the
			 *  same failure `connection-pill.tsx` records, where the class-only version
			 *  measured 554 pt inside a 320 pt viewport and every sibling inherited the
			 *  width. Measured here: the alert's box was 358 pt while its `scrollWidth`
			 *  was 786, a verdict sentence's own box measured 898 pt in a 390 pt screen,
			 *  1573 pt at 200 % — and because the text lays out on ONE line, the URL
			 *  field, the opt-in row and the Test button under it ran past the right edge
			 *  too. A long sentence is the variable; the container has to constrain it. */
			style={{ maxWidth: "100%" }}
			testID={testID}
			accessibilityRole="alert"
			accessibilityLiveRegion={severity === "error" ? "assertive" : "polite"}
		>
			<View className="flex-row items-start gap-2" style={{ maxWidth: "100%" }}>
				<Text className={`text-mono ${alertWordClasses(tone)}`} aria-hidden>
					{alertGlyph(tone)}
				</Text>
				<View className="flex-1 gap-1" style={{ flexShrink: 1, minWidth: 0 }}>
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
