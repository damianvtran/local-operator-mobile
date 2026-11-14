import { View } from "react-native";

import { SidebarViewControls } from "@/features/sessions/sidebar-view-controls";
import { useSidebarView } from "@/features/sessions/use-sidebar-view";
import { t } from "@/i18n";
import { REGION } from "@/ui/a11y";
import { SectionHeader } from "@/ui/components/section-header";

/**
 * Settings → Sidebar: every drawer view option the phone has (TestFlight 906),
 * the full set behind the drawer sheet's "More sidebar settings" link. It is
 * the desktop's View options popover minus what the phone cannot draw (agent
 * grouping, section reordering, manual pin order) — `sidebar-view.ts` records
 * why each is absent.
 *
 * `onLayout` reports the section's offset so Settings can scroll to it when it
 * was opened from that link (`?section=sidebar`).
 */
export const SidebarSettingsSection = ({
	onLayoutY,
}: {
	onLayoutY?: (y: number) => void;
}) => {
	const { view, setView } = useSidebarView();
	return (
		<View
			className="gap-3"
			testID={REGION.settingsSidebar}
			onLayout={(event) => onLayoutY?.(event.nativeEvent.layout.y)}
		>
			<SectionHeader label={t("mobile.sidebar.settings_heading")} />
			<SidebarViewControls view={view} onChange={setView} scope="settings" />
		</View>
	);
};
