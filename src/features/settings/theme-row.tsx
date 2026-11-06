import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { t } from "@/i18n";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTheme, useTokenColor } from "@/ui/appearance";
import { useIsRTL } from "@/ui/direction";
import { TOUCH_FLOOR } from "@/ui/layout";

/**
 * Settings → Appearance's entry to the Theme picker: `Theme   Dracula ›`, with
 * a swatch of the palette that is painting now (decision record
 * `mobile-design-direction.md` § 5, "Entry").
 *
 * A separate module so the shared Settings screen gains one line rather than a
 * component: that file is edited by several streams at once.
 */
export const ThemeRow = () => {
	const router = useRouter();
	const { active } = useTheme();
	const chevron = useTokenColor("ink-dim");
	const rtl = useIsRTL();
	return (
		<Pressable
			testID={CONTROL.settingsThemeRow}
			accessibilityRole={ROLE.button}
			accessibilityLabel={t("mobile.settings.theme.row_label", {
				name: active.name,
			})}
			onPress={() => router.push("/theme")}
			className="flex-row items-center gap-3 rounded-sm border border-border-control bg-surface px-3"
			style={{ minHeight: TOUCH_FLOOR }}
		>
			<Text className="flex-1 text-label text-ink">
				{t("mobile.settings.theme.title")}
			</Text>
			{/* The swatch paints the palette's own canvas and accent — a picture of
			 *  the theme, not a role of the current one, though here they coincide. */}
			<View
				className="h-5 w-5 items-center justify-center rounded-full border border-hairline"
				style={{ backgroundColor: active.colors.canvas }}
			>
				<View
					className="h-2.5 w-2.5 rounded-full"
					style={{ backgroundColor: active.colors.accent }}
				/>
			</View>
			<Text className="shrink text-body-sm text-ink-muted" numberOfLines={1}>
				{active.name}
			</Text>
			{/* A "go forward" chevron points the reading direction, as BackIcon's
			 *  does the other way. */}
			{rtl ? (
				<ChevronLeft size={18} color={chevron} />
			) : (
				<ChevronRight size={18} color={chevron} />
			)}
		</Pressable>
	);
};
