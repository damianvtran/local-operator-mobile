import { Text, View } from "react-native";

import { CONTROL, EMPTY, SCREEN } from "@/ui/a11y";
import { useTheme } from "@/ui/appearance";
import {
	Divider,
	EmptyState,
	Heading,
	Screen,
	Segmented,
} from "@/ui/components";

/**
 * Settings (docs/ux/flows.md F-10): connection, theme, diagnostics, sign out.
 *
 * **Appearance is real, not a placeholder.** The theme preference is the shell's
 * own feature — the one setting that does not depend on a connection — so this
 * screen is where it is exposed, and it is wired end to end: the segmented control
 * writes the UI store, the provider applies it to the styling system, and the
 * sentence below the control says which of the two is showing. Everything else on
 * this screen arrives with the streams that own connections and diagnostics; the
 * empty states name what belongs there rather than showing an invented value.
 */
export default function Settings() {
	const { preference, setPreference, theme } = useTheme();

	return (
		<Screen title="Settings" testID={SCREEN.settings}>
			<View className="gap-3">
				<Heading level={2} className="text-heading text-ink">
					Appearance
				</Heading>
				<Segmented
					label="Theme"
					testID={CONTROL.settingsTheme}
					value={preference}
					onChange={setPreference}
					options={[
						{ value: "system", label: "System", testID: CONTROL.themeSystem },
						{ value: "light", label: "Light", testID: CONTROL.themeLight },
						{ value: "dark", label: "Dark", testID: CONTROL.themeDark },
					]}
				/>
				<Text className="text-body-sm text-ink-dim">
					{preference === "system"
						? `Following this device. Showing the ${theme} theme.`
						: `Showing the ${theme} theme.`}
				</Text>
			</View>

			<View className="my-4">
				<Divider />
			</View>

			<View className="gap-3">
				<Heading level={2} className="text-heading text-ink">
					Connection
				</Heading>
				<EmptyState
					headline="Not connected."
					next="Your computers, the route you are on, and signing out appear here."
					testID={EMPTY.settingsConnection}
				/>
			</View>
		</Screen>
	);
}
