import { t } from "@/i18n";
import { BackIcon } from "@/ui/components/back-icon";
import { IconButton } from "@/ui/components/icon-button";

/**
 * THE back control: a chevron icon button, on every screen that has one.
 *
 * WHY ONE COMPONENT (visual audit D16). Back used to be drawn three ways: a
 * 12 pt text button reading "Back" beside a 28 pt title on Settings, Past,
 * Projects, Schedules, Library and Team Bridge; a chevron icon on the inbox;
 * and an arrow on the session's sub-screens. The text form was the smallest
 * label on the screen sitting next to the largest, cost a different width in
 * every language, and made the same action look like three. This is the
 * inbox's form — `IconButton` (touch-floor target on both axes) with
 * `BackIcon`'s chevron, which already mirrors in right-to-left layouts.
 *
 * The accessible name is the catalogue's one "Back" (`mobile.common.back`)
 * unless a screen has a more specific one to say. The testID stays the
 * caller's, from the registry in `src/ui/a11y.ts`, so every existing end-to-end
 * selector still resolves to the same control.
 */
export const BackButton = ({
	onPress,
	testID,
	accessibilityLabel,
}: {
	onPress: () => void;
	testID: string;
	accessibilityLabel?: string;
}) => (
	<IconButton
		accessibilityLabel={accessibilityLabel ?? t("mobile.common.back")}
		onPress={onPress}
		icon={({ color, size }) => (
			<BackIcon color={color} size={size} glyph="chevron" />
		)}
		testID={testID}
	/>
);
