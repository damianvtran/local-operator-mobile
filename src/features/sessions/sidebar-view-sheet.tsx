import { useRouter } from "expo-router";
import {
	ChevronLeft,
	ChevronRight,
	SlidersHorizontal,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text } from "react-native";

import { isCustomSidebarView } from "@/features/sessions/sidebar-view";
import { SidebarViewControls } from "@/features/sessions/sidebar-view-controls";
import { useSidebarView } from "@/features/sessions/use-sidebar-view";
import { t } from "@/i18n";
import { CONTROL, ROLE, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { IconButton } from "@/ui/components/icon-button";
import { Sheet } from "@/ui/components/sheet";
import { useIsRTL } from "@/ui/direction";
import { TOUCH_FLOOR } from "@/ui/layout";

/**
 * The drawer's quiet view entry point (TestFlight 906): an icon button beside
 * the search pill that opens a compact sheet of the three options a reader
 * reaches for — order, grouping, ended sessions — and a link to the Settings
 * section that holds the rest.
 *
 * WHY AN ICON AND A SHEET, not a row in the list: the operator asked for "a
 * minimal button/interaction that can expand in the settings to more sidebar
 * configuration options similar to the local operator ui". The desktop's own
 * entry is an icon-only `SlidersHorizontal` button named "View options" in the
 * sidebar header (`chat-sidebar.tsx`), so the phone uses the same glyph and
 * name; a sheet is the phone's popover.
 *
 * Self-contained (button + sheet + navigation) so the conversations pane
 * mounts it with ONE line and owns none of its state.
 */
export const SidebarViewButton = ({
	onNavigate,
}: {
	/** Closes the drawer before a navigation, as every pane destination does. */
	onNavigate?: () => void;
}) => {
	const router = useRouter();
	const { view, setView } = useSidebarView();
	const [open, setOpen] = useState(false);
	const chevron = useTokenColor("ink-dim");
	const rtl = useIsRTL();
	return (
		<>
			<IconButton
				accessibilityLabel={t("mobile.sidebar.view_options")}
				onPress={() => setOpen(true)}
				icon={({ color, size }) => (
					<SlidersHorizontal color={color} size={size} />
				)}
				size={20}
				/* Filled while the view is not the default — keyed on the VIEW, not on
				 *  the sheet being open — so content withheld by an option has a visible
				 *  cause in the drawer (design review round 1, D2; the desktop's
				 *  `viewIsCustom` trigger). */
				active={isCustomSidebarView(view)}
				testID={CONTROL.sidebarViewOptions}
			/>
			<Sheet
				visible={open}
				onClose={() => setOpen(false)}
				title={t("mobile.sidebar.view_options")}
				// Two lines, not an ellipsis, at 320 pt and 200 % text (QA round 1, Q2).
				titleLines={2}
				returnFocusTestID={CONTROL.sidebarViewOptions}
				testID={SURFACE.sidebarViewSheet}
				footer={
					<Pressable
						accessibilityRole={ROLE.link}
						accessibilityLabel={t("mobile.sidebar.more_settings")}
						onPress={() => {
							setOpen(false);
							onNavigate?.();
							router.push("/settings?section=sidebar" as never);
						}}
						testID={CONTROL.sidebarViewMore}
						className="flex-row items-center gap-2"
						style={{ minHeight: TOUCH_FLOOR }}
					>
						<Text className="min-w-0 flex-1 text-label text-accent-active dark:text-accent-hover">
							{t("mobile.sidebar.more_settings")}
						</Text>
						{/* Forward points the reading direction (ThemeRow's rule). */}
						{rtl ? (
							<ChevronLeft size={18} color={chevron} aria-hidden />
						) : (
							<ChevronRight size={18} color={chevron} aria-hidden />
						)}
					</Pressable>
				}
			>
				<SidebarViewControls view={view} onChange={setView} scope="sheet" />
			</Sheet>
		</>
	);
};
