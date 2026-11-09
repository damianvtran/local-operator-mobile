import { Text, View } from "react-native";

import type { BannerProps } from "@/ui/components/banner";
import { Button } from "@/ui/components/button";
import { useTextScale } from "@/ui/text-scale-provider";
import {
	alertActionClasses,
	alertActionLayout,
	alertClasses,
	alertGlyph,
	alertStacked,
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
	/** One trailing remedy, the Banner's own shape and rule (exactly one action,
	 *  never a dismiss — a dismiss would let a reader hide a real failure). It
	 *  exists so a page-status failure that must sit INSET beside the control it
	 *  affects — the home's folder and model reads, above the composer (design
	 *  spec §3) — can keep its Retry without the Banner's full-bleed band and
	 *  full-width rule. Rendered as a `quiet`/`sm` Button, whose box is the
	 *  full touch floor; `alertActionClasses` lets it overlap the alert's own
	 *  padding rather than grow the alert (design D2). */
	action?: BannerProps["action"];
	testID?: string;
};

export const Alert = ({
	severity,
	title,
	children,
	action,
	testID,
}: AlertProps) => {
	const tone: SemanticTone =
		severity === "error"
			? "danger"
			: severity === "success"
				? "success"
				: severity === "warning"
					? "warning"
					: "info";
	const { effectiveScale } = useTextScale();
	const layout = alertActionLayout(action !== undefined, effectiveScale);
	const placed = alertActionClasses(layout);
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
			style={
				layout === "stacked"
					? { maxWidth: "100%", ...alertStacked }
					: { maxWidth: "100%" }
			}
			testID={testID}
			accessibilityRole="alert"
			accessibilityLiveRegion={severity === "error" ? "assertive" : "polite"}
		>
			{/* With an action the text block takes the row and the remedy trails it
			 *  (or sits under it at large text, `alertActionLayout`); without one the
			 *  row keeps its content width, as every existing alert has always
			 *  painted. */}
			<View className={placed.text} style={{ maxWidth: "100%" }}>
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
			{action ? (
				<View className={placed.action}>
					<Button
						label={action.label}
						onPress={action.onPress}
						testID={action.testID}
						loading={action.loading}
						variant="quiet"
						size="sm"
					/>
				</View>
			) : null}
		</View>
	);
};
